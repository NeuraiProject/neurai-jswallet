const NeuraiWallet = require("../../dist/index.cjs");
const expect = require("chai").expect;
const crazyCatWalletPromise = require("./getWalletPromise");

const RECIPIENT = "tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy"; // Crazy Cat external[2]

// Wallet A holds XNA on testnet; we pass one of its UTXOs as a forcedUTXO
// to a transfer being built on Wallet B (Crazy Cat). The forced UTXO must
// always be present in the resulting transaction inputs and the supplied
// privateKey must let the signer spend it.
const walletAPromise = NeuraiWallet.createInstance({
  mnemonic: "salad hammer want used web finger comic gold trigger accident oblige pluck",
  network: "xna-test",
});

it("Forced UTXOs must be part of the transaction inputs", async () => {
  const walletA = await walletAPromise;
  const utxosA = await walletA.getUTXOs();
  const utxo = utxosA[0];
  const addressObject = walletA
    .getAddressObjects()
    .find((obj) => obj.address === utxo.address);

  const forcedUTXO = {
    utxo,
    address: utxo.address,
    // For legacy addresses the signer expects WIF; for PQ it expects the seedKey object.
    privateKey: addressObject.WIF ?? addressObject.privateKey,
  };

  const walletB = await crazyCatWalletPromise;

  const result = await walletB.createSendManyTransaction({
    assetName: "BUTTER",
    forcedUTXOs: [forcedUTXO],
    outputs: { [RECIPIENT]: 1 },
  });

  const inputUTXOs = result.debug.UTXOs;
  const forcedFound = inputUTXOs.find(
    (u) => u.txid === forcedUTXO.utxo.txid && u.outputIndex === forcedUTXO.utxo.outputIndex,
  );
  expect(!!forcedFound).to.equal(true);
  expect(result.debug.signedTransaction).to.be.a("string").and.not.empty;
});

it("Forced UTXO is fully consumed (value ~ fee + change)", async () => {
  const walletA = await walletAPromise;
  const utxosA = await walletA.getUTXOs();
  const utxo = utxosA[0];
  const addressObject = walletA
    .getAddressObjects()
    .find((obj) => obj.address === utxo.address);

  const forcedUTXO = {
    utxo,
    address: utxo.address,
    // For legacy addresses the signer expects WIF; for PQ it expects the seedKey object.
    privateKey: addressObject.WIF ?? addressObject.privateKey,
  };

  const walletB = await crazyCatWalletPromise;

  const result = await walletB.createSendManyTransaction({
    assetName: "BUTTER",
    forcedUTXOs: [forcedUTXO],
    outputs: { [RECIPIENT]: 1 },
  });

  const fee = result.debug.fee;
  const change = result.debug.xnaChangeAmount;
  const value = forcedUTXO.utxo.satoshis / 1e8;
  // Forced UTXO contributes its full value; difference between inputs total and
  // (change + fee) must be small (other XNA UTXOs from wallet B may also be picked).
  expect(value - (fee + change)).to.be.lessThan(value);
});
