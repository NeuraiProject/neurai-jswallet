export * from "../neuraiWallet.js";
export { default } from "../neuraiWallet.js";

/**
 * Low-level script primitives (covenants, multisig, AuthScript, OP_RETURN,
 * P2WSH/P2SH, ScriptBuilder...). Re-exported from `@neuraiproject/neurai-scripts`
 * so wallet users don't need a second `npm install` to access them.
 *
 *   import { scripts } from "@neuraiproject/neurai-jswallet";
 *   scripts.encodeMultisigRedeemScript({...});
 */
export * as scripts from "@neuraiproject/neurai-scripts";
