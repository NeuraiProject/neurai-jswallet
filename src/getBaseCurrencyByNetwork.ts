import { ChainType } from "./Types";


export function getBaseCurrencyByNetwork(network: ChainType): string {
  const map = {
    xna: "XNA",
    "xna-test": "XNA",
  };
  return map[network];
}
