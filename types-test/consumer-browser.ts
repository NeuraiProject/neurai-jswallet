// Browser entry: `@neuraiproject/neurai-jswallet/browser`.
import { createInstance, generateMnemonic, key, type ChainType, type IOptions } from "@neuraiproject/neurai-jswallet/browser";

const network: ChainType = "xna-pq-test";
const options: IOptions = { mnemonic: generateMnemonic(), network, offlineMode: true };
export const wallet = createInstance(options);
export const address: string = key.getPQAuthScriptAddress("xna-authscript-test", options.mnemonic, 0, 0).address;
