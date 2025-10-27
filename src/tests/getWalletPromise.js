const NeuraiWallet = require("../../dist/index.cjs");

//Account "Crazy Cat" on https://rpc-testnet.neurai.org/
const mnemonic =
  "mesh beef tuition ensure apart picture rabbit tomato ancient someone alter embrace";

const walletPromise = NeuraiWallet.createInstance({
  mnemonic,
  network: "xna-test",
});

module.exports = walletPromise;
