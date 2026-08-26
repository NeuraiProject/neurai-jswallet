/**
 * Deterministic NIP-040 tests (plan §4.1 resolver, §4.2 payments).
 * Everything runs against an RPC stub — no network.
 */
const { expect } = require("chai");
const {
  NeuraiWallet,
  MNEMONIC,
  createOfflineWallet,
  p2pkhScript,
  assetTransferScript,
  makeUtxo,
  makeStubRpc,
  assetOutputsOf,
} = require("./markerTestUtils.js");

// Crazy Cat external[0] — valid xna-test address outside our test wallet.
const RECIPIENT = "tVJpKx3HhMMqp9tpok35py8am4uZqT1g6B";

async function walletWithStub({ blockchainInfo, override, handlers } = {}) {
  const wallet = await createOfflineWallet(
    override ? { assetMarker: override } : {},
  );
  const addr = wallet.getAddresses()[0];
  const baseUtxos = [
    makeUtxo({
      address: addr,
      assetName: "XNA",
      script: p2pkhScript(addr),
      satoshis: 100_000_000,
      txid: "aa".repeat(32),
      index: 0,
    }),
  ];
  const assetUtxos = [
    makeUtxo({
      address: addr,
      assetName: "TESTASSET",
      script: assetTransferScript(addr, "TESTASSET", 500_000_000n),
      satoshis: 500_000_000,
      txid: "bb".repeat(32),
      index: 1,
    }),
  ];
  const rpc = makeStubRpc({ blockchainInfo, baseUtxos, assetUtxos, handlers });
  wallet.rpc = rpc;
  return { wallet, rpc };
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  return null;
}

describe("NIP-040 resolveAssetMarker (§4.1)", () => {
  it("override 'xna' wins and never calls the RPC", async () => {
    const { wallet, rpc } = await walletWithStub({
      override: "xna",
      blockchainInfo: { asset_marker: "rvn" },
    });
    expect(await wallet.resolveAssetMarker()).to.equal("xna");
    expect(rpc.calls.getblockchaininfo ?? 0).to.equal(0);
  });

  it("override 'rvn' wins and never calls the RPC", async () => {
    const { wallet, rpc } = await walletWithStub({
      override: "rvn",
      blockchainInfo: { asset_marker: "xna" },
    });
    expect(await wallet.resolveAssetMarker()).to.equal("rvn");
    expect(rpc.calls.getblockchaininfo ?? 0).to.equal(0);
  });

  it("returns the node's marker ('xna' and 'rvn')", async () => {
    const xna = await walletWithStub({ blockchainInfo: { asset_marker: "xna" } });
    expect(await xna.wallet.resolveAssetMarker()).to.equal("xna");
    expect(xna.rpc.calls.getblockchaininfo).to.equal(1);

    const rvn = await walletWithStub({ blockchainInfo: { asset_marker: "rvn" } });
    expect(await rvn.wallet.resolveAssetMarker()).to.equal("rvn");
  });

  it("falls back to 'rvn' only when the field is absent or null", async () => {
    const absent = await walletWithStub({ blockchainInfo: { chain: "test" } });
    expect(await absent.wallet.resolveAssetMarker()).to.equal("rvn");

    const asNull = await walletWithStub({
      blockchainInfo: { asset_marker: null },
    });
    expect(await asNull.wallet.resolveAssetMarker()).to.equal("rvn");
  });

  it("rejects an unknown node value", async () => {
    const { wallet } = await walletWithStub({
      blockchainInfo: { asset_marker: "btc" },
    });
    const err = await rejectionOf(wallet.resolveAssetMarker());
    expect(err).to.be.an("error");
    expect(err.message).to.match(/unknown getblockchaininfo\.asset_marker/);
  });

  it("fail-closed: an RPC rejection propagates as Error, never as 'rvn'", async () => {
    const { wallet } = await walletWithStub({
      handlers: {
        getblockchaininfo: () => {
          // Raw neurai-rpc >= 0.5 rejection shape (not an Error instance).
          throw {
            error: { code: -32603, message: "server error" },
            description: "server error",
          };
        },
      },
    });
    const err = await rejectionOf(wallet.resolveAssetMarker());
    expect(err).to.be.an("error");
    expect(err.message).to.include("getblockchaininfo");
    expect(err.message).to.include("server error");
    expect(err.code).to.equal(-32603);
  });

  it("no cache: two asset builds ask the node twice", async () => {
    const { wallet, rpc } = await walletWithStub({
      blockchainInfo: { asset_marker: "xna" },
    });
    await wallet.createTransaction({
      toAddress: RECIPIENT,
      amount: 1,
      assetName: "TESTASSET",
    });
    await wallet.createTransaction({
      toAddress: RECIPIENT,
      amount: 1,
      assetName: "TESTASSET",
    });
    expect(rpc.calls.getblockchaininfo).to.equal(2);
  });

  it("re-initialising without an override clears the previous one", async () => {
    const { wallet } = await walletWithStub({
      override: "xna",
      blockchainInfo: { asset_marker: "rvn" },
    });
    expect(wallet.assetMarker).to.equal("xna");
    await wallet.init({
      mnemonic: MNEMONIC,
      network: "xna-test",
      offlineMode: true,
    });
    expect(wallet.assetMarker).to.equal(undefined);
  });

  it("createInstance rejects an invalid assetMarker option", async () => {
    const err = await rejectionOf(
      NeuraiWallet.createInstance({
        mnemonic: MNEMONIC,
        network: "xna-test",
        offlineMode: true,
        assetMarker: "banana",
      }),
    );
    expect(err).to.be.an("error");
    expect(err.message).to.match(/Invalid options\.assetMarker/);
  });

  it("an invalid override set directly still rejects at resolve time", async () => {
    const { wallet } = await walletWithStub({});
    wallet.assetMarker = "banana";
    const err = await rejectionOf(wallet.resolveAssetMarker());
    expect(err).to.be.an("error");
    expect(err.message).to.match(/Invalid assetMarker override/);
  });
});

