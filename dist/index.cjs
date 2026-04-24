'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var neuraiRpc = require('@neuraiproject/neurai-rpc');
var NeuraiKey = require('@neuraiproject/neurai-key');
var Signer = require('@neuraiproject/neurai-sign-transaction');

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ValidationError";
    }
}
class InsufficientFundsError extends Error {
    constructor(message) {
        super(message);
        this.name = "InsufficientFundsError";
    }
}

function removeDuplicates(originalArray) {
    const uniqueArray = [];
    const seen = new Set();
    originalArray.forEach((item) => {
        const uniqueIdentifier = item.txid + item.outputIndex;
        if (!seen.has(uniqueIdentifier)) {
            seen.add(uniqueIdentifier);
            uniqueArray.push(item);
        }
    });
    return uniqueArray;
}

const LEGACY_INPUT_VBYTES = 148;
const PQ_INPUT_VBYTES = 976;
const LEGACY_OUTPUT_BYTES = 34;
const PQ_OUTPUT_BYTES = 31;
function isPQAddress(address) {
    return address.startsWith("nq1") || address.startsWith("tnq1");
}
function isPQScript(script) {
    return script.startsWith("5114");
}
/**
 * SendManyTransaction Class
 *
 * This class is responsible for calculating the necessary steps to broadcast a Neurai transaction:
 * 1) Identify available UTXOs that are not already spent in the mempool.
 * 2) Determine the required number of UTXOs for creating this transaction.
 * 3) Define the transaction's inputs and outputs.
 * 4) Sign the transaction.
 *
 * Note: this class does not do the actual broadcasting; it is up to the user.
 *
 * How does it work?
 * 1) Create an instance:
 *    const transaction = new SendManyTransaction({
 *      assetName,
 *      outputs: options.outputs,
 *      wallet: this,
 *    });
 *
 * 2) Load data from the network:
 *    transaction.loadData();
 */
