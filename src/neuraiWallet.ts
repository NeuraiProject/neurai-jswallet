import { getRPC, methods } from "@neuraiproject/neurai-rpc";
import NeuraiKey from "@neuraiproject/neurai-key";
import Signer from "@neuraiproject/neurai-sign-transaction";
import {
  ChainType,
  IAddressDelta,
  IAddressMetaData,
  IMempoolEntry,
  IOptions,
  ISend,
  ISendManyOptions,
  ISendResult,
  IUTXO,
  SweepResult,
} from "./Types";

import { sweep } from "./blockchain/sweep";
import { Transaction } from "./blockchain/Transaction";
import { SendManyTransaction } from "./blockchain/SendManyTransaction";
import { getBaseCurrencyByNetwork } from "./getBaseCurrencyByNetwork";
import { getBalance } from "./getBalance";
import { ValidationError } from "./Errors";
import { getAssets } from "./getAssets";

export { Transaction };
export { SendManyTransaction };
const URL_NEURAI_MAINNET = "https://rpc-main.neurai.org/rpc";
const URL_NEURAI_TESTNET = "https://rpc-testnet.neurai.org/rpc";
// NIP-022 PQ-HD (neurai-key >= 4.0.0): every path level must be hardened.
const PQ_PURPOSE = 100;
const PQ_COIN_TYPE_MAINNET = 1900;
const PQ_COIN_TYPE_TESTNET = 1;
const PQ_CHANGE_INDEX = 0;

//Avoid singleton (anti-pattern)
//Meaning multiple instances of the wallet must be able to co-exist

type PQChainType = "xna-pq" | "xna-pq-test";
type LegacyChainType = Exclude<ChainType, PQChainType>;

function isPQNetwork(network: ChainType): network is PQChainType {
  return network === "xna-pq" || network === "xna-pq-test";
}

function getPQDerivationPath(network: PQChainType, account: number, index: number) {
  const coinType = network === "xna-pq" ? PQ_COIN_TYPE_MAINNET : PQ_COIN_TYPE_TESTNET;
  return `m_pq/${PQ_PURPOSE}'/${coinType}'/${account}'/${PQ_CHANGE_INDEX}'/${index}'`;
}

function getSigningMaterial(addressObject: IAddressMetaData) {
  if (addressObject.seedKey) {
    return {
      seedKey: addressObject.seedKey,
      publicKey: addressObject.publicKey,
    };
  }
  if (addressObject.WIF) {
    return addressObject.WIF;
  }
  return addressObject.privateKey;
}

export class Wallet {
  rpc = getRPC("anonymous", "anonymous", URL_NEURAI_MAINNET);
  _mnemonic = "";
  _passphrase = "";
  network: ChainType = "xna";
  addressObjects: Array<IAddressMetaData> = [];
  receiveAddress = "";
  changeAddress = "";
  assetChangeAddress = "";
  addressPosition = 0;
  baseCurrency = "XNA";
  offlineMode = false;
  setBaseCurrency(currency: string) {
    this.baseCurrency = currency;
  }
  getBaseCurrency() {
    return this.baseCurrency;
  }
  /**
   * Sweeping a private key means to send all the funds the address holds to your your wallet.
   * The private key you sweep does not become a part of your wallet.
   *
   * NOTE: the address you sweep needs to cointain enough XNA to pay for the transaction
   *
   * @param WIF the private key of the address that you want move funds from
   * @returns either a string, that is the transaction id or null if there were no funds to send
   */
  sweep(WIF: string, onlineMode: boolean): Promise<SweepResult> {
    const wallet = this;

    return sweep(WIF, wallet, onlineMode);
  }
  getAddressObjects() {
    return this.addressObjects;
  }
  getAddresses(): Array<string> {
    const addresses = this.addressObjects.map((obj) => {
      return obj.address;
    });
    return addresses;
  }

