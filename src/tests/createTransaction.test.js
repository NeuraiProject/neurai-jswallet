const NeuraiWallet = require("../../dist/index.cjs");
const expect = require("chai").expect;
//Should have 10 XNA on testnet
const mnemonic =
  "salad hammer want used web finger comic gold trigger accident oblige pluck";

const walletPromise = NeuraiWallet.createInstance({
  mnemonic,
  network: "xna-test",
  offlineMode: true,
});

it("Transaction should have XNA fee", async () => {
  const options = {
    // Crazy Cat external[0] — any valid xna-test address that is not our change works
    toAddress: "tVJpKx3HhMMqp9tpok35py8am4uZqT1g6B",
    amount: 1,
  };
  const wallet = await walletPromise;
  const sendResult = await wallet.createTransaction(options);
  expect(sendResult.debug.fee).to.be.greaterThan(0);
  return true;
});
