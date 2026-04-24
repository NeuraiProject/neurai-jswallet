import * as NeuraiJsWallet from "../neuraiWallet.js";
import * as scripts from "@neuraiproject/neurai-scripts";
import * as key from "@neuraiproject/neurai-key";
import {
  generateMnemonic,
  entropyToMnemonic,
  isMnemonicValid,
} from "@neuraiproject/neurai-key";

const merged = {
  ...NeuraiJsWallet,
  scripts,
  key,
  generateMnemonic,
  entropyToMnemonic,
  isMnemonicValid,
};

const globalTarget = globalThis as typeof globalThis & {
  NeuraiJsWallet?: typeof merged;
};

globalTarget.NeuraiJsWallet = merged;

export { NeuraiJsWallet };