class SendManyTransaction {
    _allUTXOs; //all UTXOs that we know of
    assetName;
    // Fee rate used by getFee(): XNA per KB
    feerate = 0.05;
    wallet;
    outputs;
    walletMempool = [];
    forcedUTXOs = [];
    forcedChangeAddressBaseCurrency = "";
    forcedChangeAddressAssets = "";
    constructor(options) {
        const { wallet, outputs, assetName } = options;
        this.assetName = !assetName ? wallet.baseCurrency : assetName;
        this.wallet = wallet;
        this.outputs = outputs;
        this.forcedChangeAddressAssets = options.forcedChangeAddressAssets;
        this.forcedChangeAddressBaseCurrency =
            options.forcedChangeAddressBaseCurrency;
        //Tag forced UTXOs with the "force" flag
        if (options.forcedUTXOs) {
            options.forcedUTXOs.map((f) => (f.utxo.forced = true));
            this.forcedUTXOs = options.forcedUTXOs;
        }
    }
    /**
     *
     * @returns forced UTXOs for this transaction, that means "no matter want, spend this UTXO"
     */
    getForcedUTXOs() {
        return this.forcedUTXOs;
    }
    getWalletMempool() {
        return this.walletMempool;
    }
    getSizeInKB() {
        // We need to estimate the size of the transaction to calculate the fee,
        // which in turn affects the transaction size itself.
        // This is a chicken-and-egg situation, requiring an initial size estimate.
        const utxos = this.predictUTXOs();
        const hasPQInputs = utxos.some((utxo) => isPQScript(utxo.script));
        const baseSize = hasPQInputs ? 12 : 10; // Segwit marker/flag only when witness is present
        const inputBytes = utxos.reduce((total, utxo) => {
            return total + (isPQScript(utxo.script) ? PQ_INPUT_VBYTES : LEGACY_INPUT_VBYTES);
        }, 0);
        const outputBytes = Object.keys(this.outputs).reduce((total, address) => {
            return total + (isPQAddress(address) ? PQ_OUTPUT_BYTES : LEGACY_OUTPUT_BYTES);
        }, 0);
        const kb = (baseSize + inputBytes + outputBytes) / 1024;
        return kb;
    }
    async loadData() {
        //Load blockchain information async, and wait for it
        const mempoolPromise = this.wallet.getMempool();
        const assetUTXOsPromise = this.wallet.getAssetUTXOs();
        const baseCurencyUTXOsPromise = this.wallet.getUTXOs();
        const feeRatePromise = this.getFeeRate();
        this.walletMempool = await mempoolPromise;
        const assetUTXOs = await assetUTXOsPromise;
        const baseCurrencyUTXOs = (await baseCurencyUTXOsPromise);
        this.feerate = await feeRatePromise;
        const mempoolUTXOs = await this.wallet.getUTXOsInMempool(this.walletMempool);
        const _allUTXOsTemp = assetUTXOs
            .concat(baseCurrencyUTXOs)
            .concat(mempoolUTXOs);
        //add forced UTXO to the beginning of the array
        //method getUTXOs will remove all duplicates
        if (this.forcedUTXOs) {
            for (let f of this.forcedUTXOs) {
                const utxo = f.utxo;
                _allUTXOsTemp.unshift(utxo);
            }
        }
        //Collect UTXOs that are not currently being spent in the mempool
        const allUTXOs = _allUTXOsTemp.filter((utxo) => {
            //Always include forced UTXOs
            if (utxo.forced === true) {
                return true;
            }
            const objInMempool = this.walletMempool.find((mempoolEntry) => {
                if (mempoolEntry.prevtxid) {
                    const result = mempoolEntry.prevtxid === utxo.txid &&
                        mempoolEntry.prevout === utxo.outputIndex;
                    return result;
                }
                return false;
            });
            return !objInMempool;
        });
        //Sort utxos lowest first
        //const sorted = allUTXOs.sort(sortBySatoshis);
        //Remove duplicates, like if we have added an UTXO as forced, but it is already
        //in the wallet as a normal UTXO
        this._allUTXOs = removeDuplicates(allUTXOs);
    }
    getAmount() {
        let total = 0;
        const values = Object.values(this.outputs);
        values.map((value) => (total += value));
        return total;
    }
    getUTXOs() {
        //NOTE, if we have FORCED utxos, they have to be included no matter what
        let result = [];
        if (this.isAssetTransfer() === true) {
            const assetAmount = this.getAmount();
            const baseCurrencyAmount = this.getBaseCurrencyAmount();
            const baseCurrencyUTXOs = getEnoughUTXOs(this._allUTXOs, this.wallet.baseCurrency, baseCurrencyAmount);
            const assetUTXOs = getEnoughUTXOs(this._allUTXOs, this.assetName, assetAmount);
            result = assetUTXOs.concat(baseCurrencyUTXOs);
        }
        else {
            result = getEnoughUTXOs(this._allUTXOs, this.wallet.baseCurrency, this.getBaseCurrencyAmount());
        }
        return result;
    }
    /*
    Check the blockchain, network.
    Is this transaction still valid? Will it be accepted?
    */
    validate() { }
    predictUTXOs() {
        let utxos = [];
        if (this.isAssetTransfer()) {
            utxos = getEnoughUTXOs(this._allUTXOs, this.assetName, this.getAmount());
        }
        else {
            utxos = getEnoughUTXOs(this._allUTXOs, this.wallet.baseCurrency, this.getAmount());
        }
        return utxos;
    }
    getBaseCurrencyAmount() {
        const fee = this.getFee();
        if (this.isAssetTransfer() === true) {
            return fee;
        }
        else
            return this.getAmount() + fee;
    }
    getBaseCurrencyChange() {
        const enoughUTXOs = getEnoughUTXOs(this._allUTXOs, this.wallet.baseCurrency, this.getBaseCurrencyAmount());
        let total = 0;
        for (let utxo of enoughUTXOs) {
            if (utxo.assetName !== this.wallet.baseCurrency) {
                continue;
            }
            total = total + utxo.satoshis / 1e8;
        }
        const result = total - this.getBaseCurrencyAmount();
        return shortenNumber(result);
    }
    getAssetChange() {
        const enoughUTXOs = getEnoughUTXOs(this._allUTXOs, this.assetName, this.getAmount());
        let total = 0;
        for (let utxo of enoughUTXOs) {
            if (utxo.assetName !== this.assetName) {
                continue;
            }
            total = total + utxo.satoshis / 1e8;
        }
        return total - this.getAmount();
    }
    isAssetTransfer() {
        return this.assetName !== this.wallet.baseCurrency;
    }
    async getOutputs() {
        //we take the declared outputs and add change outputs
        const totalOutputs = {};
        const changeAddressBaseCurrency = this.forcedChangeAddressBaseCurrency ||
            (await this.wallet.getChangeAddress());
        if (this.isAssetTransfer() === true) {
            //Validate: change address cant be toAddress
            const toAddresses = Object.keys(this.outputs);
            if (toAddresses.includes(changeAddressBaseCurrency) === true) {
                throw new ValidationError("Change address cannot be the same as to address");
            }
            totalOutputs[changeAddressBaseCurrency] = this.getBaseCurrencyChange();
            const changeAddressAsset = await this._getChangeAddressAssets();
            //Validate change address can never be the same as toAddress
            if (toAddresses.includes(changeAddressAsset) === true) {
                throw new ValidationError("Change address cannot be the same as to address");
            }
            if (this.getAssetChange() > 0) {
                totalOutputs[changeAddressAsset] = {
                    transfer: {
                        [this.assetName]: Number(this.getAssetChange().toFixed(8)),
                    },
                };
            }
            for (let addy of Object.keys(this.outputs)) {
                const amount = this.outputs[addy];
                totalOutputs[addy] = {
                    transfer: {
                        [this.assetName]: amount,
                    },
                };
            }
        }
        else {
            for (let addy of Object.keys(this.outputs)) {
                const amount = this.outputs[addy];
                totalOutputs[addy] = amount;
            }
            totalOutputs[changeAddressBaseCurrency] = this.getBaseCurrencyChange();
        }
        return totalOutputs;
    }
    async _getChangeAddressAssets() {
        if (this.forcedChangeAddressAssets) {
            return this.forcedChangeAddressAssets;
        }
        return this.wallet.getAssetChangeAddress();
    }
    getInputs() {
        return this.getUTXOs().map((obj) => {
            return { address: obj.address, txid: obj.txid, vout: obj.outputIndex };
        });
    }
    getPrivateKeys() {
        const addressObjects = this.wallet.getAddressObjects();
        const privateKeys = {};
        for (let u of this.getUTXOs()) {
            //Find the address object (we want the WIF) for the address related to the UTXO
            const addressObject = addressObjects.find((obj) => obj.address === u.address);
            if (addressObject) {
                privateKeys[u.address] = this.wallet.getPrivateKeyByAddress(u.address);
            }
        }
        //Add privatekeys from forcedUTXOs
        this.forcedUTXOs.map((f) => (privateKeys[f.address] = f.privateKey));
        return privateKeys;
    }
    getFee() {
        const kb = this.getSizeInKB();
        const result = kb * this.feerate;
        return result;
    }
    async getFeeRate() {
        const defaultFee = 0.05;
        try {
            const confirmationTarget = 20;
            const response = (await this.wallet.rpc("estimatesmartfee", [
                confirmationTarget,
            ]));
            //Errors can occur on testnet, not enough info to calculate fee
            if (!response.errors) {
                return normaliseFee(this.wallet.network, response.feerate);
            }
            else {
                return defaultFee;
            }
        }
        catch (e) {
            //Might occure errors on testnet when calculating fees
            return defaultFee;
        }
    }
}
//Return the number with max 8 decimals
function shortenNumber(number) {
    return parseFloat(number.toFixed(8));
}
function getEnoughUTXOs(utxos, asset, amount) {
    const result = [];
    let sum = 0;
    if (!utxos) {
        throw Error("getEnoughUTXOs cannot be called without utxos");
    }
    //First off, add mandatory/forced UTXO, no matter what
    for (let u of utxos) {
        if (u.forced === true) {
            if (u.assetName === asset) {
                const value = u.satoshis / 1e8;
                result.push(u);
                sum = sum + value;
            }
        }
    }
    //Process NON FORCED utxos
    for (let u of utxos) {
        if (u.forced) {
            continue;
        }
        if (sum > amount) {
            break;
        }
        if (u.assetName !== asset) {
            continue;
        }
        //Ignore UTXOs with zero satoshis, seems to occure when assets are minted
        if (u.satoshis === 0) {
            continue;
        }
        const value = u.satoshis / 1e8;
        result.push(u);
        sum = sum + value;
    }
    if (sum < amount) {
        const error = new InsufficientFundsError("You do not have " + amount + " " + asset + " you only have " + sum);
        throw error;
    }
    return result;
}
function normaliseFee(network, fee) {
    return fee;
}

