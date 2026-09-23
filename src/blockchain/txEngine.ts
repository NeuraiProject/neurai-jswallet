import { assertMoneyRange, decimalToSatoshis, satoshisToDecimal, toRawInteger } from '@neuraiproject/neurai-create-transaction/amounts';
import type { DecimalAmount, RawAmount } from '../Types.js';
import Signer, {
  estimateVirtualSize,
  getAddressKind,
  getScriptKind,
} from "@neuraiproject/neurai-sign-transaction";
import { createPaymentTransaction, createStandardAssetTransferTransaction } from "@neuraiproject/neurai-create-transaction";
import type {
  TxInput,
  TxPaymentOutput,
} from "@neuraiproject/neurai-create-transaction";
import { Wallet } from "../neuraiWallet.js";
import { ChainType, IUTXO } from "../Types.js";
import { InsufficientFundsError } from "../Errors.js";
import { getSignerNetwork } from "../networks.js";

const DEFAULT_FEE_RATE_XNA_PER_KB = 0.05;

export const SATS_PER_XNA = 100_000_000;

// Minimum spendable change. Sub-dust outputs are rejected by the network.
// When a change output would land below the dust limit of its address,
// jswallet drops the output and the residual is absorbed by the miner as
// part of the implicit fee.
//
// The node's limit is dustRelayFee (3000 sat/kB) × (output size + size of the
// input that spends it) (policy.cpp GetDustThreshold / EstimateWitnessInputVBytes):
//   P2PKH                        34 + 148       → 546 sats
//   AuthScript v1 / PQ v2        43 + 41 + 936  → 3060 sats (ML-DSA-44 witness)
//   ECDSA v3                     43 + 41 + 28   → 336 sats
/** Dust limit of a P2PKH output (the historical constant). */
export const DUST_THRESHOLD_SATS = 546n;
const DUST_RELAY_FEE_SATS_PER_KB = 3000n;
const DUST_SIZE_BY_KIND: Record<string, bigint> = {
  p2pkh: 34n + 148n,
  authscript: 43n + 41n + 936n,
  pq: 43n + 41n + 936n,
  ecdsa: 43n + 41n + 28n,
};

/** Dust limit (sats) of an output paying `address`, as the node computes it. */
export function dustThresholdSats(address: string): bigint {
  const size = DUST_SIZE_BY_KIND[getAddressKind(address)] ?? DUST_SIZE_BY_KIND.p2pkh;
  return (size * DUST_RELAY_FEE_SATS_PER_KB) / 1000n;
}

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

/**
 * True for the addresses whose spend carries an ML-DSA-44 witness: generic
 * AuthScript v1 (`nc1p…`) and strict PQ v2 (`pq1z…`). `nq1…` is strict
 * ECDSA witness v3 since neurai-key 5 and returns false.
 */
export function isPQAddress(address: string): boolean {
  const kind = getAddressKind(address);
  return kind === "authscript" || kind === "pq";
}

/** True for UTXOs locked by `OP_1` / `OP_2` AuthScript programs. */
export function isPQUTXO(utxo: IUTXO): boolean {
  const kind = getScriptKind(utxo.script ?? "");
  return kind === "authscript" || kind === "pq";
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

export function feeSatsFromVbytes(vbytes: number, feeRate: DecimalAmount): bigint {
  if (!Number.isSafeInteger(vbytes) || vbytes < 0) throw new Error('Invalid transaction size');
  // RPC rates are XNA per 1,000 virtual bytes (CFeeRate::GetFeePerK).
  // Round upward: at most one satoshi above the node's integer truncation.
  return (BigInt(vbytes) * xnaToSats(feeRate) + 999n) / 1000n;
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

export function estimateSizeVbytes(
  inputs: IUTXO[],
  targets: Array<string | { address: string; assetName: string }>,
  network: ChainType = "xna",
): number {
  const payments = targets.filter((t): t is string => typeof t === 'string')
    .map(address => ({ address, valueSats: 0n }));
  const transfers = targets.filter((t): t is { address: string; assetName: string } => typeof t !== 'string')
    .map(t => ({ ...t, amountRaw: 0n }));
  const txInputs = utxosToTxInputs(inputs);
  // Amounts and marker contents do not affect size. Both supported markers
  // occupy three bytes. Serialize outputs to include asset payloads and varints.
  const raw = transfers.length
    ? createStandardAssetTransferTransaction({ inputs: txInputs, payments, transfers }).rawTx
    : createPaymentTransaction({ inputs: txInputs, payments }).rawTx;
  // The signer infers scripts from prevouts; its network argument does not
  // affect sizing. Dummy signatures provide a conservative pre-signing size.
  return estimateVirtualSize(getSignerNetwork(network), raw, inputs);
}

export async function getFeeRate(wallet: Wallet): Promise<DecimalAmount> {
  try {
    const confirmationTarget = 20;
    const response = (await wallet.rpc("estimatesmartfee", [
      confirmationTarget,
    ])) as { feerate?: DecimalAmount; errors?: string[] };
    if (response && !response.errors && (typeof response.feerate === "number" || typeof response.feerate === "string")) {
      if (xnaToSats(response.feerate) > 0n) return response.feerate;
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
  // The signer reads the input type from each prevout script; the network
  // only selects the chain (WIF version byte, NIP-025 rule).
  return Signer.sign(getSignerNetwork(network), rawTxHex, utxos, privateKeys as any);
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
