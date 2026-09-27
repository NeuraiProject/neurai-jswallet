const { expect } = require("chai");
const http = require("node:http");
const NeuraiWallet = require("../../dist/index.cjs");

const MNEMONIC = "caught actress master salt kingdom february spot brief barrel apart rely common";

it("rejects the previous testnet genesis before address discovery", async () => {
  const calls = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      const { method } = JSON.parse(body);
      calls.push(method);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ result: "1".repeat(64), error: null }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    let failure;
    try {
      await NeuraiWallet.createInstance({
        mnemonic: MNEMONIC,
        network: "xna-test",
        rpc_url: `http://127.0.0.1:${server.address().port}/`,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).to.be.an("error");
    expect(failure.message).to.match(/Unexpected testnet genesis block/);
    expect(calls).to.deep.equal(["getblockhash"]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
