import { methods } from "@neuraiproject/neurai-rpc";
import { ONE_FULL_COIN } from "./contants";
import { Wallet } from "./neuraiWallet";

export async function getBalance(wallet:Wallet, addresses: string[]) {
  const includeAssets = false;
  const params = [{ addresses }, includeAssets];
  const balance = (await wallet.rpc(methods.getaddressbalance, params)) as any;

  return balance.balance / ONE_FULL_COIN;
}
