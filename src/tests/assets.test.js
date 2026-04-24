const NeuraiWallet = require("../../dist/index.cjs");
const expect = require("chai").expect;
const crazyCatWalletPromise = require("./getWalletPromise");

const BUTTER_OWNER = "BUTTER!"; // owner token issued when BUTTER was created
const BUTTER = "BUTTER";

it("wallet.assets is a WalletAssets instance with queries", async () => {
  const wallet = await crazyCatWalletPromise;
  expect(wallet.assets).to.be.an("object");
  expect(wallet.assets.queries).to.be.an("object");
  expect(wallet.assets.issueRoot).to.be.a("function");
  expect(wallet.assets.reissue).to.be.a("function");
  expect(wallet.assets.freezeAddresses).to.be.a("function");
});

it("wallet.assets.queries.getAssetData returns metadata for BUTTER", async () => {
  const wallet = await crazyCatWalletPromise;
  const data = await wallet.assets.queries.getAssetData(BUTTER);
  expect(data).to.be.an("object");
  expect(data.name).to.equal(BUTTER);
});

it("wallet.assets.queries.assetExists is true for BUTTER", async () => {
  const wallet = await crazyCatWalletPromise;
  const exists = await wallet.assets.queries.assetExists(BUTTER);
  expect(exists).to.equal(true);
});

it("wallet.assets.queries.assetExists is false for an unlikely asset", async () => {
  const wallet = await crazyCatWalletPromise;
  const exists = await wallet.assets.queries.assetExists(
    "VERY_UNLIKELY_ASSET_NAME_123456",
  );
  expect(exists).to.equal(false);
});

it("Convenience shortcuts on Wallet delegate to wallet.assets", async () => {
  const wallet = await crazyCatWalletPromise;
  expect(wallet.issueRoot).to.be.a("function");
  expect(wallet.reissue).to.be.a("function");
  expect(wallet.tagAddresses).to.be.a("function");
  expect(wallet.freezeAddresses).to.be.a("function");
});
