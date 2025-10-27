const NeuraiWallet = require("../../dist/index.cjs");
const expect = require("chai").expect;
//Account "Crazy Cat" on https://rpc-testnet.neurai.org/
const mnemonic =
  "mesh beef tuition ensure apart picture rabbit tomato ancient someone alter embrace";

const walletPromise = NeuraiWallet.createInstance({
  mnemonic,
  network: "xna-test",
  offlineMode: true,
});

it("Send asset we do not have", async () => {
  const options = {
    assetName: "FREN#RED", //Asset we do not have;
    toAddress: "mmmjadMR4LkmHjg7VHQSj3hyp9NjWidzT9",
    amount: 1,
  };
  const wallet = await walletPromise;

  let error = null;
  try {
    //const asdf = await wallet.createTransaction(options);

    const result = await wallet.send(options);
  } catch (e) {
    error = e;
  }

  expect(error.name).to.equal("InsufficientFundsError");
});
