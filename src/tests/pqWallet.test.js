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

it("PQ fee estimation accounts for larger witness inputs", async () => {
  const wallet = await NeuraiWallet.createInstance({
    mnemonic,
    network: "xna-pq-test",
    offlineMode: true,
    minAmountOfAddresses: 2,
  });

  const addressObject = wallet.getAddressObjects()[0];
  const SendManyTransaction = NeuraiWallet.SendManyTransaction;
  const transaction = new SendManyTransaction({
    wallet,
    assetName: "XNA",
    outputs: {
      [wallet.getAddressObjects()[1].address]: 1,
    },
  });

  transaction._allUTXOs = [
    {
      address: addressObject.address,
      assetName: "XNA",
      txid: "11".repeat(32),
      outputIndex: 0,
      script: "511481cee845f95946e3531e26fe897d469283f03f7e",
      satoshis: 200000000,
      value: 2,
    },
  ];

  expect(transaction.getSizeInKB()).to.be.greaterThan(0.9);
});
