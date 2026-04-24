const NeuraiWallet = require("../../dist/index.cjs");
const expect = require("chai").expect;

const mnemonic =
  "result pact model attract result puzzle final boss private educate luggage era";

it("PQ wallets derive distinct receive and change addresses", async () => {
  const wallet = await NeuraiWallet.createInstance({
    mnemonic,
    network: "xna-pq-test",
    offlineMode: true,
    minAmountOfAddresses: 5,
  });

  const receiveAddress = await wallet.getReceiveAddress();
  const changeAddress = await wallet.getChangeAddress();
  const assetChangeAddress = await wallet.getAssetChangeAddress();

  expect(receiveAddress).to.match(/^tnq1/);
  expect(changeAddress).to.match(/^tnq1/);
  expect(assetChangeAddress).to.match(/^tnq1/);
  expect(new Set([receiveAddress, changeAddress, assetChangeAddress]).size).to.equal(3);
});

it("PQ wallets expose seed-based signing material", async () => {
  const wallet = await NeuraiWallet.createInstance({
    mnemonic,
    network: "xna-pq-test",
    offlineMode: true,
    minAmountOfAddresses: 2,
  });

  const addressObject = wallet.getAddressObjects()[0];
  const signingMaterial = wallet.getPrivateKeyByAddress(addressObject.address);

  expect(addressObject.seedKey).to.match(/^[0-9a-f]{64}$/);
  expect(signingMaterial).to.be.an("object");
  expect(signingMaterial.seedKey).to.equal(addressObject.seedKey);
});

it("PQ wallet builds a signed payment transaction end-to-end", async () => {
  const wallet = await NeuraiWallet.createInstance({
    mnemonic,
    network: "xna-pq-test",
    offlineMode: true,
    minAmountOfAddresses: 2,
  });

  const fromAddress = wallet.getAddressObjects()[0];
  const toAddress = wallet.getAddressObjects()[1].address;

  // Synthetic PQ XNA UTXO: 2 XNA on the wallet's first address.
  // ScriptPubKey is OP_1 <commitment> = 51 14 <20-byte commitment prefix>; we
  // use the address's actual commitment bytes (first 20 bytes of the bech32m
  // payload — derivable but for test purposes the script must just be PQ-shaped).
  const syntheticUTXO = {
    address: fromAddress.address,
    assetName: "XNA",
    txid: "11".repeat(32),
    outputIndex: 0,
    // OP_1 PUSH32 <commitment> — full PQ scriptPubKey shape (34 bytes)
    script: "5120" + fromAddress.commitment,
    satoshis: 200000000,
    value: 2,
  };

  // Stub network calls so the build path stays purely local.
  wallet.getMempool = async () => [];
  wallet.getAssetUTXOs = async () => [];
  wallet.getUTXOs = async () => [syntheticUTXO];
  wallet.getUTXOsInMempool = async () => [];
  wallet.rpc = async (method) => {
    if (method === "estimatesmartfee") return { feerate: 0.05 };
    throw new Error(`Unexpected RPC call: ${method}`);
  };

  const result = await wallet.createTransaction({
    toAddress,
    amount: 1,
  });

  expect(result.debug.signedTransaction).to.be.a("string").and.not.empty;
  expect(result.debug.fee).to.be.greaterThan(0);
  // Witness adds bytes; signed > raw means the PQ signer ran
  expect(result.debug.signedTransaction.length).to.be.greaterThan(
    result.debug.rawUnsignedTransaction.length,
  );
  expect(result.debug.UTXOs[0].txid).to.equal(syntheticUTXO.txid);
});
