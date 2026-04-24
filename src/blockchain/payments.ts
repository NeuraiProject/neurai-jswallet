import {
  createPaymentTransaction,
  createStandardAssetTransferTransaction,
  type TransferOutputParams,
  type TxPaymentOutput,
} from "@neuraiproject/neurai-create-transaction";

import { Wallet } from "../neuraiWallet";
import { ValidationError } from "../Errors";
import {
  ChainType,
  IForcedUTXO,
  ISendManyTransactionOptions,
  ISendResult,
  ITransactionOptions,
  IUTXO,
} from "../Types";
import {
  broadcastSignedTransaction,
  buildPrivateKeyMap,
  estimateSizeKB,
  loadSpendableFunds,
  selectUTXOs,
  shortenNumber,
  signRawTransaction,
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

  if (!outputs || Object.keys(outputs).length === 0) {
    throw new ValidationError("outputs is mandatory");
  }

  const forcedUTXOs = tagForcedUTXOs(options.forcedUTXOs);
  const { utxos: allUTXOs, feeRate } = await loadSpendableFunds(
    wallet,
    forcedUTXOs,
  );

  const amount = totalAmount(outputs);
  const transferring = isAssetTransfer(wallet, assetName);

  const changeAddressBaseCurrency =
    options.forcedChangeAddressBaseCurrency ||
    (await wallet.getChangeAddress());

  const toAddresses = Object.keys(outputs);
  if (toAddresses.includes(changeAddressBaseCurrency)) {
    throw new ValidationError(
      "Change address cannot be the same as to address",
    );
  }

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

  const sizeKb = estimateSizeKB(
    selectedUTXOs,
    transferring
      ? [...toAddresses, changeAddressBaseCurrency, changeAddressAsset]
      : [...toAddresses, changeAddressBaseCurrency],
  );
  const fee = sizeKb * feeRate;

  const baseCurrencySpent = transferring ? fee : amount + fee;
  const baseCurrencyAvailable = sumByAsset(
    baseCurrencyUTXOs,
    wallet.baseCurrency,
  );
  const baseCurrencyChange = shortenNumber(
    baseCurrencyAvailable - baseCurrencySpent,
  );

  // Compose the user-facing outputs object (mirrors the old SendManyTransaction shape)
  const totalOutputs: Record<string, number | { transfer: Record<string, number> }> = {};
  if (transferring) {
    totalOutputs[changeAddressBaseCurrency] = baseCurrencyChange;
    if (assetChange > 0) {
      totalOutputs[changeAddressAsset] = {
        transfer: { [assetName]: shortenNumber(assetChange) },
      };
    }
    for (const addy of toAddresses) {
      totalOutputs[addy] = { transfer: { [assetName]: outputs[addy] } };
    }
  } else {
    for (const addy of toAddresses) {
      totalOutputs[addy] = outputs[addy];
    }
    totalOutputs[changeAddressBaseCurrency] = baseCurrencyChange;
  }

  // Build the actual rawTx via neurai-create-transaction
  const inputs = utxosToTxInputs(selectedUTXOs);
  const network = wallet.network as ChainType;

  const rawTxHex = transferring
    ? buildAssetTransferRawTx(network, inputs, {
        toAddressAmounts: outputs,
        assetName,
        baseCurrencyChangeAddress: changeAddressBaseCurrency,
        baseCurrencyChange,
        assetChangeAddress: changeAddressAsset,
        assetChange: shortenNumber(assetChange),
      })
    : buildPaymentRawTx(network, inputs, totalOutputs as Record<string, number>);

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
    walletMempool,
  };
}

function buildPaymentRawTx(
  _network: ChainType,
  inputs: ReturnType<typeof utxosToTxInputs>,
  payments: Record<string, number>,
): string {
  const txPayments: TxPaymentOutput[] = Object.entries(payments).map(
    ([address, amountXna]) => ({
      address,
      valueSats: xnaToSats(amountXna),
    }),
  );
  const built = createPaymentTransaction({ inputs, payments: txPayments });
  return built.rawTx;
}

function buildAssetTransferRawTx(
  _network: ChainType,
  inputs: ReturnType<typeof utxosToTxInputs>,
  spec: {
    toAddressAmounts: Record<string, number>;
    assetName: string;
    baseCurrencyChangeAddress: string;
    baseCurrencyChange: number;
    assetChangeAddress: string;
    assetChange: number;
  },
): string {
  const transfers: TransferOutputParams[] = [];
  for (const [address, amount] of Object.entries(spec.toAddressAmounts)) {
    transfers.push({ address, assetName: spec.assetName, amountRaw: xnaToSats(amount) });
  }
  if (spec.assetChange > 0) {
    transfers.push({
      address: spec.assetChangeAddress,
      assetName: spec.assetName,
      amountRaw: xnaToSats(spec.assetChange),
    });
  }
  const payments: TxPaymentOutput[] = [];
  if (spec.baseCurrencyChange > 0) {
    payments.push({
      address: spec.baseCurrencyChangeAddress,
      valueSats: xnaToSats(spec.baseCurrencyChange),
    });
  }
  const built = createStandardAssetTransferTransaction({
    inputs,
    payments,
    transfers,
  });
  return built.rawTx;
}

function toSendResult(build: BuildResult, params: {
  amount: number;
  assetName: string;
  transactionId?: string | null;
}): ISendResult {
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
  if (!options.amount) throw Error("amount is mandatory");

  const assetName = options.assetName || wallet.baseCurrency;
  const build = await buildSendManyInternal(wallet, {
    wallet,
    assetName,
    outputs: { [options.toAddress]: options.amount },
    forcedChangeAddressAssets: (options as any).forcedChangeAddressAssets,
    forcedChangeAddressBaseCurrency: options.forcedChangeAddressBaseCurrency,
    forcedUTXOs: (options as any).forcedUTXOs,
  });
  return toSendResult(build, { amount: options.amount, assetName });
}

export async function createSendManyForOptions(
  wallet: Wallet,
  options: ISendManyTransactionOptions,
): Promise<ISendResult> {
  const assetName = options.assetName || wallet.baseCurrency;
  const build = await buildSendManyInternal(wallet, options);
  const amount = totalAmount(options.outputs);
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
