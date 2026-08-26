/**
 * RPC error-contract tests (plan §4.4), run end-to-end through the real
 * `@neuraiproject/neurai-rpc` >= 0.6 transport against local HTTP servers —
 * deterministic, no external network.
 *
 * Contract: every failure coming from the real RPC rejects as an `Error`
 * whose message names the RPC method and keeps the useful description, whose
 * `cause` holds the original rejection, and — when a numeric JSON-RPC code
 * exists — whose `code` property exposes it. HTTP/transport failures without
 * a JSON-RPC code never invent one.
 */
const http = require("http");
const { expect } = require("chai");
const { NeuraiWallet, MNEMONIC } = require("./markerTestUtils.js");

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port }),
    );
  });
}

function closeServer(server) {
  if (server.closeAllConnections) server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

async function walletFor(port, extra = {}) {
  return NeuraiWallet.createInstance({
    mnemonic: MNEMONIC,
    network: "xna-test",
    offlineMode: true,
    rpc_url: `http://127.0.0.1:${port}/`,
    ...extra,
  });
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  return null;
}

describe("RPC error contract (§4.4)", () => {
  it("JSON-RPC error over HTTP 200 → Error with method, message, code and cause", async () => {
    const { server, port } = await startServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          result: null,
          error: { code: -8, message: "Block height out of range" },
        }),
      );
    });
    try {
      const wallet = await walletFor(port);
      const err = await rejectionOf(wallet.getUTXOs());
      expect(err).to.be.an("error");
      expect(err.message).to.include("getaddressutxos");
      expect(err.message).to.include("Block height out of range");
      expect(err.code).to.equal(-8);
      expect(err.cause && err.cause.error && err.cause.error.code).to.equal(-8);
    } finally {
      await closeServer(server);
    }
  });

  it("JSON-RPC error mapped to HTTP 500 → Error keeps the JSON-RPC code", async () => {
    const { server, port } = await startServer((req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: -26, message: "txn-mempool-conflict" },
          description: "txn-mempool-conflict",
        }),
      );
    });
    try {
      const wallet = await walletFor(port);
      const err = await rejectionOf(wallet.getUTXOs());
      expect(err).to.be.an("error");
      expect(err.message).to.include("getaddressutxos");
      expect(err.message).to.include("txn-mempool-conflict");
      expect(err.code).to.equal(-26);
      expect(err.cause && err.cause.status).to.equal(500);
    } finally {
      await closeServer(server);
    }
  });

  it("HTTP error without JSON-RPC body → Error without an invented code", async () => {
    const { server, port } = await startServer((req, res) => {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("upstream down");
    });
    try {
      const wallet = await walletFor(port);
      const err = await rejectionOf(wallet.getUTXOs());
      expect(err).to.be.an("error");
      expect(err.message).to.include("getaddressutxos");
      expect(err.message).to.match(/HTTP 503/);
      expect(err).to.not.have.property("code");
      expect(err.cause && err.cause.status).to.equal(503);
    } finally {
      await closeServer(server);
    }
  });

  it("unreachable server → Error with ServerUnreachable cause and no code", async () => {
    // Grab a port that is guaranteed closed by binding and releasing it.
    const { server, port } = await startServer(() => {});
    await closeServer(server);

    const wallet = await walletFor(port);
    const err = await rejectionOf(wallet.getUTXOs());
    expect(err).to.be.an("error");
    expect(err.message).to.include("getaddressutxos");
    expect(err.message).to.include(
      "Could not communicate with Neurai core node",
    );
    expect(err).to.not.have.property("code");
    expect(err.cause && err.cause.type).to.equal("ServerUnreachable");
  });

  it("resolveAssetMarker is fail-closed through the real transport", async () => {
    const { server, port } = await startServer((req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: -32603, message: "internal error" },
          description: "internal error",
        }),
      );
    });
    try {
      const wallet = await walletFor(port);
      const err = await rejectionOf(wallet.resolveAssetMarker());
      expect(err).to.be.an("error");
      expect(err.message).to.include("getblockchaininfo");
      expect(err.code).to.equal(-32603);
    } finally {
      await closeServer(server);
    }
  });

  it("assetOps neither duplicates the message nor loses the code", async () => {
    const { server, port } = await startServer((req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { code: -26, message: "node exploded" },
          description: "node exploded",
        }),
      );
    });
    try {
      // Override skips the marker lookup so the first RPC that fails is the
      // asset flow's own getassetdata, wrapped by wallet.rpc AND by
      // createAssetRpc — the message must still carry a single context.
      const wallet = await walletFor(port, { assetMarker: "xna" });
      const err = await rejectionOf(
        wallet.assets.reissue({
          assetName: "TESTASSET",
          quantity: 1,
          broadcast: false,
        }),
      );
      expect(err).to.be.an("error");
      const occurrences =
        err.message.split("RPC getassetdata failed").length - 1;
      expect(occurrences).to.equal(1);
      expect(err.message).to.include("node exploded");
      expect(err.code).to.equal(-26);
    } finally {
      await closeServer(server);
    }
  });
});