describe("NIP-040 payments (§4.2)", () => {
  it("asset send stamps the node marker ('xna') on every asset output", async () => {
    const { wallet, rpc } = await walletWithStub({
      blockchainInfo: { asset_marker: "xna" },
    });
    const res = await wallet.createTransaction({
      toAddress: RECIPIENT,
      amount: 1,
      assetName: "TESTASSET",
    });
    const outs = assetOutputsOf(res.debug.rawUnsignedTransaction);
    // recipient + asset change (5 − 1 = 4)
    expect(outs).to.have.length(2);
    for (const o of outs) {
      expect(o.split.assetTransfer.marker).to.equal("xna");
      expect(o.split.assetTransfer.assetName).to.equal("TESTASSET");
    }
    expect(rpc.calls.getblockchaininfo).to.equal(1);
    // The transaction is also signable with those wrapped inputs.
    expect(res.debug.signedTransaction).to.be.a("string");
    expect(res.debug.signedTransaction.length).to.be.greaterThan(0);
  });

  it("a node without the field produces legacy 'rvn' outputs", async () => {
    const { wallet } = await walletWithStub({
      blockchainInfo: { chain: "test" },
    });
    const res = await wallet.createTransaction({
      toAddress: RECIPIENT,
      amount: 1,
      assetName: "TESTASSET",
    });
    const outs = assetOutputsOf(res.debug.rawUnsignedTransaction);
    expect(outs).to.have.length(2);
    for (const o of outs) {
      expect(o.split.assetTransfer.marker).to.equal("rvn");
    }
  });

  it("the wallet override beats a contrary node answer (both directions)", async () => {
    const rvnWins = await walletWithStub({
      override: "rvn",
      blockchainInfo: { asset_marker: "xna" },
    });
    const resRvn = await rvnWins.wallet.createTransaction({
      toAddress: RECIPIENT,
      amount: 1,
      assetName: "TESTASSET",
    });
    for (const o of assetOutputsOf(resRvn.debug.rawUnsignedTransaction)) {
      expect(o.split.assetTransfer.marker).to.equal("rvn");
    }
    expect(rvnWins.rpc.calls.getblockchaininfo ?? 0).to.equal(0);

    const xnaWins = await walletWithStub({
      override: "xna",
      blockchainInfo: { asset_marker: "rvn" },
    });
    const resXna = await xnaWins.wallet.createTransaction({
      toAddress: RECIPIENT,
      amount: 1,
      assetName: "TESTASSET",
    });
    for (const o of assetOutputsOf(resXna.debug.rawUnsignedTransaction)) {
      expect(o.split.assetTransfer.marker).to.equal("xna");
    }
    expect(xnaWins.rpc.calls.getblockchaininfo ?? 0).to.equal(0);
  });

  it("a pure XNA payment never asks for the marker", async () => {
    const { wallet, rpc } = await walletWithStub({
      blockchainInfo: { asset_marker: "xna" },
    });
    const res = await wallet.createTransaction({
      toAddress: RECIPIENT,
      amount: 0.1,
    });
    expect(rpc.calls.getblockchaininfo ?? 0).to.equal(0);
    expect(assetOutputsOf(res.debug.rawUnsignedTransaction)).to.have.length(0);
  });

  it("sendMany stamps the same marker on all asset outputs", async () => {
    const other = await NeuraiWallet.createInstance({
      mnemonic:
        "mesh beef tuition ensure apart picture rabbit tomato ancient someone alter embrace",
      network: "xna-test",
      offlineMode: true,
    });
    const [r1, , r2] = other.getAddresses();

    const { wallet } = await walletWithStub({
      blockchainInfo: { asset_marker: "xna" },
    });
    const res = await wallet.createSendManyTransaction({
      assetName: "TESTASSET",
      outputs: { [r1]: 1, [r2]: 2 },
    });
    const outs = assetOutputsOf(res.debug.rawUnsignedTransaction);
    // two recipients + asset change (5 − 3 = 2)
    expect(outs).to.have.length(3);
    for (const o of outs) {
      expect(o.split.assetTransfer.marker).to.equal("xna");
      expect(o.split.assetTransfer.assetName).to.equal("TESTASSET");
    }
  });
});
