import * as NeuraiJsWallet from "../neuraiWallet.js";
import * as scripts from "@neuraiproject/neurai-scripts";

const merged = { ...NeuraiJsWallet, scripts };

const globalTarget = globalThis as typeof globalThis & {
  NeuraiJsWallet?: typeof merged;
};

globalTarget.NeuraiJsWallet = merged;

export { NeuraiJsWallet };
