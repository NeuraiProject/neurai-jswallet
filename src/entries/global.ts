import * as NeuraiJsWallet from "../neuraiWallet.js";

const globalTarget = globalThis as typeof globalThis & {
  NeuraiJsWallet?: typeof NeuraiJsWallet;
};

globalTarget.NeuraiJsWallet = NeuraiJsWallet;

export { NeuraiJsWallet };
