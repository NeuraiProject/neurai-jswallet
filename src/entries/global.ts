import * as NeuraiJsWallet from "../neuraiWallet.js";
import * as scripts from "@neuraiproject/neurai-scripts";
import {
  generateMnemonic,
  entropyToMnemonic,
  isMnemonicValid,
} from "@neuraiproject/neurai-key";

const merged = {
  ...NeuraiJsWallet,
  scripts,
  generateMnemonic,
  entropyToMnemonic,
  isMnemonicValid,
};

const globalTarget = globalThis as typeof globalThis & {
  NeuraiJsWallet?: typeof merged;
};

globalTarget.NeuraiJsWallet = merged;

export { NeuraiJsWallet };