!!Signer.sign; //"Idiocracy" but prevents bundle tools such as PARCEL to strip this dependency out on build.
/**
 *
 * @param WIF the private key in wallet import format that you want to sweep/empty
 * @param wallet your wallet
 * @returns a string of a signed transaction, you have to broad cast it
 */
async function sweep(WIF, wallet, onlineMode) {
    if (wallet.network === "xna-pq" || wallet.network === "xna-pq-test") {
        throw new Error("Sweeping WIF private keys is not supported on PQ wallets");
    }
    const privateKey = NeuraiKey.getAddressByWIF(wallet.network, WIF);
    const result = {};
    const rpc = wallet.rpc;
    const obj = {
        addresses: [privateKey.address],
    };
    const baseCurrencyUTXOs = (await rpc("getaddressutxos", [obj]));
    const obj2 = {
        addresses: [privateKey.address],
        assetName: "*",
    };
    const assetUTXOs = (await rpc("getaddressutxos", [obj2]));
    const UTXOs = assetUTXOs.concat(baseCurrencyUTXOs);
    result.UTXOs = UTXOs;
    //Create a raw transaction with ALL UTXOs
    if (UTXOs.length === 0) {
        result.errorDescription = "Address " + privateKey.address + " has no funds";
        return result;
    }
    const balanceObject = {};
    UTXOs.map((utxo) => {
        if (!balanceObject[utxo.assetName]) {
            balanceObject[utxo.assetName] = 0;
        }
        balanceObject[utxo.assetName] += utxo.satoshis;
    });
    const keys = Object.keys(balanceObject);
    //Start simple, get the first addresses from the wallet
    const outputs = {};
    const fixedFee = 0.02; // should do for now
    keys.map((assetName, index) => {
        const address = wallet.getAddresses()[index];
        const amount = balanceObject[assetName] / 1e8;
        if (assetName === wallet.baseCurrency) {
            outputs[address] = shortenNumber(amount - fixedFee);
        }
        else {
            outputs[address] = {
                transfer: {
                    [assetName]: amount,
                },
            };
        }
    });
    result.outputs = outputs;
    //Convert from UTXO format to INPUT fomat
    const inputs = UTXOs.map((utxo, index) => {
        /*   {
             "txid":"id",                      (string, required) The transaction id
             "vout":n,                         (number, required) The output number
             "sequence":n                      (number, optional) The sequence number
           }
           */
        const input = {
            txid: utxo.txid,
            vout: utxo.outputIndex,
        };
        return input;
    });
    //Create raw transaction
    const rawHex = (await rpc("createrawtransaction", [inputs, outputs]));
    const privateKeys = {
        [privateKey.address]: WIF,
    };
    const signedHex = Signer.sign(wallet.network, rawHex, UTXOs, privateKeys);
    result.rawTransaction = signedHex;
    if (onlineMode === true) {
        result.transactionId = (await rpc("sendrawtransaction", [signedHex]));
    }
    return result;
}

