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
  shortenNumber,
  signRawTransaction,
  utxosToTxInputs,
  xnaToSats,
} from "./txEngine";

const FIXED_FEE_XNA = 0.02; // pre-broadcast estimate; user pays this from XNA balance

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
  const balanceByAsset: Record<string, number> = {};
  for (const u of UTXOs) {
    balanceByAsset[u.assetName] = (balanceByAsset[u.assetName] ?? 0) + u.satoshis;
  }

  // Build outputs: each asset goes to a different wallet address
  const outputs: Record<string, number | { transfer: Record<string, number> }> =
    {};
  const transfers: TransferOutputParams[] = [];
  const payments: TxPaymentOutput[] = [];

  Object.keys(balanceByAsset).forEach((assetName, index) => {
    const destination = wallet.getAddresses()[index];
    const amount = balanceByAsset[assetName] / 1e8;

    if (assetName === wallet.baseCurrency) {
      const sendAmount = shortenNumber(amount - FIXED_FEE_XNA);
      outputs[destination] = sendAmount;
      payments.push({
        address: destination,
        valueSats: xnaToSats(sendAmount),
      });
    } else {
      outputs[destination] = { transfer: { [assetName]: amount } };
      transfers.push({
        address: destination,
        assetName,
        amountRaw: BigInt(balanceByAsset[assetName]),
      });
    }
  });
  result.outputs = outputs;

  const inputs = utxosToTxInputs(UTXOs);
  const built =
    transfers.length > 0
      ? createStandardAssetTransferTransaction({ inputs, payments, transfers })
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
