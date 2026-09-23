// Compiled by `npm run test:types` against the built package (dist/*.d.ts),
// the way an ESM application imports it, with skipLibCheck: false.
import NeuraiWallet, {
  createInstance,
  entropyToMnemonic,
  generateMnemonic,
  isMnemonicValid,
  key,
  scripts,
  Wallet,
  type AddressFamily,
  type AssetOpExecuteOptions,
  type AssetOpResult,
  type ChainConfig,
  type ChainType,
  type IAddressMetaData,
  type IOptions,
  type ISend,
  type ISendResult,
  type IUTXO,
  type KeyNetwork,
  type RpcClient,
  type SweepResult,
} from "@neuraiproject/neurai-jswallet";

const network: ChainType = "xna-ecdsa-test";
const options: IOptions = { mnemonic: generateMnemonic(), network, offlineMode: true };
const keyNetwork: KeyNetwork = "xna-legacy";
const family: AddressFamily = "authscript-pq";
const valid: boolean = isMnemonicValid(entropyToMnemonic("00".repeat(16)));

export async function consumer(): Promise<void> {
  const wallet: Wallet = await createInstance(options);
  const receive: string = await wallet.getReceiveAddress();
  const objects: IAddressMetaData[] = wallet.getAddressObjects();
  const send: ISend = { toAddress: receive, amount: "1.5" };
  const built: ISendResult = await wallet.createTransaction(send);
  const utxos: IUTXO[] = await wallet.getUTXOs();
  const swept: SweepResult = await wallet.sweep("cWIF", false);
  const rpc: RpcClient = wallet.rpc;
  const execute: AssetOpExecuteOptions = { broadcast: false };
  const issued: AssetOpResult = await wallet.assets.issueRoot({ assetName: "ROOT", quantity: 1, ...execute });
  const exists: Promise<boolean> = wallet.assets.queries.assetExists("ROOT");
  const base: string = NeuraiWallet.getBaseCurrencyByNetwork(network);
  const config: ChainConfig | undefined = undefined;
  const pq = key.getPQAddress("xna-pq-test", options.mnemonic, 0, 0);
  const witness: Uint8Array[] = scripts.buildStrictWitnessECDSA({ signature: new Uint8Array(71), pubKey: new Uint8Array(33) });
  void objects; void built; void utxos; void swept; void rpc; void issued; void exists; void base;
  void config; void keyNetwork; void family; void valid; void pq.commitment; void witness;
}
