import { assertMoneyRange, decimalToSatoshis, satoshisToDecimal, toRawInteger } from '@neuraiproject/neurai-create-transaction/amounts';
import type { DecimalAmount, RawAmount } from '../Types';
import Signer from "@neuraiproject/neurai-sign-transaction";
import type {
  TxInput,
  TxPaymentOutput,
} from "@neuraiproject/neurai-create-transaction";
import { Wallet } from "../neuraiWallet";
import { ChainType, IUTXO } from "../Types";
import { InsufficientFundsError } from "../Errors";

const LEGACY_INPUT_VBYTES = 148;
const PQ_INPUT_VBYTES = 976;
const LEGACY_OUTPUT_BYTES = 34;
const PQ_OUTPUT_BYTES = 31;
const DEFAULT_FEE_RATE_XNA_PER_KB = 0.05;

export const SATS_PER_XNA = 100_000_000;

// Minimum spendable change. Sub-dust outputs are rejected by the network
// (standard 546 sats P2PKH dust threshold inherited from Bitcoin/Ravencoin).
// When a change output would land below this, jswallet drops the output
// and the residual is absorbed by the miner as part of the implicit fee.
export const DUST_THRESHOLD_SATS = 546n;

export function xnaToSats(xna: DecimalAmount): bigint {
  return assertMoneyRange(decimalToSatoshis(xna));
}

export function satsToXna(sats: RawAmount): DecimalAmount {
  const raw = toRawInteger(sats);
  const abs = raw < 0n ? -raw : raw;
  const text = satoshisToDecimal(raw);
  return abs <= BigInt(Number.MAX_SAFE_INTEGER) ||
    (abs % 100000000n === 0n && abs / 100000000n <= BigInt(Number.MAX_SAFE_INTEGER))
    ? (decimalToSatoshis(String(Number(text))) === raw ? Number(text) : text) : text;
}

export function isPQAddress(address: string): boolean {
  return address.startsWith("nq1") || address.startsWith("tnq1");
}

export function isPQUTXO(utxo: IUTXO): boolean {
  return utxo.script?.startsWith("5120") === true;
}

export function utxoKey(utxo: { txid: string; outputIndex: number }): string {
  return `${utxo.txid}:${utxo.outputIndex}`;
}

export function buildUTXOMap(utxos: IUTXO[]): Map<string, IUTXO> {
  return new Map(utxos.map((u) => [utxoKey(u), u]));
}

export function selectAllUTXOsByAsset(
  utxos: IUTXO[],
  assetName: string,
): IUTXO[] {
  const result: IUTXO[] = [];
  for (const u of utxos) {
    if (u.assetName !== assetName) continue;
    if (toRawInteger(u.satoshis) === 0n) continue;
    result.push(u);
  }
  return result;
}

export function sumUTXOSatoshis(
  utxos: IUTXO[],
  assetName: string,
): bigint {
  let sum = 0n;
  for (const u of utxos) {
    if (u.assetName !== assetName) continue;
    sum += assertMoneyRange(u.satoshis, 'UTXO satoshis');
  }
  return sum;
}

export function feeSatsFromSize(sizeKb: number, feeRate: DecimalAmount): bigint {
  // Size estimator returns bytes / 1024. Round the fee upward to a raw unit.
  const bytes = Math.round(sizeKb * 1024);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid transaction size');
  const rateSats = xnaToSats(feeRate);
  return (BigInt(bytes) * rateSats + 1023n) / 1024n;
}

export function selectUTXOs(
  utxos: IUTXO[],
  assetName: string,
  amount: DecimalAmount,
): IUTXO[] {
  const result: IUTXO[] = [];
  let sum = 0n;
  const required = xnaToSats(amount);

  // Forced UTXOs always go in first
  for (const u of utxos) {
    if (u.forced === true && u.assetName === assetName) {
      result.push(u);
      sum += assertMoneyRange(u.satoshis, 'UTXO satoshis');
    }
  }

  for (const u of utxos) {
    if (u.forced === true) continue;
    if (u.assetName !== assetName) continue;
    if (toRawInteger(u.satoshis) === 0n) continue;
    if (sum >= required) break;
    result.push(u);
    sum += assertMoneyRange(u.satoshis, 'UTXO satoshis');
  }

  if (sum < required) {
    throw new InsufficientFundsError(
      `You do not have ${amount} ${assetName} you only have ${satsToXna(sum)}`,
    );
  }
  return result;
}

