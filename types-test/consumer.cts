// CommonJS consumer: resolves the `require` condition (dist/index.d.cts).
// Every value export is used, so a missing declaration fails to compile.
import jswallet = require("@neuraiproject/neurai-jswallet");

const network: jswallet.ChainType = "xna-pq-strict";
const options: jswallet.IOptions = { mnemonic: jswallet.generateMnemonic(), network, offlineMode: true };
const valid: boolean = jswallet.isMnemonicValid(jswallet.entropyToMnemonic("00".repeat(16)));
export const created: Promise<jswallet.Wallet> = jswallet.createInstance(options);
export const viaDefault: Promise<jswallet.Wallet> = jswallet.default.createInstance(options);
export const base: string = jswallet.default.getBaseCurrencyByNetwork(network);
export const pq: string = jswallet.key.getPQAddress("xna-pq-test", options.mnemonic, 0, 0).address;
export const spk: Uint8Array = jswallet.scripts.encodeAuthScriptScriptPubKey(new Uint8Array(32), 2);
export type Result = jswallet.ISendResult | jswallet.AssetOpResult | jswallet.SweepResult;
export type Rpc = jswallet.RpcClient;
export function isWallet(value: unknown): value is jswallet.Wallet {
  return value instanceof jswallet.Wallet;
}
void valid;

// jswallet's CommonJS declarations reference neurai-key's own (not a copy),
// so a key derived through jswallet is the same type as neurai-key's.
import neuraiKey = require("@neuraiproject/neurai-key");
export const hdKey: neuraiKey.HDKey = jswallet.key.getHDKey("xna-legacy-test", options.mnemonic);
