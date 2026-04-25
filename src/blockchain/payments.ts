import {
  createPaymentTransaction,
  createStandardAssetTransferTransaction,
  type TransferOutputParams,
  type TxPaymentOutput,
} from "@neuraiproject/neurai-create-transaction";

import { Wallet } from "../neuraiWallet";
import { InsufficientFundsError, ValidationError } from "../Errors";
import {
  ChainType,
  IForcedUTXO,
  ISendManyTransactionOptions,
  ISendResult,
  ITransactionOptions,
  IUTXO,
} from "../Types";
import {
  DUST_THRESHOLD_SATS,
  broadcastSignedTransaction,
  buildPrivateKeyMap,
  estimateSizeKB,
  feeSatsFromSize,
  loadSpendableFunds,
  satsToXna,
  selectAllUTXOsByAsset,
  selectUTXOs,
  shortenNumber,
  signRawTransaction,
  sumUTXOSatoshis,
  utxosToTxInputs,
  xnaToSats,
} from "./txEngine";

interface BuildResult {
  rawTxHex: string;
  signedHex: string;
  inputs: IUTXO[];
  outputs: Record<string, number | { transfer: Record<string, number> }>;
  fee: number;
  baseCurrencyAmount: number;
  baseCurrencyChange: number;
  assetChange: number;
  dustAbsorbedSats: number;
  sentMax: boolean;
  walletMempool: ReturnType<Wallet["getMempool"]> extends Promise<infer T>
    ? T
    : never;
}

function isAssetTransfer(wallet: Wallet, assetName: string): boolean {
  return assetName !== wallet.baseCurrency;
}

function totalAmount(outputs: Record<string, number>): number {
  return Object.values(outputs).reduce((t, v) => t + v, 0);
}

function sumByAsset(utxos: IUTXO[], assetName: string): number {
  let sum = 0;
  for (const u of utxos) {
    if (u.assetName !== assetName) continue;
    sum += u.satoshis / 1e8;
  }
  return sum;
}

function tagForcedUTXOs(forced?: IForcedUTXO[]): IUTXO[] {
  if (!forced || forced.length === 0) return [];
  return forced.map((f) => ({ ...f.utxo, forced: true }));
}