  async init(options: IOptions) {
    let username = "anonymous";
    let password = "anonymous";
    let url = URL_NEURAI_MAINNET;

    //VALIDATION
    if (!options) {
      throw Error("option argument is mandatory");
    }

    if (options.offlineMode === true) {
      this.offlineMode = true;
    }
    if (!options.mnemonic) {
      throw Error("option.mnemonic is mandatory");
    }
    if (
      options.network === "xna-test" ||
      options.network === "xna-legacy-test"
    ) {
      url = URL_NEURAI_TESTNET;
    }
    url = options.rpc_url || url;
    password = options.rpc_password || password;
    username = options.rpc_username || username;

    if (options.network) {
      this.network = options.network;
      this.setBaseCurrency(getBaseCurrencyByNetwork(options.network));
    }

    this.rpc = getRPC(username, password, url);
    this._mnemonic = options.mnemonic;
    this._passphrase = options.passphrase || "";

    //Generating the hd key is slow, so we re-use the object
    const usingPQ = isPQNetwork(this.network);
    const pqNetwork = usingPQ ? (this.network as PQChainType) : null;
    const legacyNetwork = usingPQ ? null : (this.network as LegacyChainType);
    const pqHDKey = usingPQ
      ? NeuraiKey.getPQHDKey(pqNetwork!, this._mnemonic, this._passphrase)
      : null;
    const legacyHDKey = usingPQ
      ? null
      : NeuraiKey.getHDKey(legacyNetwork!, this._mnemonic, this._passphrase);
    const coinType = usingPQ ? null : NeuraiKey.getCoinType(legacyNetwork!);
    const ACCOUNT = 0;

    const minAmountOfAddresses = Number.isFinite(options.minAmountOfAddresses)
      ? options.minAmountOfAddresses
      : 0;

    let doneDerivingAddresses = false;
    while (doneDerivingAddresses === false) {
      //We add new addresses to tempAddresses so we can check history for the last 20
      const tempAddresses = [] as string[];

      for (let i = 0; i < 20; i++) {
        if (usingPQ) {
          const pqAddress = {
            ...NeuraiKey.getPQAddressByPath(
              pqNetwork!,
              pqHDKey!,
              getPQDerivationPath(pqNetwork!, ACCOUNT, this.addressPosition)
            ),
            keyType: "pq" as const,
          };
          this.addressObjects.push(pqAddress);
          this.addressPosition++;
          tempAddresses.push(pqAddress.address + "");
        } else {
          const external = {
            ...NeuraiKey.getAddressByPath(
              legacyNetwork!,
              legacyHDKey!,
              `m/44'/${coinType}'/${ACCOUNT}'/0/${this.addressPosition}`
            ),
            keyType: "legacy" as const,
          };

          const internal = {
            ...NeuraiKey.getAddressByPath(
              legacyNetwork!,
              legacyHDKey!,
              `m/44'/${coinType}'/${ACCOUNT}'/1/${this.addressPosition}`
            ),
            keyType: "legacy" as const,
          };

          this.addressObjects.push(external);
          this.addressObjects.push(internal);
          this.addressPosition++;

          tempAddresses.push(external.address + "");
          tempAddresses.push(internal.address + "");
        }
      }

      if (
        minAmountOfAddresses &&
        minAmountOfAddresses >= this.addressPosition
      ) {
        //In case we intend to create extra addresses on startup
        doneDerivingAddresses = false;
      } else if (this.offlineMode === true) {
        //BREAK generation of addresses and do NOT check history on the network
        doneDerivingAddresses = true;
      } else {
        //If no history, break
        doneDerivingAddresses =
          false === (await this.hasHistory(tempAddresses));
      }
    }
  }
  async hasHistory(addresses: Array<string>): Promise<boolean> {
    const includeAssets = true;
    const obj = {
      addresses,
    };

    const asdf = (await this.rpc(methods.getaddressbalance, [
      obj,
      includeAssets,
    ])) as any;

    //@ts-ignore
    const hasReceived = Object.values(asdf).find((asset) => asset.received > 0);

    return !!hasReceived;
  }

  _getCandidateAddresses(external: boolean, excludeAddresses: string[] = []) {
    const excluded = new Set(excludeAddresses.filter(Boolean));

    if (isPQNetwork(this.network)) {
      return this.getAddresses().filter((address) => !excluded.has(address));
    }

    const addresses: string[] = [];
    this.getAddresses().map(function (address: string, index: number) {
      if (external === true && index % 2 === 0) {
        addresses.push(address);
      } else if (external === false && index % 2 !== 0) {
        addresses.push(address);
      }
    });

    return addresses.filter((address) => !excluded.has(address));
  }

