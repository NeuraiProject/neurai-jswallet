import { assertMoneyRange } from '@neuraiproject/neurai-create-transaction/amounts';
import type { DecimalAmount } from '../Types.js';
import NeuraiKey from "@neuraiproject/neurai-key";
import {
  createPaymentTransaction,
  createStandardAssetTransferTransaction,
  type TransferOutputParams,
  type TxPaymentOutput,
} from "@neuraiproject/neurai-create-transaction";

import { Wallet } from "../neuraiWallet.js";
import { ChainType, IUTXO, SweepResult } from "../Types.js";
import {
  broadcastSignedTransaction,
  satsToXna,
  signRawTransaction,
  utxosToTxInputs,
  estimateSizeVbytes,
  feeSatsFromVbytes,
  getFeeRate,
  dustThresholdSats,
} from "./txEngine.js";
import { getECDSAKeyNetwork, getLegacyKeyNetwork } from "../networks.js";

/**
 * Addresses a secp256k1 WIF can hold funds on: its Legacy P2PKH address and,
 * for a compressed key, its strict ECDSA witness v3 address (neurai-key 5
 * `xna` / `xna-test`). The chain of the wallet selects the WIF version byte.
 */
function sweepableAddresses(WIF: string, wallet: Wallet): string[] {
  const addresses = [NeuraiKey.getAddressByWIF(getLegacyKeyNetwork(wallet.network), WIF).address];
  try {
    addresses.push(NeuraiKey.getAddressByWIF(getECDSAKeyNetwork(wallet.network), WIF).address);
  } catch {
    // Uncompressed WIF: no ECDSA witness v3 address.
  }
  return addresses;
}

/**
 * Sweep all UTXOs (XNA + assets) held by `WIF` into the wallet's first
 * addresses. The WIF is a secp256k1 key: its Legacy P2PKH address and its
 * ECDSA witness v3 address are swept together. Any wallet network can be the
 * destination, PQ ones included.
 */
export async function sweep(
  WIF: string,
  wallet: Wallet,
  onlineMode: boolean,
): Promise<SweepResult> {
  const fromAddresses = sweepableAddresses(WIF, wallet);
  const result: SweepResult = {};
  const rpc = wallet.rpc;
  result.fromAddress = fromAddresses[0];

  const baseCurrencyUTXOs = (await rpc("getaddressutxos", [
    { addresses: fromAddresses },
  ])) as IUTXO[];
  const assetUTXOs = (await rpc("getaddressutxos", [
    { addresses: fromAddresses, assetName: "*" },
  ])) as IUTXO[];
  const UTXOs = assetUTXOs.concat(baseCurrencyUTXOs);
  result.UTXOs = UTXOs;

  if (UTXOs.length === 0) {
    result.errorDescription = `Address ${fromAddresses.join(" / ")} has no funds`;
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
  const fee = feeSatsFromVbytes(estimateSizeVbytes(UTXOs, targets, wallet.network), await getFeeRate(wallet));
  const baseIndex = Object.keys(balanceByAsset).indexOf(wallet.baseCurrency);
  const baseDestination = wallet.getAddresses()[Math.max(baseIndex, 0)];
  if ((balanceByAsset[wallet.baseCurrency] ?? 0n) - fee < dustThresholdSats(baseDestination)) {
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
    Object.fromEntries(fromAddresses.map((address) => [address, WIF])),
  );
  result.rawTransaction = signedHex;

  if (onlineMode === true) {
    result.transactionId = await broadcastSignedTransaction(wallet, signedHex);
  }

  return result;
}