export function estimateSizeKB(
  inputs: IUTXO[],
  outputAddresses: string[],
): number {
  const hasPQInputs = inputs.some(isPQUTXO);
  const baseSize = hasPQInputs ? 12 : 10;
  const inputBytes = inputs.reduce(
    (t, u) => t + (isPQUTXO(u) ? PQ_INPUT_VBYTES : LEGACY_INPUT_VBYTES),
    0,
  );
  const outputBytes = outputAddresses.reduce(
    (t, a) => t + (isPQAddress(a) ? PQ_OUTPUT_BYTES : LEGACY_OUTPUT_BYTES),
    0,
  );
  return (baseSize + inputBytes + outputBytes) / 1024;
}

export async function getFeeRate(wallet: Wallet): Promise<DecimalAmount> {
  try {
    const confirmationTarget = 20;
    const response = (await wallet.rpc("estimatesmartfee", [
      confirmationTarget,
    ])) as { feerate?: DecimalAmount; errors?: string[] };
    if (response && !response.errors && (typeof response.feerate === "number" || typeof response.feerate === "string")) {
      xnaToSats(response.feerate);
      return response.feerate;
    }
  } catch {
    // Falls through to default
  }
  return DEFAULT_FEE_RATE_XNA_PER_KB;
}

export function utxosToTxInputs(utxos: IUTXO[]): TxInput[] {
  return utxos.map((u) => ({ txid: u.txid, vout: u.outputIndex }));
}

export function paymentsToTxOutputs(
  payments: Record<string, DecimalAmount>,
): TxPaymentOutput[] {
  return Object.entries(payments).map(([address, amountXna]) => ({
    address,
    valueSats: xnaToSats(amountXna),
  }));
}

export function buildPrivateKeyMap(
  wallet: Wallet,
  utxos: IUTXO[],
  forcedExtras: Array<{ address: string; privateKey: unknown }> = [],
): Record<string, unknown> {
  const keys: Record<string, unknown> = {};
  for (const u of utxos) {
    const material = wallet.getPrivateKeyByAddress(u.address);
    if (material) keys[u.address] = material;
  }
  for (const f of forcedExtras) {
    keys[f.address] = f.privateKey;
  }
  return keys;
}

export function signRawTransaction(
  network: ChainType,
  rawTxHex: string,
  utxos: IUTXO[],
  privateKeys: Record<string, unknown>,
): string {
  return Signer.sign(network, rawTxHex, utxos, privateKeys);
}

export async function broadcastSignedTransaction(
  wallet: Wallet,
  signedHex: string,
): Promise<string> {
  return (await wallet.rpc("sendrawtransaction", [signedHex])) as string;
}

export interface LoadedFunds {
  utxos: IUTXO[];
  feeRate: DecimalAmount;
}

/**
 * Load all spendable UTXOs (XNA + assets, including unspent mempool entries)
 * plus the current fee rate. Mirrors the discovery the old SendManyTransaction
 * did during loadData(), centralised so any builder can reuse it.
 */
export async function loadSpendableFunds(
  wallet: Wallet,
  forcedUTXOs: IUTXO[] = [],
): Promise<LoadedFunds> {
  const [mempool, assetUTXOs, baseUTXOs, feeRate] = await Promise.all([
    wallet.getMempool(),
    wallet.getAssetUTXOs(),
    wallet.getUTXOs(),
    getFeeRate(wallet),
  ]);

  const mempoolUTXOs = await wallet.getUTXOsInMempool(mempool);
  const all = [...forcedUTXOs, ...assetUTXOs, ...baseUTXOs, ...mempoolUTXOs];

  // Drop UTXOs already being spent in the mempool (unless forced)
  const filtered = all.filter((u) => {
    if (u.forced === true) return true;
    return !mempool.find(
      (m) => m.prevtxid === u.txid && m.prevout === u.outputIndex,
    );
  });

  // Deduplicate by txid:vout (forced UTXOs were unshifted first so they win)
  const seen = new Set<string>();
  const unique: IUTXO[] = [];
  for (const u of filtered) {
    const k = utxoKey(u);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(u);
  }
  return { utxos: unique, feeRate };
}