  async _findFirstUnusedAddress(addresses: string[]) {
    let low = 0;
    let high = addresses.length - 1;
    let result = "";

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const addy = addresses[mid];

      const hasHistory = await this.hasHistory([addy]);
      if (hasHistory === false) {
        result = addy;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return result;
  }

  async _getFirstUnusedAddress(external: boolean, excludeAddresses: string[] = []) {
    // Offline mode: return the first candidate without consulting the network.
    // Useful when the caller built the wallet with offlineMode: true and just
    // needs deterministic receive/change addresses (e.g. PQ wallets whose
    // bech32m format is not yet recognised by every RPC node).
    if (this.offlineMode === true) {
      const addresses = this._getCandidateAddresses(external, excludeAddresses);
      const result = addresses[0];
      if (external === true) {
        this.receiveAddress = result;
      } else {
        this.changeAddress = result;
      }
      return result;
    }
    //First, check if lastReceivedAddress
    if (
      external === true &&
      this.receiveAddress &&
      excludeAddresses.includes(this.receiveAddress) === false
    ) {
      const asdf = await this.hasHistory([this.receiveAddress]);
      if (asdf === false) {
        return this.receiveAddress;
      }
    }
    if (
      external === false &&
      this.changeAddress &&
      excludeAddresses.includes(this.changeAddress) === false
    ) {
      const asdf = await this.hasHistory([this.changeAddress]);
      if (asdf === false) {
        return this.changeAddress;
      }
    }
    const addresses = this._getCandidateAddresses(external, excludeAddresses);
    const result = await this._findFirstUnusedAddress(addresses);

    if (!result) {
      //IF we have not found one, return the first address
      return addresses[0];
    }
    if (external === true) {
      this.receiveAddress = result;
    } else {
      this.changeAddress = result;
    }

    return result;
  }

  async getHistory(): Promise<IAddressDelta[]> {
    const assetName = ""; //Must be empty string, NOT "*"
    const addresses = this.getAddresses();
    const deltas = this.rpc(methods.getaddressdeltas, [
      { addresses, assetName },
    ]);
    //@ts-ignore
    const addressDeltas: IAddressDelta[] = deltas as IAddressDelta[];
    return addressDeltas;
  }
  async getMempool(): Promise<IMempoolEntry[]> {
    const method = methods.getaddressmempool;
    const includeAssets = true;
    const params = [{ addresses: this.getAddresses() }, includeAssets];
    return this.rpc(method, params) as Promise<IMempoolEntry[]>;
  }
  async getReceiveAddress() {
    const excludeAddresses =
      isPQNetwork(this.network) && this.changeAddress ? [this.changeAddress] : [];
    return this._getFirstUnusedAddress(true, excludeAddresses);
  }

  async getChangeAddress() {
    const excludeAddresses =
      isPQNetwork(this.network) && this.receiveAddress ? [this.receiveAddress] : [];
    return this._getFirstUnusedAddress(false, excludeAddresses);
  }

  async getAssetChangeAddress() {
    const reservedAddresses = [this.receiveAddress, this.changeAddress].filter(Boolean);

    if (this.offlineMode === true) {
      if (!isPQNetwork(this.network)) {
        const changeAddressBaseCurrency = await this.getChangeAddress();
        const index = this.getAddresses().indexOf(changeAddressBaseCurrency);
        const changeAddressAsset = this.getAddresses()[index + 2];
        this.assetChangeAddress = changeAddressAsset;
        return changeAddressAsset;
      }
      const offlineCandidates = this._getCandidateAddresses(false, reservedAddresses);
      const offlineResult = offlineCandidates[0];
      this.assetChangeAddress = offlineResult;
      return offlineResult;
    }

    if (
      this.assetChangeAddress &&
      reservedAddresses.includes(this.assetChangeAddress) === false
    ) {
      const asdf = await this.hasHistory([this.assetChangeAddress]);
      if (asdf === false) {
        return this.assetChangeAddress;
      }
    }

    if (!isPQNetwork(this.network)) {
      const changeAddressBaseCurrency = await this.getChangeAddress();
      const index = this.getAddresses().indexOf(changeAddressBaseCurrency);
      const changeAddressAsset = this.getAddresses()[index + 2];
      this.assetChangeAddress = changeAddressAsset;
      return changeAddressAsset;
    }

    const addresses = this._getCandidateAddresses(false, reservedAddresses);
    const result = (await this._findFirstUnusedAddress(addresses)) || addresses[0];
    this.assetChangeAddress = result;
    return result;
  }
  /**
   *
   * @param assetName if present, only return UTXOs for that asset, otherwise for all assets
   * @returns UTXOs for assets
   */
  async getAssetUTXOs(assetName?: string): Promise<IUTXO[]> {
    //If no asset name, set to wildcard, meaning all assets
    const _assetName = !assetName ? "*" : assetName;
    const chainInfo = false;
    const params = [
      { addresses: this.getAddresses(), chainInfo, assetName: _assetName },
    ];

    return this.rpc(methods.getaddressutxos, params) as Promise<IUTXO[]>;
  }
  async getUTXOs(): Promise<IUTXO[]> {
    return this.rpc(methods.getaddressutxos, [
      { addresses: this.getAddresses() },
    ]) as Promise<IUTXO[]>;
  }

  getPrivateKeyByAddress(address: string) {
    const f = this.addressObjects.find((a) => a.address === address);

    if (!f) {
      return undefined;
    }
    return getSigningMaterial(f);
  }
  async sendRawTransaction(raw: string): Promise<string> {
    return this.rpc("sendrawtransaction", [raw]) as Promise<string>;
  }

  async send(options: ISend): Promise<ISendResult> {
    //ACTUAL SENDING TRANSACTION

    //Important, do not swallow the exceptions/errors of createTransaction, let them fly
    const sendResult: ISendResult = await this.createTransaction(options);

    const id = (await this.rpc("sendrawtransaction", [
      sendResult.debug.signedTransaction,
    ])) as string;
    sendResult.transactionId = id;

    return sendResult;
  }

  async sendMany({ outputs, assetName }: ISendManyOptions) {
    const options = {
      wallet: this,
      outputs,
      assetName,
    };
    const sendResult: ISendResult = await this.createSendManyTransaction(
      options
    );

    //ACTUAL SENDING TRANSACTION
    //Important, do not swallow the exceptions/errors of createSendManyTransaction, let them fly

    try {
      const id = (await this.rpc("sendrawtransaction", [
        sendResult.debug.signedTransaction,
      ])) as string;
      sendResult.transactionId = id;

      return sendResult;
    } catch (e) {
      throw new Error(
        "Error while sending, perhaps you have pending transaction? Please try again."
      );
    }
  }
  /**
   * Does all the heavy lifting regarding creating a SendManyTransaction
   * but it does not broadcast the actual transaction.
   * Perhaps the user wants to accept the transaction fee?
   * @param options
   * @returns An transaction that has not been broadcasted
   */
  async createTransaction(options: ISend): Promise<ISendResult> {
    const { amount, toAddress } = options;
    let { assetName } = options;

    if (!assetName) {
      assetName = this.baseCurrency;
    }

    //Validation
    if (!toAddress) {
      throw Error("Wallet.send toAddress is mandatory");
    }
    if (!amount) {
      throw Error("Wallet.send amount is mandatory");
    }
    const changeAddress = await this.getChangeAddress();

    if (changeAddress === toAddress) {
      throw new Error("Change address cannot be the same as toAddress");
    }
    const transaction = new Transaction({
      assetName,
      amount,
      toAddress,
      wallet: this,
      /* optional */
      forcedChangeAddressAssets: options.forcedChangeAddressAssets,
      forcedUTXOs: options.forcedUTXOs,
      forcedChangeAddressBaseCurrency: options.forcedChangeAddressBaseCurrency,
    });

    await transaction.loadData();

    const inputs = transaction.getInputs();
    const outputs = await transaction.getOutputs();

    const privateKeys = transaction.getPrivateKeys();

    const raw = (await this.rpc("createrawtransaction", [inputs, outputs])) as string;
    const signed = Signer.sign(
      this.network,
      raw,
      transaction.getUTXOs(),
      privateKeys
    );

    try {
      //   const id = await this.rpc("sendrawtransaction", [signed]);
      const sendResult: ISendResult = {
        transactionId: null,
        debug: {
          amount,
          assetName,
          fee: transaction.getFee(),
          inputs,
          outputs,
          privateKeys,
          rawUnsignedTransaction: raw,
          xnaChangeAmount: transaction.getBaseCurrencyChange(),
          xnaAmount: transaction.getBaseCurrencyAmount(),
          signedTransaction: signed,
          UTXOs: transaction.getUTXOs(),
          walletMempool: transaction.getWalletMempool(),
        },
      };
      return sendResult;
    } catch (e) {
      throw new Error(
        "Error while sending, perhaps you have pending transaction? Please try again."
      );
    }
  }

  /**
   * Does all the heavy lifting regarding creating a transaction
   * but it does not broadcast the actual transaction.
   * Perhaps the user wants to accept the transaction fee?
   * @param options
   * @returns An transaction that has not been broadcasted
   */
  async createSendManyTransaction(options: {
    assetName?: string;
    outputs: { [key: string]: number };
  }): Promise<ISendResult> {
    let { assetName } = options;

    if (!assetName) {
      assetName = this.baseCurrency;
    }

    //Validation
    if (!options.outputs) {
      throw Error("Wallet.createSendManyTransaction outputs is mandatory");
    } else if (Object.keys(options.outputs).length === 0) {
      throw new ValidationError(
        "outputs is mandatory, shoud be an object with address as keys and amounts (numbers) as values"
      );
    }
    const changeAddress = await this.getChangeAddress();

    const toAddresses = Object.keys(options.outputs);
    if (toAddresses.includes(changeAddress)) {
      throw new Error("You cannot send to your current change address");
    }
    const transaction = new SendManyTransaction({
      assetName,
      outputs: options.outputs,
      wallet: this,
    });

    await transaction.loadData();

    const inputs = transaction.getInputs();
    const outputs = await transaction.getOutputs();

    const privateKeys = transaction.getPrivateKeys();

    const raw = (await this.rpc("createrawtransaction", [inputs, outputs])) as string;
    const signed = Signer.sign(
      this.network,
      raw,
      transaction.getUTXOs(),
      privateKeys
    );

    try {
      const sendResult: ISendResult = {
        transactionId: null,
        debug: {
          amount: transaction.getAmount(),
          assetName,
          fee: transaction.getFee(),
          inputs,
          outputs,
          privateKeys,
          rawUnsignedTransaction: raw,
          xnaChangeAmount: transaction.getBaseCurrencyChange(),
          xnaAmount: transaction.getBaseCurrencyAmount(),
          signedTransaction: signed,
          UTXOs: transaction.getUTXOs(),
          walletMempool: transaction.getWalletMempool(),
        },
      };
      return sendResult;
    } catch (e) {
      throw new Error(
        "Error while sending, perhaps you have pending transaction? Please try again."
      );
    }
  }

  /**
   * This method checks if an UTXO is being spent in the mempool.
   * rpc getaddressutxos will list available UTXOs on the chain.
   * BUT an UTXO can be being spent by a transaction in mempool.
   *
   * @param utxo
   * @returns boolean true if utxo is being spent in mempool, false if not
   */
  async isSpentInMempool(utxo: IUTXO) {
    const details = await this.rpc("gettxout", [utxo.txid, utxo.outputIndex]);
    return details === null;
  }
  async getAssets() {
    return getAssets(this, this.getAddresses());
  }
  async getBalance() {
    const a = this.getAddresses();
    return getBalance(this, a);
  }
  async convertMempoolEntryToUTXO(mempoolEntry: IMempoolEntry): Promise<IUTXO> {
    //Mempool items might not have the script attbribute, we need it
    const out = (await this.rpc("gettxout", [
      mempoolEntry.txid,
      mempoolEntry.index,
      true,
    ])) as any;

    const utxo = {
      ...mempoolEntry,
      script: out.scriptPubKey.hex,
      outputIndex: mempoolEntry.index,
      value: mempoolEntry.satoshis / 1e8,
    };
    return utxo;
  }

  /**
   * Get list of spendable UTXOs in mempool.
   * Note: a UTXO in mempool can already be "being spent"
   * @param mempool (optional)
   * @returns list of UTXOs in mempool ready to spend
   */
  async getUTXOsInMempool(mempool?: IMempoolEntry[]) {
    //If no mempool argument, fetch mempool
    let _mempool = mempool;
    if (!_mempool) {
      const m = await this.getMempool();
      _mempool = m;
    }
    const mySet = new Set();
    for (let item of _mempool) {
      if (!item.prevtxid) {
        continue;
      }
      const value = item.prevtxid + "_" + item.prevout;
      mySet.add(value);
    }

    const spendable = _mempool.filter((item) => {
      if (item.satoshis < 0) {
        return false;
      }
      const value = item.txid + "_" + item.index;
      return mySet.has(value) === false;
    });

    const utxos: IUTXO[] = [];

    for (let s of spendable) {
      const u = await this.convertMempoolEntryToUTXO(s);
      utxos.push(u);
    }
    return utxos;
  }
}

export default {
  createInstance,
  getBaseCurrencyByNetwork,
};
export async function createInstance(options: IOptions): Promise<Wallet> {
  const wallet = new Wallet();
  await wallet.init(options);
  return wallet;
}
