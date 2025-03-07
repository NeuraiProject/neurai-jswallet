const NeuraiWallet = require("../../dist/index.cjs");
const expect = require("chai").expect;
it("Test UTXOs for assets and base currency", async () => {
  const mnemonic =
    "mesh beef tuition ensure apart picture rabbit tomato ancient someone alter embrace";

  const network = "xna-test";
  const wallet = await NeuraiWallet.createInstance({
    mnemonic,
    network,
  });

  const UTXOs = await wallet.getUTXOs();
  expect(UTXOs.length).to.be.at.least(1);

  const assetUTXOs = await wallet.getAssetUTXOs();
  expect(assetUTXOs.length).to.be.at.least(1);

  const assetDoesNotExistUTXOs = await wallet.getAssetUTXOs("AIXNEHXO");
  expect(assetDoesNotExistUTXOs.length).to.equal(0);
});
