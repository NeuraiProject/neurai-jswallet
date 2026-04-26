export * from "../neuraiWallet.js";
export { default } from "../neuraiWallet.js";
export * as scripts from "@neuraiproject/neurai-scripts";

/**
 * Mnemonic utilities needed before a wallet instance exists (creating,
 * restoring, validating the 12 words). Re-exported from
 * `@neuraiproject/neurai-key` so a browser consumer can build a wallet
 * with a single `<script>` tag.
 */
export {
  generateMnemonic,
  entropyToMnemonic,
  isMnemonicValid,
} from "@neuraiproject/neurai-key";

/**
 * Full `@neuraiproject/neurai-key` surface for advanced consumers
 * (offline derivation, manual HD key handling, address pair generation,
 * coin types, AuthScript / PQ helpers, mnemonic ↔ entropy round-trips...).
 */
export * as key from "@neuraiproject/neurai-key";
