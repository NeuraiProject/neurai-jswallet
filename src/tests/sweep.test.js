/**
 * Deterministic sweep tests (plan §4.2.5 / §4.2.6). The old version of this
 * file swallowed every exception against the public testnet proxy; these run
 * against an RPC stub and fail loudly.
 */
const { expect } = require("chai");
const NeuraiKeyModule = require("@neuraiproject/neurai-key");
const NeuraiKey = NeuraiKeyModule.default ?? NeuraiKeyModule;
const {
  createOfflineWallet,
  p2pkhScript,
  assetTransferScript,
  makeUtxo,
  makeStubRpc,
  assetOutputsOf,
  parseTransaction,
} = require("./markerTestUtils.js");

// Historic sweep-test key (testnet). The address it controls is derived, not
// hardcoded, so the fixture cannot drift.
const WIF = "cUVdRNVobgjAw5jGWYkvbWmk42Vxzvte4btmsZ5qSqszdPi9M3Vy";
const SWEPT_ADDRESS = NeuraiKey.getAddressByWIF("xna-test", WIF).address;

function sweptBaseUtxo() {
  return makeUtxo({
    address: SWEPT_ADDRESS,
    assetName: "XNA",
    script: p2pkhScript(SWEPT_ADDRESS),
    satoshis: 100_000_000, // 1 XNA — covers the 0.02 fixed sweep fee
    txid: "aa".repeat(32),
    index: 0,
  });
}

function sweptAssetUtxo(assetName, satoshis, txid, index) {
  return makeUtxo({
    address: SWEPT_ADDRESS,
    assetName,
    script: assetTransferScript(SWEPT_ADDRESS, assetName, BigInt(satoshis)),
    satoshis,
    txid,
    index,
  });
}

describe("sweep NIP-040 (§4.2.5–6)", () => {
  it("sweeps XNA + one asset with the node marker on the asset output", async () => {
    const wallet = await createOfflineWallet();
    const rpc = makeStubRpc({
      blockchainInfo: { asset_marker: "xna" },
      baseUtxos: [sweptBaseUtxo()],
      assetUtxos: [sweptAssetUtxo("SWEEPASSET", 300_000_000, "bb".repeat(32), 1)],
    });
    wallet.rpc = rpc;

    const result = await wallet.sweep(WIF, false);
    expect(result.errorDescription).to.equal(undefined);
    expect(result.rawTransaction).to.be.a("string");
    expect(result.transactionId).to.equal(undefined); // onlineMode false

    const outs = assetOutputsOf(result.rawTransaction);
    expect(outs).to.have.length(1);
    expect(outs[0].split.assetTransfer.assetName).to.equal("SWEEPASSET");
    expect(outs[0].split.assetTransfer.marker).to.equal("xna");
    expect(outs[0].split.assetTransfer.amountRaw).to.equal(300_000_000n);

    // Exactly one marker lookup for the whole sweep.
    expect(rpc.calls.getblockchaininfo).to.equal(1);

    // The XNA drain output exists and carries no asset wrapper.
    const allOutputs = parseTransaction(result.rawTransaction).outputs;
    expect(allOutputs.length - outs.length).to.equal(1);
  });

  it("sweeps several assets with the same marker on every asset output", async () => {
    const wallet = await createOfflineWallet();
    const rpc = makeStubRpc({
      blockchainInfo: { asset_marker: "xna" },
      baseUtxos: [sweptBaseUtxo()],
      assetUtxos: [
        sweptAssetUtxo("ASSETONE", 100_000_000, "bb".repeat(32), 1),
        sweptAssetUtxo("ASSETTWO", 200_000_000, "cc".repeat(32), 2),
      ],
    });
    wallet.rpc = rpc;

    const result = await wallet.sweep(WIF, false);
    const outs = assetOutputsOf(result.rawTransaction);
    expect(outs).to.have.length(2);
    const names = outs.map((o) => o.split.assetTransfer.assetName).sort();
    expect(names).to.deep.equal(["ASSETONE", "ASSETTWO"]);
    for (const o of outs) {
      expect(o.split.assetTransfer.marker).to.equal("xna");
    }
    expect(rpc.calls.getblockchaininfo).to.equal(1);
  });

  it("an XNA-only sweep never asks for the marker", async () => {
    const wallet = await createOfflineWallet();
    const rpc = makeStubRpc({
      blockchainInfo: { asset_marker: "xna" },
      baseUtxos: [sweptBaseUtxo()],
      assetUtxos: [],
    });
    wallet.rpc = rpc;

    const result = await wallet.sweep(WIF, false);
    expect(result.errorDescription).to.equal(undefined);
    expect(rpc.calls.getblockchaininfo ?? 0).to.equal(0);
    expect(assetOutputsOf(result.rawTransaction)).to.have.length(0);
  });

  it("the wallet override governs sweep asset outputs", async () => {
    const wallet = await createOfflineWallet({ assetMarker: "rvn" });
    const rpc = makeStubRpc({
      blockchainInfo: { asset_marker: "xna" },
      baseUtxos: [sweptBaseUtxo()],
      assetUtxos: [sweptAssetUtxo("SWEEPASSET", 300_000_000, "bb".repeat(32), 1)],
    });
    wallet.rpc = rpc;

    const result = await wallet.sweep(WIF, false);
    const outs = assetOutputsOf(result.rawTransaction);
    expect(outs).to.have.length(1);
    expect(outs[0].split.assetTransfer.marker).to.equal("rvn");
    expect(rpc.calls.getblockchaininfo ?? 0).to.equal(0);
  });

  it("reports an address without funds instead of throwing", async () => {
    const wallet = await createOfflineWallet();
    wallet.rpc = makeStubRpc({ baseUtxos: [], assetUtxos: [] });
    const result = await wallet.sweep(WIF, false);
    expect(result.errorDescription).to.include(SWEPT_ADDRESS);
  });
});
