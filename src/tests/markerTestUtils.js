/**
 * Shared helpers for the deterministic NIP-040 / RPC-error suites.
 * No tests in this file — mocha loads it, nothing runs.
 */
const NeuraiWallet = require("../../dist/index.cjs");
const {
  parseTransaction,
  createPaymentTransaction,
  createStandardAssetTransferTransaction,
} = require("@neuraiproject/neurai-create-transaction");
const { splitAssetWrappedScriptPubKey } = require("@neuraiproject/neurai-scripts");

const MNEMONIC =
  "salad hammer want used web finger comic gold trigger accident oblige pluck";

async function createOfflineWallet(extra = {}) {
  return NeuraiWallet.createInstance({
    mnemonic: MNEMONIC,
    network: "xna-test",
    offlineMode: true,
    ...extra,
  });
}

/** P2PKH scriptPubKey for `address`, derived by building + parsing a tx. */
function p2pkhScript(address) {
  const raw = createPaymentTransaction({
    inputs: [{ txid: "00".repeat(32), vout: 0 }],
    payments: [{ address, valueSats: 1000n }],
  }).rawTx;
  return parseTransaction(raw).outputs[0].scriptPubKeyHex;
}

/**
 * Asset-wrapped P2PKH scriptPubKey (legacy `rvn` marker, like a pre-NIP-040
 * UTXO) transferring `amountRaw` of `assetName` to `address`.
 */
function assetTransferScript(address, assetName, amountRaw) {
  const raw = createStandardAssetTransferTransaction({
    inputs: [{ txid: "00".repeat(32), vout: 0 }],
    payments: [],
    transfers: [{ address, assetName, amountRaw }],
  }).rawTx;
  return parseTransaction(raw).outputs[0].scriptPubKeyHex;
}

function makeUtxo({ address, assetName, script, satoshis, txid, index }) {
  return {
    address,
    assetName,
    txid: txid ?? "11".repeat(32),
    outputIndex: index ?? 0,
    script,
    satoshis,
    value: satoshis / 1e8,
    height: 100,
  };
}

/**
 * Deterministic RPC stub. Counts calls per method on `rpc.calls`, throws on
 * any method it does not know so an unexpected lookup fails the test loudly.
 */
function makeStubRpc({
  blockchainInfo,
  baseUtxos = [],
  assetUtxos = [],
  handlers = {},
} = {}) {
  const calls = {};
  const rpc = async (method, params = []) => {
    calls[method] = (calls[method] ?? 0) + 1;
    if (handlers[method]) return handlers[method](params);
    switch (method) {
      case "getblockchaininfo":
        if (typeof blockchainInfo === "function") return blockchainInfo();
        return blockchainInfo;
      case "getaddressmempool":
        return [];
      case "estimatesmartfee":
        return { feerate: 0.05 };
      case "getaddressutxos": {
        const query = params[0] || {};
        const requested = new Set(query.addresses || []);
        const pool = query.assetName
          ? assetUtxos.filter(
              (u) => query.assetName === "*" || u.assetName === query.assetName,
            )
          : baseUtxos;
        return pool.filter(
          (u) => requested.size === 0 || requested.has(u.address),
        );
      }
      default:
        throw new Error(`Unexpected RPC method in stub: ${method}`);
    }
  };
  rpc.calls = calls;
  return rpc;
}

/**
 * Parse a raw (signed or unsigned) transaction and return only the outputs
 * that carry an asset-transfer wrapper, with the split payload attached.
 */
function assetOutputsOf(rawHex) {
  return parseTransaction(rawHex)
    .outputs.map((o) => ({
      valueSats: o.valueSats,
      script: o.scriptPubKeyHex,
      split: splitAssetWrappedScriptPubKey(o.scriptPubKeyHex),
    }))
    .filter((o) => o.split.assetTransfer !== null);
}

module.exports = {
  NeuraiWallet,
  MNEMONIC,
  createOfflineWallet,
  p2pkhScript,
  assetTransferScript,
  makeUtxo,
  makeStubRpc,
  assetOutputsOf,
  parseTransaction,
  createPaymentTransaction,
};