class Transaction {
    sendManyTransaction;
    constructor(options) {
        //The diff between ITransactionOptions and ISendManyTransactionOptions 
        //is that SendMany has a multi value outputs attribute instead of toAddress
        const _options = {
            ...options,
            outputs: {
                [options.toAddress]: options.amount,
            },
        };
        this.sendManyTransaction = new SendManyTransaction(_options);
    }
    getWalletMempool() {
        return this.sendManyTransaction.getWalletMempool();
    }
    getSizeInKB() {
        return this.sendManyTransaction.getSizeInKB();
    }
    async loadData() {
        return this.sendManyTransaction.loadData();
    }
    getUTXOs() {
        return this.sendManyTransaction.getUTXOs();
    }
    predictUTXOs() {
        return this.sendManyTransaction.predictUTXOs();
    }
    getBaseCurrencyAmount() {
        return this.sendManyTransaction.getBaseCurrencyAmount();
    }
    getBaseCurrencyChange() {
        return this.sendManyTransaction.getBaseCurrencyChange();
    }
    getAssetChange() {
        return this.sendManyTransaction.getAssetChange();
    }
    isAssetTransfer() {
        return this.sendManyTransaction.isAssetTransfer();
    }
    async getOutputs() {
        return this.sendManyTransaction.getOutputs();
    }
    getInputs() {
        return this.sendManyTransaction.getInputs();
    }
    getPrivateKeys() {
        return this.sendManyTransaction.getPrivateKeys();
    }
    getFee() {
        return this.sendManyTransaction.getFee();
    }
    async getFeeRate() {
        return this.sendManyTransaction.getFeeRate();
    }
}