async function buildSendManyInternal(
  wallet: Wallet,
  options: ISendManyTransactionOptions,
): Promise<BuildResult> {
  const assetName = options.assetName || wallet.baseCurrency;
  const outputs = options.outputs;
  const sendMax = options.sendMax === true;

  if (!outputs || Object.keys(outputs).length === 0) {
    throw new ValidationError("outputs is mandatory");
  }

  const transferring = isAssetTransfer(wallet, assetName);

  if (sendMax) {
    if (transferring) {
      throw new ValidationError(
        "sendMax is only supported for the base currency",
      );
    }
    if (Object.keys(outputs).length !== 1) {
      throw new ValidationError("sendMax requires exactly one recipient");
    }
  }

  const forcedUTXOs = tagForcedUTXOs(options.forcedUTXOs);
  const { utxos: allUTXOs, feeRate } = await loadSpendableFunds(
    wallet,
    forcedUTXOs,
  );

  const changeAddressBaseCurrency =
    options.forcedChangeAddressBaseCurrency ||
    (await wallet.getChangeAddress());

  const toAddresses = Object.keys(outputs);
  if (toAddresses.includes(changeAddressBaseCurrency)) {
    throw new ValidationError(
      "Change address cannot be the same as to address",
    );
  }

  const network = wallet.network as ChainType;

  // ------------------------------------------------------------------
  // sendMax: drain entire base-currency balance, NO change output.
  // Math is done in satoshis to avoid IEEE-754 drift.
  // ------------------------------------------------------------------
  if (sendMax) {
    const recipient = toAddresses[0];
    const baseUTXOs = selectAllUTXOsByAsset(allUTXOs, wallet.baseCurrency);
    if (baseUTXOs.length === 0) {
      throw new InsufficientFundsError(
        `No ${wallet.baseCurrency} UTXOs available to spend`,
      );
    }
    // Size estimated WITHOUT a change output — that is what we will broadcast.
    const sizeKb = estimateSizeKB(baseUTXOs, [recipient]);
    const feeSats = feeSatsFromSize(sizeKb, feeRate);
    const availableSats = sumUTXOSatoshis(baseUTXOs, wallet.baseCurrency);
    if (availableSats <= feeSats) {
      throw new InsufficientFundsError(
        `Available ${satsToXna(availableSats)} ${wallet.baseCurrency} cannot cover the fee ${satsToXna(feeSats)}`,
      );
    }
    const amountSats = availableSats - feeSats;

    const txPayments: TxPaymentOutput[] = [
      { address: recipient, valueSats: amountSats },
    ];
    const inputs = utxosToTxInputs(baseUTXOs);
    const built = createPaymentTransaction({ inputs, payments: txPayments });
    const rawTxHex = built.rawTx;

    const forcedExtras = options.forcedUTXOs?.map((f) => ({
      address: f.address,
      privateKey: f.privateKey,
    }));
    const privateKeys = buildPrivateKeyMap(wallet, baseUTXOs, forcedExtras);
    const signedHex = signRawTransaction(
      network,
      rawTxHex,
      baseUTXOs,
      privateKeys,
    );

    const walletMempool = await wallet.getMempool();
    const amountXna = satsToXna(amountSats);
    const feeXna = satsToXna(feeSats);

    return {
      rawTxHex,
      signedHex,
      inputs: baseUTXOs,
      outputs: { [recipient]: amountXna },
      fee: feeXna,
      baseCurrencyAmount: amountXna + feeXna,
      baseCurrencyChange: 0,
      assetChange: 0,
      dustAbsorbedSats: 0,
      sentMax: true,
      walletMempool,
    };
  }

  // ------------------------------------------------------------------
  // Standard flow (asset transfer or regular XNA send).
  // ------------------------------------------------------------------
  const amount = totalAmount(outputs);

  let assetChange = 0;
  let assetUTXOs: IUTXO[] = [];
  let baseCurrencyUTXOs: IUTXO[] = [];
  let baseCurrencyAmount: number;
  let changeAddressAsset = "";

  if (transferring) {
    assetUTXOs = selectUTXOs(allUTXOs, assetName, amount);
    assetChange = sumByAsset(assetUTXOs, assetName) - amount;

    // For asset transfers we still need XNA UTXOs to pay the fee
    const previewSelection = selectUTXOs(allUTXOs, wallet.baseCurrency, 0.001);
    const previewSize = estimateSizeKB(
      [...assetUTXOs, ...previewSelection],
      [...toAddresses, changeAddressBaseCurrency],
    );
    baseCurrencyAmount = previewSize * feeRate;
    baseCurrencyUTXOs = selectUTXOs(
      allUTXOs,
      wallet.baseCurrency,
      baseCurrencyAmount,
    );

    changeAddressAsset =
      options.forcedChangeAddressAssets ||
      (await wallet.getAssetChangeAddress());
    if (toAddresses.includes(changeAddressAsset)) {
      throw new ValidationError(
        "Change address cannot be the same as to address",
      );
    }
  } else {
    baseCurrencyAmount = amount;
    baseCurrencyUTXOs = selectUTXOs(
      allUTXOs,
      wallet.baseCurrency,
      baseCurrencyAmount,
    );
    // refine fee based on chosen inputs
    const sizeKb = estimateSizeKB(baseCurrencyUTXOs, [
      ...toAddresses,
      changeAddressBaseCurrency,
    ]);
    const fee = sizeKb * feeRate;
    baseCurrencyAmount = amount + fee;
    baseCurrencyUTXOs = selectUTXOs(
      allUTXOs,
      wallet.baseCurrency,
      baseCurrencyAmount,
    );
  }

  const selectedUTXOs: IUTXO[] = transferring
    ? [...assetUTXOs, ...baseCurrencyUTXOs]
    : baseCurrencyUTXOs;

  // Worst-case size — assumes a change output exists. We may drop it below.
  const sizeKbWithChange = estimateSizeKB(
    selectedUTXOs,
    transferring
      ? [...toAddresses, changeAddressBaseCurrency, changeAddressAsset]
      : [...toAddresses, changeAddressBaseCurrency],
  );
  const feeSatsWithChange = feeSatsFromSize(sizeKbWithChange, feeRate);

  // Sat-precise change. Avoids the IEEE-754 drift that previously left
  // sub-dust change UTXOs that the network rejected.
  const baseCurrencyAvailableSats = sumUTXOSatoshis(
    baseCurrencyUTXOs,
    wallet.baseCurrency,
  );
  const amountSats = transferring ? 0n : xnaToSats(amount);
  const tentativeChangeSats =
    baseCurrencyAvailableSats - amountSats - feeSatsWithChange;

  if (tentativeChangeSats < 0n) {
    throw new InsufficientFundsError(
      `Selected UTXOs do not cover amount + fee for ${wallet.baseCurrency}`,
    );
  }

  let baseCurrencyChangeSats: bigint;
  let feeSats: bigint;
  let dustAbsorbedSats = 0n;

  if (tentativeChangeSats < DUST_THRESHOLD_SATS) {
    // Below dust → drop the change output. The residue is implicitly paid
    // to the miner as part of the fee. Required for the network to accept
    // the transaction (sub-dust outputs are non-standard).
    baseCurrencyChangeSats = 0n;
    feeSats = feeSatsWithChange + tentativeChangeSats;
    dustAbsorbedSats = tentativeChangeSats;
  } else {
    baseCurrencyChangeSats = tentativeChangeSats;
    feeSats = feeSatsWithChange;
  }

  const baseCurrencyChange = satsToXna(baseCurrencyChangeSats);
  const fee = satsToXna(feeSats);

  // Compose the user-facing outputs map.
  const totalOutputs: Record<
    string,
    number | { transfer: Record<string, number> }
  > = {};
  if (transferring) {
    if (assetChange > 0) {
      totalOutputs[changeAddressAsset] = {
        transfer: { [assetName]: shortenNumber(assetChange) },
      };
    }
    for (const addy of toAddresses) {
      totalOutputs[addy] = { transfer: { [assetName]: outputs[addy] } };
    }
    if (baseCurrencyChangeSats > 0n) {
      totalOutputs[changeAddressBaseCurrency] = baseCurrencyChange;
    }
  } else {
    for (const addy of toAddresses) {
      totalOutputs[addy] = outputs[addy];
    }
    if (baseCurrencyChangeSats > 0n) {
      totalOutputs[changeAddressBaseCurrency] = baseCurrencyChange;
    }
  }

  // Build the actual rawTx via neurai-create-transaction, in satoshis.
  const inputs = utxosToTxInputs(selectedUTXOs);
  let rawTxHex: string;

  if (transferring) {
    const transfers: TransferOutputParams[] = [];
    for (const [address, amt] of Object.entries(outputs)) {
      transfers.push({
        address,
        assetName,
        amountRaw: xnaToSats(amt),
      });
    }
    if (assetChange > 0) {
      transfers.push({
        address: changeAddressAsset,
        assetName,
        amountRaw: xnaToSats(shortenNumber(assetChange)),
      });
    }
    const txPayments: TxPaymentOutput[] = [];
    if (baseCurrencyChangeSats > 0n) {
      txPayments.push({
        address: changeAddressBaseCurrency,
        valueSats: baseCurrencyChangeSats,
      });
    }
    const built = createStandardAssetTransferTransaction({
      inputs,
      payments: txPayments,
      transfers,
    });
    rawTxHex = built.rawTx;
  } else {
    const txPayments: TxPaymentOutput[] = [];
    for (const addy of toAddresses) {
      txPayments.push({
        address: addy,
        valueSats: xnaToSats(outputs[addy]),
      });
    }
    if (baseCurrencyChangeSats > 0n) {
      txPayments.push({
        address: changeAddressBaseCurrency,
        valueSats: baseCurrencyChangeSats,
      });
    }
    const built = createPaymentTransaction({ inputs, payments: txPayments });
    rawTxHex = built.rawTx;
  }

  const forcedExtras = options.forcedUTXOs?.map((f) => ({
    address: f.address,
    privateKey: f.privateKey,
  }));
  const privateKeys = buildPrivateKeyMap(wallet, selectedUTXOs, forcedExtras);
  const signedHex = signRawTransaction(
    network,
    rawTxHex,
    selectedUTXOs,
    privateKeys,
  );

  const walletMempool = await wallet.getMempool();

  return {
    rawTxHex,
    signedHex,
    inputs: selectedUTXOs,
    outputs: totalOutputs,
    fee,
    baseCurrencyAmount: transferring ? fee : amount + fee,
    baseCurrencyChange,
    assetChange: transferring ? shortenNumber(assetChange) : 0,
    dustAbsorbedSats: Number(dustAbsorbedSats),
    sentMax: false,
    walletMempool,
  };
}

