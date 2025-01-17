import { ChainType } from "./Types";


export function getBaseCurrencyByNetwork(network: ChainType): string {
  const map = {
    evr: "EVR",
    "evr-test": "EVR",
    xna: "XNA",
    "xna-test": "XNA",
  };
  return map[network];
}