function getBaseCurrencyByNetwork(network) {
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

const ONE_FULL_COIN = 1e8;

async function getBalance(wallet, addresses) {
    const includeAssets = false;
    const params = [{ addresses }, includeAssets];
    const balance = (await wallet.rpc(neuraiRpc.methods.getaddressbalance, params));
    return balance.balance / ONE_FULL_COIN;
}

async function getAssets(wallet, addresses) {
    const includeAssets = true;
    const params = [{ addresses: addresses }, includeAssets];
    const balance = (await wallet.rpc(neuraiRpc.methods.getaddressbalance, params));
    //Remove baseCurrency
    //Convert from satoshis
    const result = balance.filter((obj) => {
        obj.assetName !== wallet.baseCurrency;
        obj.value = 0;
        if (obj.balance > 0) {
            obj.value = obj.balance / 1e8;
        }
        return obj;
    });
    return result;
}

const URL_NEURAI_MAINNET = "https://rpc-main.neurai.org/rpc";
const URL_NEURAI_TESTNET = "https://rpc-testnet.neurai.org/rpc";
// NIP-022 PQ-HD (neurai-key >= 4.0.0): every path level must be hardened.
const PQ_PURPOSE = 100;
const PQ_COIN_TYPE_MAINNET = 1900;
const PQ_COIN_TYPE_TESTNET = 1;
const PQ_CHANGE_INDEX = 0;
function isPQNetwork(network) {
    return network === "xna-pq" || network === "xna-pq-test";
}
function getPQDerivationPath(network, account, index) {
    const coinType = network === "xna-pq" ? PQ_COIN_TYPE_MAINNET : PQ_COIN_TYPE_TESTNET;
    return `m_pq/${PQ_PURPOSE}'/${coinType}'/${account}'/${PQ_CHANGE_INDEX}'/${index}'`;
}
function getSigningMaterial(addressObject) {
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
class Wallet {
    rpc = neuraiRpc.getRPC("anonymous", "anonymous", URL_NEURAI_MAINNET);
    _mnemonic = "";
    _passphrase = "";
    network = "xna";
    addressObjects = [];
    receiveAddress = "";
    changeAddress = "";
    assetChangeAddress = "";
    addressPosition = 0;
    baseCurrency = "XNA";
    offlineMode = false;
    setBaseCurrency(currency) {
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
    sweep(WIF, onlineMode) {
        const wallet = this;
        return sweep(WIF, wallet, onlineMode);
    }
    getAddressObjects() {
        return this.addressObjects;
    }
    getAddresses() {
        const addresses = this.addressObjects.map((obj) => {
            return obj.address;
        });
        return addresses;
    }
    async init(options) {
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
        if (options.network === "xna-test" ||
            options.network === "xna-legacy-test") {
            url = URL_NEURAI_TESTNET;
        }
        url = options.rpc_url || url;
        password = options.rpc_password || password;
        username = options.rpc_username || username;
        if (options.network) {
            this.network = options.network;
            this.setBaseCurrency(getBaseCurrencyByNetwork(options.network));
        }
        this.rpc = neuraiRpc.getRPC(username, password, url);
        this._mnemonic = options.mnemonic;
        this._passphrase = options.passphrase || "";
        //Generating the hd key is slow, so we re-use the object
        const usingPQ = isPQNetwork(this.network);
        const pqNetwork = usingPQ ? this.network : null;
        const legacyNetwork = usingPQ ? null : this.network;
        const pqHDKey = usingPQ
            ? NeuraiKey.getPQHDKey(pqNetwork, this._mnemonic, this._passphrase)
            : null;
        const legacyHDKey = usingPQ
            ? null
            : NeuraiKey.getHDKey(legacyNetwork, this._mnemonic, this._passphrase);
        const coinType = usingPQ ? null : NeuraiKey.getCoinType(legacyNetwork);
        const ACCOUNT = 0;
        const minAmountOfAddresses = Number.isFinite(options.minAmountOfAddresses)
            ? options.minAmountOfAddresses
            : 0;
        let doneDerivingAddresses = false;
        while (doneDerivingAddresses === false) {
            //We add new addresses to tempAddresses so we can check history for the last 20
            const tempAddresses = [];
            for (let i = 0; i < 20; i++) {
                if (usingPQ) {
                    const pqAddress = {
                        ...NeuraiKey.getPQAddressByPath(pqNetwork, pqHDKey, getPQDerivationPath(pqNetwork, ACCOUNT, this.addressPosition)),
                        keyType: "pq",
                    };
                    this.addressObjects.push(pqAddress);
                    this.addressPosition++;
                    tempAddresses.push(pqAddress.address + "");
                }
                else {
                    const external = {
                        ...NeuraiKey.getAddressByPath(legacyNetwork, legacyHDKey, `m/44'/${coinType}'/${ACCOUNT}'/0/${this.addressPosition}`),
                        keyType: "legacy",
                    };
                    const internal = {
                        ...NeuraiKey.getAddressByPath(legacyNetwork, legacyHDKey, `m/44'/${coinType}'/${ACCOUNT}'/1/${this.addressPosition}`),
                        keyType: "legacy",
                    };
                    this.addressObjects.push(external);
                    this.addressObjects.push(internal);
                    this.addressPosition++;
                    tempAddresses.push(external.address + "");
                    tempAddresses.push(internal.address + "");
                }
            }
            if (minAmountOfAddresses &&
                minAmountOfAddresses >= this.addressPosition) {
                //In case we intend to create extra addresses on startup
                doneDerivingAddresses = false;
            }
            else if (this.offlineMode === true) {
                //BREAK generation of addresses and do NOT check history on the network
                doneDerivingAddresses = true;
            }
            else {
                //If no history, break
                doneDerivingAddresses =
                    false === (await this.hasHistory(tempAddresses));
            }
        }
    }
    async hasHistory(addresses) {
        const includeAssets = true;
        const obj = {
            addresses,
        };
        const asdf = (await this.rpc(neuraiRpc.methods.getaddressbalance, [
            obj,
            includeAssets,
        ]));
        //@ts-ignore
        const hasReceived = Object.values(asdf).find((asset) => asset.received > 0);
        return !!hasReceived;
    }
    _getCandidateAddresses(external, excludeAddresses = []) {
        const excluded = new Set(excludeAddresses.filter(Boolean));
        if (isPQNetwork(this.network)) {
            return this.getAddresses().filter((address) => !excluded.has(address));
        }
        const addresses = [];
        this.getAddresses().map(function (address, index) {
            if (external === true && index % 2 === 0) {
                addresses.push(address);
            }
            else if (external === false && index % 2 !== 0) {
                addresses.push(address);
            }
        });
        return addresses.filter((address) => !excluded.has(address));
    }
    async _findFirstUnusedAddress(addresses) {
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
            }
            else {
                low = mid + 1;
            }
        }
        return result;
    }
    async _getFirstUnusedAddress(external, excludeAddresses = []) {
        // Offline mode: return the first candidate without consulting the network.
        // Useful when the caller built the wallet with offlineMode: true and just
        // needs deterministic receive/change addresses (e.g. PQ wallets whose
        // bech32m format is not yet recognised by every RPC node).
        if (this.offlineMode === true) {
            const addresses = this._getCandidateAddresses(external, excludeAddresses);
            const result = addresses[0];
            if (external === true) {
                this.receiveAddress = result;
            }
            else {
                this.changeAddress = result;
            }
            return result;
        }
        //First, check if lastReceivedAddress
        if (external === true &&
            this.receiveAddress &&
            excludeAddresses.includes(this.receiveAddress) === false) {
            const asdf = await this.hasHistory([this.receiveAddress]);
            if (asdf === false) {
                return this.receiveAddress;
            }
        }
        if (external === false &&
            this.changeAddress &&
            excludeAddresses.includes(this.changeAddress) === false) {
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
        }
        else {
            this.changeAddress = result;
        }
        return result;
    }
    async getHistory() {
        const assetName = ""; //Must be empty string, NOT "*"
        const addresses = this.getAddresses();
        const deltas = this.rpc(neuraiRpc.methods.getaddressdeltas, [
            { addresses, assetName },
        ]);
        //@ts-ignore
        const addressDeltas = deltas;
        return addressDeltas;
    }
    async getMempool() {
        const method = neuraiRpc.methods.getaddressmempool;
        const includeAssets = true;
        const params = [{ addresses: this.getAddresses() }, includeAssets];
        return this.rpc(method, params);
    }
    async getReceiveAddress() {
        const excludeAddresses = isPQNetwork(this.network) && this.changeAddress ? [this.changeAddress] : [];
        return this._getFirstUnusedAddress(true, excludeAddresses);
    }
    async getChangeAddress() {
        const excludeAddresses = isPQNetwork(this.network) && this.receiveAddress ? [this.receiveAddress] : [];
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
        if (this.assetChangeAddress &&
            reservedAddresses.includes(this.assetChangeAddress) === false) {
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
    async getAssetUTXOs(assetName) {
        //If no asset name, set to wildcard, meaning all assets
        const _assetName = !assetName ? "*" : assetName;
        const chainInfo = false;
        const params = [
            { addresses: this.getAddresses(), chainInfo, assetName: _assetName },
        ];
        return this.rpc(neuraiRpc.methods.getaddressutxos, params);
    }
    async getUTXOs() {
        return this.rpc(neuraiRpc.methods.getaddressutxos, [
            { addresses: this.getAddresses() },
        ]);
    }
    getPrivateKeyByAddress(address) {
        const f = this.addressObjects.find((a) => a.address === address);
        if (!f) {
            return undefined;
        }
        return getSigningMaterial(f);
    }
    async sendRawTransaction(raw) {
        return this.rpc("sendrawtransaction", [raw]);
    }
    async send(options) {
        //ACTUAL SENDING TRANSACTION
        //Important, do not swallow the exceptions/errors of createTransaction, let them fly
        const sendResult = await this.createTransaction(options);
        const id = (await this.rpc("sendrawtransaction", [
            sendResult.debug.signedTransaction,
        ]));
        sendResult.transactionId = id;
        return sendResult;
    }
    async sendMany({ outputs, assetName }) {
        const options = {
            wallet: this,
            outputs,
            assetName,
        };
        const sendResult = await this.createSendManyTransaction(options);
        //ACTUAL SENDING TRANSACTION
        //Important, do not swallow the exceptions/errors of createSendManyTransaction, let them fly
        try {
            const id = (await this.rpc("sendrawtransaction", [
                sendResult.debug.signedTransaction,
            ]));
            sendResult.transactionId = id;
            return sendResult;
        }
        catch (e) {
            throw new Error("Error while sending, perhaps you have pending transaction? Please try again.");
        }
    }
    /**
     * Does all the heavy lifting regarding creating a SendManyTransaction
     * but it does not broadcast the actual transaction.
     * Perhaps the user wants to accept the transaction fee?
     * @param options
     * @returns An transaction that has not been broadcasted
     */
    async createTransaction(options) {
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
        const raw = (await this.rpc("createrawtransaction", [inputs, outputs]));
        const signed = Signer.sign(this.network, raw, transaction.getUTXOs(), privateKeys);
        try {
            //   const id = await this.rpc("sendrawtransaction", [signed]);
            const sendResult = {
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
        }
        catch (e) {
            throw new Error("Error while sending, perhaps you have pending transaction? Please try again.");
        }
    }
    /**
     * Does all the heavy lifting regarding creating a transaction
     * but it does not broadcast the actual transaction.
     * Perhaps the user wants to accept the transaction fee?
     * @param options
     * @returns An transaction that has not been broadcasted
     */
    async createSendManyTransaction(options) {
        let { assetName } = options;
        if (!assetName) {
            assetName = this.baseCurrency;
        }
        //Validation
        if (!options.outputs) {
            throw Error("Wallet.createSendManyTransaction outputs is mandatory");
        }
        else if (Object.keys(options.outputs).length === 0) {
            throw new ValidationError("outputs is mandatory, shoud be an object with address as keys and amounts (numbers) as values");
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
        const raw = (await this.rpc("createrawtransaction", [inputs, outputs]));
        const signed = Signer.sign(this.network, raw, transaction.getUTXOs(), privateKeys);
        try {
            const sendResult = {
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
        }
        catch (e) {
            throw new Error("Error while sending, perhaps you have pending transaction? Please try again.");
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
    async isSpentInMempool(utxo) {
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
    async convertMempoolEntryToUTXO(mempoolEntry) {
        //Mempool items might not have the script attbribute, we need it
        const out = (await this.rpc("gettxout", [
            mempoolEntry.txid,
            mempoolEntry.index,
            true,
        ]));
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
    async getUTXOsInMempool(mempool) {
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
        const utxos = [];
        for (let s of spendable) {
            const u = await this.convertMempoolEntryToUTXO(s);
            utxos.push(u);
        }
        return utxos;
    }
}
var neuraiWallet = {
    createInstance,
    getBaseCurrencyByNetwork,
};
async function createInstance(options) {
    const wallet = new Wallet();
    await wallet.init(options);
    return wallet;
}

exports.SendManyTransaction = SendManyTransaction;
exports.Transaction = Transaction;
exports.Wallet = Wallet;
exports.createInstance = createInstance;
exports.default = neuraiWallet;
//# sourceMappingURL=index.cjs.map
