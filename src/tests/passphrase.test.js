const NeuraiWallet = require("../../dist/index.cjs");
const expect = require("chai").expect;

const mnemonic =
  "result pact model attract result puzzle final boss private educate luggage era";

describe("Passphrase Support", () => {
  it("Should create different addresses with different passphrases", async () => {
    const network = "xna-test";
    const passphrase1 = "my secret passphrase";
    const passphrase2 = "another passphrase";

    const wallet1 = await NeuraiWallet.createInstance({
      mnemonic,
      network,
      passphrase: passphrase1,
      offlineMode: true,
    });

    const wallet2 = await NeuraiWallet.createInstance({
      mnemonic,
      network,
      passphrase: passphrase2,
      offlineMode: true,
    });

    const address1 = await wallet1.getReceiveAddress();
    const address2 = await wallet2.getReceiveAddress();

    expect(address1).to.not.equal(address2);
  });

  it("Should create different addresses with and without passphrase", async () => {
    const network = "xna-test";
    const passphrase = "my secret passphrase";

    const walletNoPass = await NeuraiWallet.createInstance({
      mnemonic,
      network,
      offlineMode: true,
    });

    const walletWithPass = await NeuraiWallet.createInstance({
      mnemonic,
      network,
      passphrase,
      offlineMode: true,
    });

    const addressNoPass = await walletNoPass.getReceiveAddress();
    const addressWithPass = await walletWithPass.getReceiveAddress();

    expect(addressNoPass).to.not.equal(addressWithPass);
  });

  it("Empty passphrase should equal no passphrase", async () => {
    const network = "xna-test";

    const walletEmpty = await NeuraiWallet.createInstance({
      mnemonic,
      network,
      passphrase: "",
      offlineMode: true,
    });

    const walletNoPass = await NeuraiWallet.createInstance({
      mnemonic,
      network,
      offlineMode: true,
    });

    const addressEmpty = await walletEmpty.getReceiveAddress();
    const addressNoPass = await walletNoPass.getReceiveAddress();

    expect(addressEmpty).to.equal(addressNoPass);
  });

  it("Same passphrase should generate same addresses", async () => {
    const network = "xna-test";
    const passphrase = "consistent passphrase";

    const wallet1 = await NeuraiWallet.createInstance({
      mnemonic,
      network,
      passphrase,
      offlineMode: true,
    });

    const wallet2 = await NeuraiWallet.createInstance({
      mnemonic,
      network,
      passphrase,
      offlineMode: true,
    });

    const address1 = await wallet1.getReceiveAddress();
    const address2 = await wallet2.getReceiveAddress();

    expect(address1).to.equal(address2);
  });

  it("Should work with mainnet", async () => {
    const network = "xna";
    const passphrase = "mainnet test";

    const wallet = await NeuraiWallet.createInstance({
      mnemonic,
      network,
      passphrase,
      offlineMode: true,
    });

    const address = await wallet.getReceiveAddress();
    expect(address).to.be.a("string");
    expect(address).to.match(/^N/); // Mainnet addresses start with 'N'
  });
});
