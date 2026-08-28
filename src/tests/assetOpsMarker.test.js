/**
 * Deterministic NIP-040 tests for wallet.assets.* (plan §4.3).
 *
 * The marker the wallet resolves travels as `config.assetMarker` into
 * `neurai-assets` and governs the reconstruction metadata
 * `result.raw.localRawBuild.params.assetMarker`.
 *
 * Where the broadcast raw comes from depends on the operation, and REISSUE
 * changed in `neurai-assets` 1.5.0. The node's `createrawtransaction` has no
 * units field in its `reissue` object, so it assumes 0 and refuses any asset
 * whose units are above zero. Since 1.5.0 the two reissue operations skip that
 * RPC and build the raw with `createFromOperation`, reporting
 * `buildStrategy: 'local-builder'`.
 *
 * That inverts the old invariant these tests pinned: for reissue the resolved
 * marker now DOES govern the broadcast raw, and it must — the chain rejects
 * the legacy marker past NIP-040 activation. Operations still built by the
 * node keep carrying the marker the node chose.
 */
const { expect } = require("chai");
const {
  createOfflineWallet,
  p2pkhScript,
  assetTransferScript,
  makeUtxo,
  makeStubRpc,
  createPaymentTransaction,
} = require("./markerTestUtils.js");

async function reissueFixture({ override, blockchainInfo } = {}) {
  const wallet = await createOfflineWallet(
    override ? { assetMarker: override } : {},
  );
  const addr0 = wallet.getAddresses()[0];

  const xnaUtxo = makeUtxo({
    address: addr0,
    assetName: "XNA",
    script: p2pkhScript(addr0),
    satoshis: 5_000_000_000_000, // 50 000 XNA — covers reissue burn + fee
    txid: "cc".repeat(32),
    index: 0,
  });
  const ownerUtxo = makeUtxo({
    address: addr0,
    assetName: "TESTASSET!",
    script: assetTransferScript(addr0, "TESTASSET!", 100_000_000n),
    satoshis: 100_000_000,
    txid: "dd".repeat(32),
    index: 1,
  });

  let nodeRawTx = null;
  const rpc = makeStubRpc({
    blockchainInfo,
    baseUtxos: [xnaUtxo],
    assetUtxos: [ownerUtxo],
    handlers: {
      getassetdata: () => ({
        amount: 1000,
        reissuable: 1,
        units: 0,
        has_ipfs: 0,
      }),
      // Reissue must NOT reach this RPC any more: if it does, the library
      // regressed to the node path that cannot express "keep the units".
      createrawtransaction: (params) => {
        const inputs = (params[0] || []).map((i) => ({
          txid: i.txid,
          vout: i.vout,
        }));
        const addr = wallet.getAddresses()[0];
        nodeRawTx = createPaymentTransaction({
          inputs,
          payments: [{ address: addr, valueSats: 1000n }],
        }).rawTx;
        return nodeRawTx;
      },
    },
  });
  wallet.rpc = rpc;
  return { wallet, rpc, getNodeRawTx: () => nodeRawTx };
}

describe("wallet.assets.* NIP-040 (§4.3)", () => {
  it("without override: one node lookup, marker lands in localRawBuild metadata", async () => {
    const { wallet, rpc, getNodeRawTx } = await reissueFixture({
      blockchainInfo: { asset_marker: "xna" },
    });
    const res = await wallet.assets.reissue({
      assetName: "TESTASSET",
      quantity: 10,
      broadcast: false,
    });

    expect(res.raw.localRawBuild.params.assetMarker).to.equal("xna");
    // Exactly one lookup: the wallet resolver. neurai-assets received the
    // value via config and must not ask the node again (§4.3.4).
    expect(rpc.calls.getblockchaininfo).to.equal(1);
    // Reissue is built locally since neurai-assets 1.5.0, so the node's
    // createrawtransaction is never reached and the raw carries the marker
    // the wallet resolved.
    expect(res.raw.buildStrategy).to.equal("local-builder");
    expect(getNodeRawTx()).to.equal(null);
    expect(res.rawTx).to.be.a("string").and.not.equal("");
    expect(res.rawTx).to.contain(Buffer.from("xna", "ascii").toString("hex"));
    expect(res.signedTransaction).to.be.a("string");
    expect(res.transactionId).to.equal(null); // broadcast: false
  });

  it("with override: no node lookup, override reaches the metadata via config", async () => {
    const { wallet, rpc } = await reissueFixture({
      override: "xna",
      blockchainInfo: { asset_marker: "rvn" },
    });
    const res = await wallet.assets.reissue({
      assetName: "TESTASSET",
      quantity: 10,
      broadcast: false,
    });
    expect(res.raw.localRawBuild.params.assetMarker).to.equal("xna");
    expect(rpc.calls.getblockchaininfo ?? 0).to.equal(0);
  });

  it("an assetMarker injected in operation params is stripped by _exec (§4.3.5)", async () => {
    const { wallet, rpc } = await reissueFixture({
      override: "xna",
      blockchainInfo: { asset_marker: "rvn" },
    });
    const res = await wallet.assets.reissue({
      assetName: "TESTASSET",
      quantity: 10,
      broadcast: false,
      // Without the strip, neurai-assets' params > config precedence would
      // let this bypass IOptions.assetMarker.
      assetMarker: "rvn",
    });
    expect(res.raw.localRawBuild.params.assetMarker).to.equal("xna");
    expect(rpc.calls.getblockchaininfo ?? 0).to.equal(0);
  });

  it("an invalid override rejects before any raw transaction is produced (§4.3.3)", async () => {
    const { wallet, rpc } = await reissueFixture({
      blockchainInfo: { asset_marker: "xna" },
    });
    wallet.assetMarker = "banana";
    let err = null;
    try {
      await wallet.assets.reissue({
        assetName: "TESTASSET",
        quantity: 10,
        broadcast: false,
      });
    } catch (e) {
      err = e;
    }
    expect(err).to.be.an("error");
    expect(err.message).to.match(/Invalid assetMarker override/);
    expect(rpc.calls.createrawtransaction ?? 0).to.equal(0);
  });
});
