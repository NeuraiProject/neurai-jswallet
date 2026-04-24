const NeuraiWallet = require("../../dist/index.cjs");
const expect = require("chai").expect;
const crazyCatWalletPromise = require("./getWalletPromise");

// Forced change addresses must belong to the sending wallet so the change is
// recoverable. We use Crazy Cat wallet's index-1 addresses (its index-0
// already holds funds) to keep the test self-contained.
const FORCED_ASSET_CHANGE = "tL1vjZj1KYd1FuAcCv4KWQPYMsJxA2rJoH"; // Crazy Cat external[1]
const FORCED_BASE_CHANGE = "tKevLHxnRC4srYDP6vGrYPRESkL9p4wd5Y"; // Crazy Cat internal[1]
const RECIPIENT = "tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy"; // Crazy Cat external[2]

it("Forced change address for assets", async () => {
  const wallet = await crazyCatWalletPromise;

  const result = await wallet.createSendManyTransaction({
    assetName: "BUTTER",
    forcedChangeAddressAssets: FORCED_ASSET_CHANGE,
    outputs: { [RECIPIENT]: 1 },
  });

  const outputAddresses = Object.keys(result.debug.outputs);
  expect(outputAddresses).to.include(FORCED_ASSET_CHANGE);
});

it("Forced change address for base currency", async () => {
  const wallet = await crazyCatWalletPromise;

  const result = await wallet.createSendManyTransaction({
    assetName: "BUTTER",
    forcedChangeAddressAssets: FORCED_ASSET_CHANGE,
    forcedChangeAddressBaseCurrency: FORCED_BASE_CHANGE,
    outputs: { [RECIPIENT]: 1 },
  });

  const outputAddresses = Object.keys(result.debug.outputs);
  expect(outputAddresses).to.include(FORCED_BASE_CHANGE);
});
