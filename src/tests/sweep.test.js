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
// hardcoded, so the fixture cannot drift. neurai-key 5: `xna-legacy-test` is
// the Legacy P2PKH address of the key, `xna-test` its ECDSA witness v3 one.
const WIF = "cUVdRNVobgjAw5jGWYkvbWmk42Vxzvte4btmsZ5qSqszdPi9M3Vy";
const SWEPT_ADDRESS = NeuraiKey.getAddressByWIF("xna-legacy-test", WIF).address;
const SWEPT_ECDSA_ADDRESS = NeuraiKey.getAddressByWIF("xna-test", WIF).address;
const { encodeDestinationScript } = require("@neuraiproject/neurai-create-transaction");
const ecdsaScript = Buffer.from(encodeDestinationScript(SWEPT_ECDSA_ADDRESS)).toString("hex");

function sweptBaseUtxo() {
  return makeUtxo({
    address: SWEPT_ADDRESS,
    assetName: "XNA",
    script: p2pkhScript(SWEPT_ADDRESS),
    satoshis: 100_000_000, // 1 XNA — covers the estimated sweep fee
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

  it("scales the sweep fee with the RPC rate and input count", async () => {
    const wallet = await createOfflineWallet();
    for (const count of [1, 12]) {
      const baseUtxos = Array.from({ length: count }, (_, index) => ({ ...sweptBaseUtxo(), outputIndex: index }));
      for (const rate of [0.01, 0.1]) {
        wallet.rpc = makeStubRpc({ baseUtxos, handlers: { estimatesmartfee: () => ({ feerate: rate }) } });
        const result = await wallet.sweep(WIF, false);
        const tx = parseTransaction(result.rawTransaction);
        const paid = BigInt(count) * 100000000n - tx.outputs.reduce((sum, o) => sum + o.valueSats, 0n);
        // Worst-case legacy signatures: 149 bytes per input, plus one output.
        expect(paid).to.equal(BigInt(10 + count * 149 + 34) * BigInt(rate * 100000));
        expect(wallet.rpc.calls.estimatesmartfee).to.equal(1);
        expect(wallet.rpc.calls.sendrawtransaction).to.equal(undefined);
      }
    }
  });

  it("reports insufficient XNA when only assets are available", async () => {
    const wallet = await createOfflineWallet();
    wallet.rpc = makeStubRpc({ assetUtxos: [sweptAssetUtxo("SWEEPASSET", 100000000, "bb".repeat(32), 0)] });
    const result = await wallet.sweep(WIF, false);
    expect(result.errorDescription).to.include("Insufficient XNA");
    expect(result.rawTransaction).to.equal(undefined);
  });

  it("reports an address without funds instead of throwing", async () => {
    const wallet = await createOfflineWallet();
    wallet.rpc = makeStubRpc({ baseUtxos: [], assetUtxos: [] });
    const result = await wallet.sweep(WIF, false);
    expect(result.errorDescription).to.include(SWEPT_ADDRESS);
    expect(result.errorDescription).to.include(SWEPT_ECDSA_ADDRESS);
  });

  it("looks up the Legacy and the ECDSA witness v3 address of the key", async () => {
    const wallet = await createOfflineWallet();
    const seen = [];
    wallet.rpc = makeStubRpc({
      baseUtxos: [],
      handlers: {
        getaddressutxos: ([query]) => {
          seen.push(query.addresses);
          return [];
        },
      },
    });
    await wallet.sweep(WIF, false);
    expect(SWEPT_ADDRESS.startsWith("t")).to.equal(true);
    expect(SWEPT_ECDSA_ADDRESS.startsWith("tnq1r")).to.equal(true);
    for (const addresses of seen) {
      expect(addresses).to.deep.equal([SWEPT_ADDRESS, SWEPT_ECDSA_ADDRESS]);
    }
  });

  it("sweeps funds held by the ECDSA witness v3 address with a strict witness", async () => {
    const wallet = await createOfflineWallet();
    wallet.rpc = makeStubRpc({
      baseUtxos: [
        sweptBaseUtxo(),
        makeUtxo({
          address: SWEPT_ECDSA_ADDRESS,
          assetName: "XNA",
          script: ecdsaScript,
          satoshis: 100_000_000,
          txid: "dd".repeat(32),
          index: 1,
        }),
      ],
    });
    const result = await wallet.sweep(WIF, false);
    expect(result.errorDescription).to.equal(undefined);
    const tx = parseTransaction(result.rawTransaction);
    expect(tx.inputs).to.have.length(2);
    const strictInput = tx.inputs.find((input) => input.txid === "dd".repeat(32));
    expect(strictInput.witness).to.have.length(4);
    expect(strictInput.witness[0]).to.equal("02");
    expect(strictInput.witness[3]).to.equal("51");
  });

  it("sweeps a WIF into PQ wallets too", async () => {
    for (const network of ["xna-pq-test", "xna-pq-strict-test", "xna-ecdsa-test"]) {
      const wallet = await createOfflineWallet({ network });
      wallet.rpc = makeStubRpc({ baseUtxos: [sweptBaseUtxo()] });
      const result = await wallet.sweep(WIF, false);
      expect(result.errorDescription, network).to.equal(undefined);
      const tx = parseTransaction(result.rawTransaction);
      const destination = wallet.getAddresses()[0];
      expect(tx.outputs[0].scriptPubKeyHex).to.equal(
        Buffer.from(encodeDestinationScript(destination)).toString("hex"),
      );
    }
  });
});
