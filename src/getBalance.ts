import { satsToXna } from './blockchain/txEngine.js';
import { methods } from "@neuraiproject/neurai-rpc";
import { ONE_FULL_COIN } from "./contants.js";
import { Wallet } from "./neuraiWallet.js";

export async function getBalance(wallet:Wallet, addresses: string[]) {
  const includeAssets = false;
  const params = [{ addresses }, includeAssets];
  const balance = (await wallet.rpc(methods.getaddressbalance, params)) as any;

  return satsToXna(balance.balance);
}