function toSendResult(
  build: BuildResult,
  params: {
    amount: number;
    assetName: string;
    transactionId?: string | null;
  },
): ISendResult {
  return {
    transactionId: params.transactionId ?? null,
    debug: {
      amount: params.amount,
      assetName: params.assetName,
      fee: build.fee,
      inputs: build.inputs.map((u) => ({
        txid: u.txid,
        vout: u.outputIndex,
        address: u.address,
      })),
      outputs: build.outputs,
      rawUnsignedTransaction: build.rawTxHex,
      xnaAmount: build.baseCurrencyAmount,
      xnaChangeAmount: build.baseCurrencyChange,
      dustAbsorbedSats: build.dustAbsorbedSats,
      sentMax: build.sentMax,
      signedTransaction: build.signedHex,
      UTXOs: build.inputs,
      walletMempool: build.walletMempool,
    },
  };
}

export async function createTransactionForOptions(
  wallet: Wallet,
  options: ITransactionOptions & { forcedChangeAddressBaseCurrency?: string },
): Promise<ISendResult> {
  if (!options.toAddress) throw Error("toAddress is mandatory");
  const sendMax = options.sendMax === true;
  if (!sendMax && !options.amount) throw Error("amount is mandatory");

  const assetName = options.assetName || wallet.baseCurrency;
  const build = await buildSendManyInternal(wallet, {
    wallet,
    assetName,
    outputs: { [options.toAddress]: options.amount ?? 0 },
    sendMax,
    forcedChangeAddressAssets: (options as any).forcedChangeAddressAssets,
    forcedChangeAddressBaseCurrency: options.forcedChangeAddressBaseCurrency,
    forcedUTXOs: (options as any).forcedUTXOs,
  });
  // For sendMax the user-facing "amount" is the actual amount sent
  // (computed from balance − fee), not the value passed in by the caller.
  const reportedAmount = sendMax
    ? build.baseCurrencyAmount - build.fee
    : (options.amount ?? 0);
  return toSendResult(build, { amount: reportedAmount, assetName });
}

export async function createSendManyForOptions(
  wallet: Wallet,
  options: ISendManyTransactionOptions,
): Promise<ISendResult> {
  const assetName = options.assetName || wallet.baseCurrency;
  const build = await buildSendManyInternal(wallet, options);
  const amount =
    options.sendMax === true
      ? build.baseCurrencyAmount - build.fee
      : totalAmount(options.outputs);
  return toSendResult(build, { amount, assetName });
}

export async function broadcastBuilt(
  wallet: Wallet,
  result: ISendResult,
): Promise<ISendResult> {
  if (!result.debug.signedTransaction) {
    throw new Error("No signed transaction to broadcast");
  }
  const txid = await broadcastSignedTransaction(
    wallet,
    result.debug.signedTransaction,
  );
  result.transactionId = txid;
  return result;
}
