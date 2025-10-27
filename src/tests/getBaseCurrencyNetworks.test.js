const NeuraiWallet = require("../../dist/index.cjs");
const expect = require("chai").expect;
const getBaseCurrencyByNetwork =
  NeuraiWallet.default.getBaseCurrencyByNetwork;
it("getBaseCurrencyByNetwork", async () => {
  expect(getBaseCurrencyByNetwork("xna")).to.equal("XNA");
  expect(getBaseCurrencyByNetwork("xna-test")).to.equal("XNA");
});
