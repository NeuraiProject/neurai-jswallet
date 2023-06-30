interface ISend {
    assetName?: string;
    toAddress: string;
    amount: number;
}
type ChainType = "xna" | "xna-test";
interface IAddressDelta {
    address: string;
    assetName: string;
    blockindex: number;
    height: number;
    index: number;
    satoshis: number;
    txid: string;
}
interface SweepResult {
    errorDescription?: string;
    fromAddress?: string;
    inputs?: Array<IInput>;
    outputs?: any;
    rawTransaction?: string;
    toAddresses?: string[];
    transactionId?: string;
    UTXOs?: Array<IUTXO>;
}
type TPrivateKey = {
    [key: string]: string;
};
interface ISendResult {
    transactionId: string;
    debug: {
        amount: number;
        assetName: string;
        assetUTXOs: Array<IUTXO>;
        error?: any;
        fee: number;
        inputs: Array<IVout_when_creating_transactions>;
        outputs: any;
        privateKeys?: TPrivateKey;
        rawUnsignedTransaction?: string;
        xnaAmount: number;
        xnaChangeAmount: number;
        xnaUTXOs: Array<IUTXO>;
        signedTransaction?: string;
        unspentXNAAmount: any;
    };
}
interface IVout_when_creating_transactions {
    txid: string;
    vout: number;
    address: string;
}
interface IUTXO {
    address: string;
    assetName: string;
    txid: string;
    outputIndex: number;
    script: string;
    satoshis: number;
    height: number;
    value: number;
}
interface IAddressMetaData {
    address: string;
    WIF: string;
    path: string;
    privateKey: string;
}
interface IInput {
    txid: string;
    vout: number;
    address?: string;
}
interface IAddressMetaData {
    address: string;
    WIF: string;
    path: string;
    privateKey: string;
}
interface IUTXO {
    address: string;
    assetName: string;
    txid: string;
    outputIndex: number;
    script: string;
    satoshis: number;
    height: number;
}
export class Wallet {
    rpc: (method: string, params: any[]) => Promise<any>;
    _mnemonic: string;
    network: ChainType;
    addressObjects: Array<IAddressMetaData>;
    receiveAddress: string;
    changeAddress: string;
    addressPosition: number;
    baseCurrency: string;
    offlineMode: boolean;
    setBaseCurrency(currency: string): void;
    getBaseCurrency(): string;
    /**
     * Sweeping a private key means to send all the funds the address holds to your your wallet.
     * The private key you sweep do not become a part of your wallet.
     *
     * NOTE: the address you sweep needs to cointain enough XNA to pay for the transaction
     *
     * @param WIF the private key of the address that you want move funds from
     * @returns either a string, that is the transaction id or null if there were no funds to send
     */
    sweep(WIF: string, onlineMode: boolean): Promise<SweepResult>;
    getAddressObjects(): IAddressMetaData[];
    getAddresses(): Array<string>;
    init(options: IOptions): Promise<void>;
    hasHistory(addresses: Array<string>): Promise<boolean>;
    _getFirstUnusedAddress(external: boolean): Promise<string>;
    getHistory(): Promise<IAddressDelta[]>;
    getMempool(): Promise<IAddressDelta[]>;
    getReceiveAddress(): Promise<string>;
    getChangeAddress(): Promise<string>;
    /**
     *
     * @param assetName if present, only return UTXOs for that asset, otherwise for all assets
     * @returns UTXOs for assets
     */
    getAssetUTXOs(assetName?: string): Promise<any>;
    getUTXOs(): Promise<any>;
    getPrivateKeyByAddress(address: string): string;
    send(options: ISend): Promise<ISendResult>;
    getAssets(): Promise<any>;
    getBalance(): Promise<number>;
}
declare const _default: {
    createInstance: typeof createInstance;
};
export default _default;
export function createInstance(options: IOptions): Promise<Wallet>;
export function getBaseCurrencyByNetwork(network: ChainType): string;
export interface IOptions {
    mnemonic: string;
    minAmountOfAddresses?: number;
    network?: ChainType;
    rpc_username?: string;
    rpc_password?: string;
    rpc_url?: string;
    offlineMode?: boolean;
}

//# sourceMappingURL=types.d.ts.map
