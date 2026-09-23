import { ChainType } from "./Types.js";
import { getChainConfig } from "./networks.js";

/** Base currency of a wallet network: XNA on every Neurai chain. */
export function getBaseCurrencyByNetwork(network: ChainType): string {
  getChainConfig(network); // rejects unknown networks
  return "XNA";
}
