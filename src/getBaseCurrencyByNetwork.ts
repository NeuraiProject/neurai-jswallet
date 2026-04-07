import { ChainType } from "./Types";


export function getBaseCurrencyByNetwork(network: ChainType): string {
  const map = {
    xna: "XNA",
    "xna-test": "XNA",
    "xna-legacy": "XNA",
    "xna-legacy-test": "XNA",
    "xna-pq": "XNA",
    "xna-pq-test": "XNA",
  };
  return map[network];
}
