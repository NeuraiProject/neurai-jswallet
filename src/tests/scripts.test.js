const NeuraiWallet = require("../../dist/index.cjs");
const expect = require("chai").expect;

it("scripts namespace is re-exported from neurai-scripts", () => {
  expect(NeuraiWallet.scripts).to.be.an("object");
});

it("scripts exposes covenant builders (legacy + PQ)", () => {
  const s = NeuraiWallet.scripts;
  expect(s.buildPartialFillScript).to.be.a("function");
  expect(s.buildPartialFillScriptHex).to.be.a("function");
  expect(s.buildPartialFillScriptPQ).to.be.a("function");
  expect(s.buildCancelScriptSig).to.be.a("function");
  expect(s.buildCancelScriptSigPQ).to.be.a("function");
  expect(s.parsePartialFillScript).to.be.a("function");
  expect(s.parsePartialFillScriptPQ).to.be.a("function");
});

it("scripts exposes standard script helpers (P2PKH, multisig, OP_RETURN, AuthScript)", () => {
  const s = NeuraiWallet.scripts;
  expect(s.encodeP2PKHScriptPubKey).to.be.a("function");
  expect(s.encodeP2WPKHScriptPubKey).to.be.a("function");
  expect(s.encodeP2WSHScriptPubKey).to.be.a("function");
  expect(s.encodeP2SHScriptPubKey).to.be.a("function");
  expect(s.encodeMultisigRedeemScript).to.be.a("function");
  expect(s.encodeNullDataScript).to.be.a("function");
  expect(s.encodeAuthScriptScriptPubKey).to.be.a("function");
});

it("scripts exposes core primitives (ScriptBuilder, opcodes, byte helpers)", () => {
  const s = NeuraiWallet.scripts;
  expect(s.ScriptBuilder).to.be.a("function");
  expect(s.opcodes).to.be.an("object");
  expect(s.bytesToHex).to.be.a("function");
  expect(s.hexToBytes).to.be.a("function");
});
