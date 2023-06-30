const NeuraiWallet = require("../dist/index.cjs");

jest.setTimeout(20 * 1000);

test("Test receive and change address", async () => {
  /* 
   Change address and receive address should NOT be the same
  */
  const network = "xna-test";

  const wallet = await NeuraiWallet.createInstance({
    mnemonic:
      "frozen drift quiz glove wrong cycle glide increase hybrid arch endorse brisk",
    network,
  });

  try {
    const receiveAddress = await wallet.getReceiveAddress();
    const changeAddress = await wallet.getChangeAddress();

    expect(receiveAddress).not.toEqual(changeAddress);
  } catch (e) {
    console.log("EXCEPTION", e);
  }
});
