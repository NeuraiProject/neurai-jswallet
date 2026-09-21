import { assertMoneyRange } from '@neuraiproject/neurai-create-transaction/amounts';
import type { DecimalAmount } from '../Types';
import NeuraiKey from "@neuraiproject/neurai-key";
import {
  createPaymentTransaction,
  createStandardAssetTransferTransaction,
  type TransferOutputParams,
  type TxPaymentOutput,
} from "@neuraiproject/neurai-create-transaction";

import { Wallet } from "../neuraiWallet";
import { ChainType, IUTXO, SweepResult } from "../Types";
import {
  broadcastSignedTransaction,
  satsToXna,
  signRawTransaction,
  utxosToTxInputs,
  estimateSizeVbytes,
  feeSatsFromVbytes,
  getFeeRate,
  DUST_THRESHOLD_SATS,
} from "./txEngine";

/**
 * Sweep all UTXOs (XNA + assets) held by `WIF` into the wallet's first
 * addresses. Sweeping PQ private keys is not supported.
 */
export async function sweep(
  WIF: string,
  wallet: Wallet,
  onlineMode: boolean,
): Promise<SweepResult> {
  if (wallet.network === "xna-pq" || wallet.network === "xna-pq-test") {
    throw new Error("Sweeping WIF private keys is not supported on PQ wallets");
  }

  const privateKey = NeuraiKey.getAddressByWIF(wallet.network, WIF);
  const result: SweepResult = {};
  const rpc = wallet.rpc;

  const baseCurrencyUTXOs = (await rpc("getaddressutxos", [
    { addresses: [privateKey.address] },
  ])) as IUTXO[];
  const assetUTXOs = (await rpc("getaddressutxos", [
    { addresses: [privateKey.address], assetName: "*" },
  ])) as IUTXO[];
  const UTXOs = assetUTXOs.concat(baseCurrencyUTXOs);
  result.UTXOs = UTXOs;

  if (UTXOs.length === 0) {
    result.errorDescription = `Address ${privateKey.address} has no funds`;
    return result;
  }

  // Total per asset (in satoshis)
  const balanceByAsset: Record<string, bigint> = {};
  for (const u of UTXOs) {
    balanceByAsset[u.assetName] = (balanceByAsset[u.assetName] ?? 0n) + assertMoneyRange(u.satoshis);
  }

  // Build outputs: each asset goes to a different wallet address
  const outputs: Record<string, DecimalAmount | { transfer: Record<string, DecimalAmount> }> =
    {};
  const transfers: TransferOutputParams[] = [];
  const payments: TxPaymentOutput[] = [];

  const targets = Object.keys(balanceByAsset).map((assetName, index) => {
    const address = wallet.getAddresses()[index];
    return assetName === wallet.baseCurrency ? address : { address, assetName };
  });
  const fee = feeSatsFromVbytes(estimateSizeVbytes(UTXOs, targets), await getFeeRate(wallet));
  if ((balanceByAsset[wallet.baseCurrency] ?? 0n) - fee < DUST_THRESHOLD_SATS) {
    result.errorDescription = 'Insufficient XNA to cover the sweep fee and a spendable output';
    return result;
  }

  Object.keys(balanceByAsset).forEach((assetName, index) => {
    const destination = wallet.getAddresses()[index];
    const amount = balanceByAsset[assetName];

    if (assetName === wallet.baseCurrency) {
      const sendAmount = assertMoneyRange(amount - fee);
      outputs[destination] = satsToXna(sendAmount);
      payments.push({
        address: destination,
        valueSats: sendAmount,
      });
    } else {
      outputs[destination] = { transfer: { [assetName]: satsToXna(amount) } };
      transfers.push({
        address: destination,
        assetName,
        amountRaw: balanceByAsset[assetName],
      });
    }
  });
  result.outputs = outputs;

  const inputs = utxosToTxInputs(UTXOs);
  // NIP-040: the marker lookup only happens when the sweep actually moves
  // assets; an XNA-only sweep stays marker-free.
  const built =
    transfers.length > 0
      ? createStandardAssetTransferTransaction({
          inputs,
          payments,
          transfers,
          assetMarker: await wallet.resolveAssetMarker(),
        })
      : createPaymentTransaction({ inputs, payments });

  const signedHex = signRawTransaction(
    wallet.network as ChainType,
    built.rawTx,
    UTXOs,
    { [privateKey.address]: WIF },
  );
  result.rawTransaction = signedHex;

  if (onlineMode === true) {
    result.transactionId = await broadcastSignedTransaction(wallet, signedHex);
  }

  return result;
}
