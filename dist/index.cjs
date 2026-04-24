'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var neuraiRpc = require('@neuraiproject/neurai-rpc');
var NeuraiKey = require('@neuraiproject/neurai-key');
var neuraiCreateTransaction = require('@neuraiproject/neurai-create-transaction');
var Signer = require('@neuraiproject/neurai-sign-transaction');
var NeuraiAssets = require('@neuraiproject/neurai-assets');
var neuraiScripts = require('@neuraiproject/neurai-scripts');

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var neuraiScripts__namespace = /*#__PURE__*/_interopNamespaceDefault(neuraiScripts);

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

const LEGACY_INPUT_VBYTES = 148;
const PQ_INPUT_VBYTES = 976;
const LEGACY_OUTPUT_BYTES = 34;
const PQ_OUTPUT_BYTES = 31;
const DEFAULT_FEE_RATE_XNA_PER_KB = 0.05;
const SATS_PER_XNA = 100_000_000;
function xnaToSats(xna) {
    // Avoid floating point drift by going through string-rounded sats
    return BigInt(Math.round(xna * SATS_PER_XNA));
}
function isPQAddress(address) {
    return address.startsWith("nq1") || address.startsWith("tnq1");
}
function isPQUTXO(utxo) {
    return utxo.script?.startsWith("5120") === true;
}
function utxoKey(utxo) {
    return `${utxo.txid}:${utxo.outputIndex}`;
}
function buildUTXOMap(utxos) {
    return new Map(utxos.map((u) => [utxoKey(u), u]));
}
function selectUTXOs(utxos, assetName, amount) {
    const result = [];
    let sum = 0;
    // Forced UTXOs always go in first
    for (const u of utxos) {
        if (u.forced === true && u.assetName === assetName) {
            result.push(u);
            sum += u.satoshis / SATS_PER_XNA;
        }
    }
    for (const u of utxos) {
        if (u.forced === true)
            continue;
        if (u.assetName !== assetName)
            continue;
        if (u.satoshis === 0)
            continue;
        if (sum > amount)
            break;
        result.push(u);
        sum += u.satoshis / SATS_PER_XNA;
    }
    if (sum < amount) {
        throw new InsufficientFundsError(`You do not have ${amount} ${assetName} you only have ${sum}`);
    }
    return result;
}
function estimateSizeKB(inputs, outputAddresses) {
    const hasPQInputs = inputs.some(isPQUTXO);
    const baseSize = hasPQInputs ? 12 : 10;
    const inputBytes = inputs.reduce((t, u) => t + (isPQUTXO(u) ? PQ_INPUT_VBYTES : LEGACY_INPUT_VBYTES), 0);
    const outputBytes = outputAddresses.reduce((t, a) => t + (isPQAddress(a) ? PQ_OUTPUT_BYTES : LEGACY_OUTPUT_BYTES), 0);
    return (baseSize + inputBytes + outputBytes) / 1024;
}
async function getFeeRate(wallet) {
    try {
        const confirmationTarget = 20;
        const response = (await wallet.rpc("estimatesmartfee", [
            confirmationTarget,
        ]));
        if (response && !response.errors && typeof response.feerate === "number") {
            return response.feerate;
        }
    }
    catch {
        // Falls through to default
    }
    return DEFAULT_FEE_RATE_XNA_PER_KB;
}
function utxosToTxInputs(utxos) {
    return utxos.map((u) => ({ txid: u.txid, vout: u.outputIndex }));
}
function buildPrivateKeyMap(wallet, utxos, forcedExtras = []) {
    const keys = {};
    for (const u of utxos) {
        const material = wallet.getPrivateKeyByAddress(u.address);
        if (material)
            keys[u.address] = material;
    }
    for (const f of forcedExtras) {
        keys[f.address] = f.privateKey;
    }
    return keys;
}
function signRawTransaction(network, rawTxHex, utxos, privateKeys) {
    return Signer.sign(network, rawTxHex, utxos, privateKeys);
}
async function broadcastSignedTransaction(wallet, signedHex) {
    return (await wallet.rpc("sendrawtransaction", [signedHex]));
}
/**
 * Load all spendable UTXOs (XNA + assets, including unspent mempool entries)
 * plus the current fee rate. Mirrors the discovery the old SendManyTransaction
 * did during loadData(), centralised so any builder can reuse it.
 */
async function loadSpendableFunds(wallet, forcedUTXOs = []) {
    const [mempool, assetUTXOs, baseUTXOs, feeRate] = await Promise.all([
        wallet.getMempool(),
        wallet.getAssetUTXOs(),
        wallet.getUTXOs(),
        getFeeRate(wallet),
    ]);
    const mempoolUTXOs = await wallet.getUTXOsInMempool(mempool);
    const all = [...forcedUTXOs, ...assetUTXOs, ...baseUTXOs, ...mempoolUTXOs];
    // Drop UTXOs already being spent in the mempool (unless forced)
    const filtered = all.filter((u) => {
        if (u.forced === true)
            return true;
        return !mempool.find((m) => m.prevtxid === u.txid && m.prevout === u.outputIndex);
    });
    // Deduplicate by txid:vout (forced UTXOs were unshifted first so they win)
    const seen = new Set();
    const unique = [];
    for (const u of filtered) {
        const k = utxoKey(u);
        if (seen.has(k))
            continue;
        seen.add(k);
        unique.push(u);
    }
    return { utxos: unique, feeRate };
}
function shortenNumber(value) {
    return parseFloat(value.toFixed(8));
}

const FIXED_FEE_XNA = 0.02; // pre-broadcast estimate; user pays this from XNA balance
/**
 * Sweep all UTXOs (XNA + assets) held by `WIF` into the wallet's first
 * addresses. Sweeping PQ private keys is not supported.
 */
async function sweep(WIF, wallet, onlineMode) {
    if (wallet.network === "xna-pq" || wallet.network === "xna-pq-test") {
        throw new Error("Sweeping WIF private keys is not supported on PQ wallets");
    }
    const privateKey = NeuraiKey.getAddressByWIF(wallet.network, WIF);
    const result = {};
    const rpc = wallet.rpc;
    const baseCurrencyUTXOs = (await rpc("getaddressutxos", [
        { addresses: [privateKey.address] },
    ]));
    const assetUTXOs = (await rpc("getaddressutxos", [
        { addresses: [privateKey.address], assetName: "*" },
    ]));
    const UTXOs = assetUTXOs.concat(baseCurrencyUTXOs);
    result.UTXOs = UTXOs;
    if (UTXOs.length === 0) {
        result.errorDescription = `Address ${privateKey.address} has no funds`;
        return result;
    }
    // Total per asset (in satoshis)
    const balanceByAsset = {};
    for (const u of UTXOs) {
        balanceByAsset[u.assetName] = (balanceByAsset[u.assetName] ?? 0) + u.satoshis;
    }
    // Build outputs: each asset goes to a different wallet address
    const outputs = {};
    const transfers = [];
    const payments = [];
    Object.keys(balanceByAsset).forEach((assetName, index) => {
        const destination = wallet.getAddresses()[index];
        const amount = balanceByAsset[assetName] / 1e8;
        if (assetName === wallet.baseCurrency) {
            const sendAmount = shortenNumber(amount - FIXED_FEE_XNA);
            outputs[destination] = sendAmount;
            payments.push({
                address: destination,
                valueSats: xnaToSats(sendAmount),
            });
        }
        else {
            outputs[destination] = { transfer: { [assetName]: amount } };
            transfers.push({
                address: destination,
                assetName,
                amountRaw: BigInt(balanceByAsset[assetName]),
            });
        }
    });
    result.outputs = outputs;
    const inputs = utxosToTxInputs(UTXOs);
    const built = transfers.length > 0
        ? neuraiCreateTransaction.createStandardAssetTransferTransaction({ inputs, payments, transfers })
        : neuraiCreateTransaction.createPaymentTransaction({ inputs, payments });
    const signedHex = signRawTransaction(wallet.network, built.rawTx, UTXOs, { [privateKey.address]: WIF });
    result.rawTransaction = signedHex;
    if (onlineMode === true) {
        result.transactionId = await broadcastSignedTransaction(wallet, signedHex);
    }
    return result;
}

function isAssetTransfer(wallet, assetName) {
    return assetName !== wallet.baseCurrency;
}
function totalAmount(outputs) {
    return Object.values(outputs).reduce((t, v) => t + v, 0);
}
function sumByAsset(utxos, assetName) {
    let sum = 0;
    for (const u of utxos) {
        if (u.assetName !== assetName)
            continue;
        sum += u.satoshis / 1e8;
    }
    return sum;
}
function tagForcedUTXOs(forced) {
    if (!forced || forced.length === 0)
        return [];
    return forced.map((f) => ({ ...f.utxo, forced: true }));
}
async function buildSendManyInternal(wallet, options) {
    const assetName = options.assetName || wallet.baseCurrency;
    const outputs = options.outputs;
    if (!outputs || Object.keys(outputs).length === 0) {
        throw new ValidationError("outputs is mandatory");
    }
    const forcedUTXOs = tagForcedUTXOs(options.forcedUTXOs);
    const { utxos: allUTXOs, feeRate } = await loadSpendableFunds(wallet, forcedUTXOs);
    const amount = totalAmount(outputs);
    const transferring = isAssetTransfer(wallet, assetName);
    const changeAddressBaseCurrency = options.forcedChangeAddressBaseCurrency ||
        (await wallet.getChangeAddress());
    const toAddresses = Object.keys(outputs);
    if (toAddresses.includes(changeAddressBaseCurrency)) {
        throw new ValidationError("Change address cannot be the same as to address");
    }
    let assetChange = 0;
    let assetUTXOs = [];
    let baseCurrencyUTXOs = [];
    let baseCurrencyAmount;
    let changeAddressAsset = "";
    if (transferring) {
        assetUTXOs = selectUTXOs(allUTXOs, assetName, amount);
        assetChange = sumByAsset(assetUTXOs, assetName) - amount;
        // For asset transfers we still need XNA UTXOs to pay the fee
        const previewSelection = selectUTXOs(allUTXOs, wallet.baseCurrency, 0.001);
        const previewSize = estimateSizeKB([...assetUTXOs, ...previewSelection], [...toAddresses, changeAddressBaseCurrency]);
        baseCurrencyAmount = previewSize * feeRate;
        baseCurrencyUTXOs = selectUTXOs(allUTXOs, wallet.baseCurrency, baseCurrencyAmount);
        changeAddressAsset =
            options.forcedChangeAddressAssets ||
                (await wallet.getAssetChangeAddress());
        if (toAddresses.includes(changeAddressAsset)) {
            throw new ValidationError("Change address cannot be the same as to address");
        }
    }
    else {
        baseCurrencyAmount = amount;
        baseCurrencyUTXOs = selectUTXOs(allUTXOs, wallet.baseCurrency, baseCurrencyAmount);
        // refine fee based on chosen inputs
        const sizeKb = estimateSizeKB(baseCurrencyUTXOs, [
            ...toAddresses,
            changeAddressBaseCurrency,
        ]);
        const fee = sizeKb * feeRate;
        baseCurrencyAmount = amount + fee;
        baseCurrencyUTXOs = selectUTXOs(allUTXOs, wallet.baseCurrency, baseCurrencyAmount);
    }
    const selectedUTXOs = transferring
        ? [...assetUTXOs, ...baseCurrencyUTXOs]
        : baseCurrencyUTXOs;
    const sizeKb = estimateSizeKB(selectedUTXOs, transferring
        ? [...toAddresses, changeAddressBaseCurrency, changeAddressAsset]
        : [...toAddresses, changeAddressBaseCurrency]);
    const fee = sizeKb * feeRate;
    const baseCurrencySpent = transferring ? fee : amount + fee;
    const baseCurrencyAvailable = sumByAsset(baseCurrencyUTXOs, wallet.baseCurrency);
    const baseCurrencyChange = shortenNumber(baseCurrencyAvailable - baseCurrencySpent);
    // Compose the user-facing outputs object (mirrors the old SendManyTransaction shape)
    const totalOutputs = {};
    if (transferring) {
        totalOutputs[changeAddressBaseCurrency] = baseCurrencyChange;
        if (assetChange > 0) {
            totalOutputs[changeAddressAsset] = {
                transfer: { [assetName]: shortenNumber(assetChange) },
            };
        }
        for (const addy of toAddresses) {
            totalOutputs[addy] = { transfer: { [assetName]: outputs[addy] } };
        }
    }
    else {
        for (const addy of toAddresses) {
            totalOutputs[addy] = outputs[addy];
        }
        totalOutputs[changeAddressBaseCurrency] = baseCurrencyChange;
    }
    // Build the actual rawTx via neurai-create-transaction
    const inputs = utxosToTxInputs(selectedUTXOs);
    const network = wallet.network;
    const rawTxHex = transferring
        ? buildAssetTransferRawTx(network, inputs, {
            toAddressAmounts: outputs,
            assetName,
            baseCurrencyChangeAddress: changeAddressBaseCurrency,
            baseCurrencyChange,
            assetChangeAddress: changeAddressAsset,
            assetChange: shortenNumber(assetChange),
        })
        : buildPaymentRawTx(network, inputs, totalOutputs);
    const forcedExtras = options.forcedUTXOs?.map((f) => ({
        address: f.address,
        privateKey: f.privateKey,
    }));
    const privateKeys = buildPrivateKeyMap(wallet, selectedUTXOs, forcedExtras);
    const signedHex = signRawTransaction(network, rawTxHex, selectedUTXOs, privateKeys);
    const walletMempool = await wallet.getMempool();
    return {
        rawTxHex,
        signedHex,
        inputs: selectedUTXOs,
        outputs: totalOutputs,
        fee,
        baseCurrencyAmount: transferring ? fee : amount + fee,
        baseCurrencyChange,
        assetChange: transferring ? shortenNumber(assetChange) : 0,
        walletMempool,
    };
}
function buildPaymentRawTx(_network, inputs, payments) {
    const txPayments = Object.entries(payments).map(([address, amountXna]) => ({
        address,
        valueSats: xnaToSats(amountXna),
    }));
    const built = neuraiCreateTransaction.createPaymentTransaction({ inputs, payments: txPayments });
    return built.rawTx;
}
function buildAssetTransferRawTx(_network, inputs, spec) {
    const transfers = [];
    for (const [address, amount] of Object.entries(spec.toAddressAmounts)) {
        transfers.push({ address, assetName: spec.assetName, amountRaw: xnaToSats(amount) });
    }
    if (spec.assetChange > 0) {
        transfers.push({
            address: spec.assetChangeAddress,
            assetName: spec.assetName,
            amountRaw: xnaToSats(spec.assetChange),
        });
    }
    const payments = [];
    if (spec.baseCurrencyChange > 0) {
        payments.push({
            address: spec.baseCurrencyChangeAddress,
            valueSats: xnaToSats(spec.baseCurrencyChange),
        });
    }
    const built = neuraiCreateTransaction.createStandardAssetTransferTransaction({
        inputs,
        payments,
        transfers,
    });
    return built.rawTx;
}
function toSendResult(build, params) {
    return {
        transactionId: params.transactionId ?? null,
        debug: {
            amount: params.amount,
            assetName: params.assetName,
            fee: build.fee,
            inputs: build.inputs.map((u) => ({
                txid: u.txid,
                vout: u.outputIndex,
                address: u.address,
            })),
            outputs: build.outputs,
            rawUnsignedTransaction: build.rawTxHex,
            xnaAmount: build.baseCurrencyAmount,
            xnaChangeAmount: build.baseCurrencyChange,
            signedTransaction: build.signedHex,
            UTXOs: build.inputs,
            walletMempool: build.walletMempool,
        },
    };
}
async function createTransactionForOptions(wallet, options) {
    if (!options.toAddress)
        throw Error("toAddress is mandatory");
    if (!options.amount)
        throw Error("amount is mandatory");
    const assetName = options.assetName || wallet.baseCurrency;
    const build = await buildSendManyInternal(wallet, {
        assetName,
        outputs: { [options.toAddress]: options.amount },
        forcedChangeAddressAssets: options.forcedChangeAddressAssets,
        forcedChangeAddressBaseCurrency: options.forcedChangeAddressBaseCurrency,
        forcedUTXOs: options.forcedUTXOs,
    });
    return toSendResult(build, { amount: options.amount, assetName });
}
async function createSendManyForOptions(wallet, options) {
    const assetName = options.assetName || wallet.baseCurrency;
    const build = await buildSendManyInternal(wallet, options);
    const amount = totalAmount(options.outputs);
    return toSendResult(build, { amount, assetName });
}
async function broadcastBuilt(wallet, result) {
    if (!result.debug.signedTransaction) {
        throw new Error("No signed transaction to broadcast");
    }
    const txid = await broadcastSignedTransaction(wallet, result.debug.signedTransaction);
    result.transactionId = txid;
    return result;
}

function getAssetPackageNetwork(network) {
    if (network === "xna-legacy-test")
        return "xna-test";
    if (network === "xna-legacy")
        return "xna";
    return network;
}
function stringifyUnknown(value) {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function describeRpcError(error) {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "string")
        return error;
    if (error && typeof error === "object") {
        const value = error;
        if (value.error && typeof value.error === "object") {
            const rpcError = value.error;
            if (rpcError.message) {
                return rpcError.code
                    ? `${String(rpcError.message)} (code ${String(rpcError.code)})`
                    : String(rpcError.message);
            }
            return stringifyUnknown(value.error);
        }
        if (value.error)
            return stringifyUnknown(value.error);
        if (value.description)
            return stringifyUnknown(value.description);
        if (value.status || value.statusText) {
            return `HTTP ${String(value.status ?? "")} ${String(value.statusText ?? "")}`.trim();
        }
        return stringifyUnknown(error);
    }
    return "Unknown RPC error";
}
function normalizeAssetRpcQuantities(value) {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeAssetRpcQuantities(item));
    }
    if (!value || typeof value !== "object")
        return value;
    const input = value;
    const output = {};
    for (const [key, child] of Object.entries(input)) {
        // neurai-assets currently emits asset_quantity scaled by 1e8; the node RPC
        // expects raw units scaled by the asset's declared decimals.
        if (key === "asset_quantity" &&
            typeof child === "number" &&
            typeof input.units === "number") {
            output[key] = Math.round(child / Math.pow(10, 8 - input.units));
            continue;
        }
        output[key] = normalizeAssetRpcQuantities(child);
    }
    return output;
}
function normalizeAssetRpcParams(method, params) {
    if (method !== "createrawtransaction" || params.length < 2)
        return params;
    return [params[0], normalizeAssetRpcQuantities(params[1]), ...params.slice(2)];
}
function createAssetRpc(wallet) {
    return async (method, p) => {
        try {
            const params = normalizeAssetRpcParams(method, p ?? []);
            const result = await wallet.rpc(method, params);
            if (method === "createrawtransaction" && !result) {
                throw new Error("createrawtransaction returned an empty result");
            }
            return result;
        }
        catch (error) {
            throw new Error(`RPC ${method} failed: ${describeRpcError(error)}`);
        }
    };
}
class WalletAssets {
    queries;
    wallet;
    constructor(wallet) {
        this.wallet = wallet;
        const rpc = (method, params) => this.wallet.rpc(method, params ?? []);
        this.queries = new NeuraiAssets.AssetQueries(rpc);
    }
    // --- Asset issuance ---
    async issueRoot(params) {
        return this._exec((assets, params2) => assets.createRootAsset(params2), params);
    }
    async issueSub(params) {
        return this._exec((assets, p) => assets.createSubAsset(p), params);
    }
    async issueDepin(params) {
        return this._exec((assets, p) => assets.createDepinAsset(p), params);
    }
    async issueUnique(params) {
        return this._exec((assets, p) => assets.createUniqueAssets(p), params);
    }
    async issueQualifier(params) {
        return this._exec((assets, p) => assets.createQualifier(p), params);
    }
    async issueRestricted(params) {
        return this._exec((assets, p) => assets.createRestrictedAsset(p), params);
    }
    // --- Reissue ---
    async reissue(params) {
        return this._exec((assets, p) => assets.reissueAsset(p), params);
    }
    async reissueRestricted(params) {
        return this._exec((assets, p) => assets.reissueRestrictedAsset(p), params);
    }
    // --- Tag / untag (qualifier) ---
    async tagAddresses(params) {
        return this._exec((assets, p) => assets.tagAddresses(p), params);
    }
    async untagAddresses(params) {
        return this._exec((assets, p) => assets.untagAddresses(p), params);
    }
    // --- Freeze (restricted assets) ---
    async freezeAddresses(params) {
        return this._exec((assets, p) => assets.freezeAddresses(p), params);
    }
    async unfreezeAddresses(params) {
        return this._exec((assets, p) => assets.unfreezeAddresses(p), params);
    }
    async freezeAssetGlobally(params) {
        return this._exec((assets, p) => assets.freezeAssetGlobally(p), params);
    }
    async unfreezeAssetGlobally(params) {
        return this._exec((assets, p) => assets.unfreezeAssetGlobally(p), params);
    }
    // --- Internals ---
    async _exec(op, rawParams) {
        const params = rawParams;
        const broadcast = params.broadcast !== false;
        const toAddress = params.toAddress || (await this.wallet.getReceiveAddress());
        const changeAddress = params.changeAddress || (await this.wallet.getChangeAddress());
        const rpc = createAssetRpc(this.wallet);
        const network = getAssetPackageNetwork(this.wallet.network);
        const assets = new NeuraiAssets(rpc, {
            network,
            addresses: this.wallet.getAddresses(),
            changeAddress,
            toAddress,
        });
        const opParams = { ...params };
        delete opParams.broadcast;
        delete opParams.toAddress;
        delete opParams.changeAddress;
        const result = await op(assets, {
            ...opParams,
            toAddress,
            changeAddress,
            walletAddresses: this.wallet.getAddresses(),
            network,
        });
        const signedHex = await this._signResult(result);
        let txid = null;
        if (broadcast) {
            txid = await broadcastSignedTransaction(this.wallet, signedHex);
        }
        return {
            transactionId: txid,
            rawTx: result.rawTx,
            signedTransaction: signedHex,
            fee: result.fee,
            burnAmount: result.burnAmount,
            changeAddress: result.changeAddress,
            changeAmount: result.changeAmount,
            inputs: (result.inputs ?? []).map((i) => ({
                txid: i.txid,
                vout: i.vout,
                address: i.address,
            })),
            outputs: result.outputs ?? [],
            assetData: result.assetData,
            raw: result,
        };
    }
    /**
     * Recover the full IUTXO objects for the inputs the assets builder selected,
     * then sign with the wallet's private keys.
     */
    async _signResult(result) {
        const { utxos: spendable } = await loadSpendableFunds(this.wallet);
        const map = buildUTXOMap(spendable);
        const inputUTXOs = [];
        for (const i of result.inputs ?? []) {
            const key = utxoKey({ txid: i.txid, outputIndex: i.vout });
            const found = map.get(key);
            if (found) {
                inputUTXOs.push(found);
                continue;
            }
            // Fallback: synthesize a minimal UTXO from the BuildInput; sign-tx
            // requires `script` so try to reconstruct it.
            throw new Error(`Could not find UTXO ${key} in the wallet's spendable set; cannot sign asset op`);
        }
        const privateKeys = buildPrivateKeyMap(this.wallet, inputUTXOs);
        return signRawTransaction(this.wallet.network, result.rawTx, inputUTXOs, privateKeys);
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
    /**
     * High-level asset operations (issue/reissue/freeze/tag) and queries,
     * backed by `@neuraiproject/neurai-assets`. Initialised lazily on first
     * access so the constructor stays cheap.
     */
    _assets = null;
    get assets() {
        if (!this._assets)
            this._assets = new WalletAssets(this);
        return this._assets;
    }
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
            options.network === "xna-legacy-test" ||
            options.network === "xna-pq-test") {
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
        const sendResult = await this.createTransaction(options);
        return broadcastBuilt(this, sendResult);
    }
    async sendMany({ outputs, assetName }) {
        const sendResult = await this.createSendManyTransaction({
            outputs,
            assetName,
            wallet: this,
        });
        return broadcastBuilt(this, sendResult);
    }
    /**
     * Build (but do not broadcast) a single-output transaction.
     * Returns an `ISendResult` with `signedTransaction` ready to broadcast.
     */
    async createTransaction(options) {
        return createTransactionForOptions(this, {
            amount: options.amount,
            assetName: options.assetName ?? this.baseCurrency,
            toAddress: options.toAddress,
            forcedUTXOs: options.forcedUTXOs,
            forcedChangeAddressBaseCurrency: options.forcedChangeAddressBaseCurrency,
            ...(options.forcedChangeAddressAssets
                ? { forcedChangeAddressAssets: options.forcedChangeAddressAssets }
                : {}),
        });
    }
    /**
     * Build (but do not broadcast) a multi-output transaction.
     */
    async createSendManyTransaction(options) {
        if (!options.outputs || Object.keys(options.outputs).length === 0) {
            throw new ValidationError("outputs is mandatory, should be an object with address as keys and amounts (numbers) as values");
        }
        return createSendManyForOptions(this, {
            assetName: options.assetName ?? this.baseCurrency,
            outputs: options.outputs,
            forcedUTXOs: options.forcedUTXOs,
            forcedChangeAddressAssets: options.forcedChangeAddressAssets,
            forcedChangeAddressBaseCurrency: options.forcedChangeAddressBaseCurrency,
        });
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
    // --- Asset operation shortcuts ---
    // Each delegates to wallet.assets so callers can write either:
    //   wallet.issueRoot({...})           or   wallet.assets.issueRoot({...})
    issueRoot(params) {
        return this.assets.issueRoot(params);
    }
    issueSub(params) {
        return this.assets.issueSub(params);
    }
    issueDepin(params) {
        return this.assets.issueDepin(params);
    }
    issueUnique(params) {
        return this.assets.issueUnique(params);
    }
    issueQualifier(params) {
        return this.assets.issueQualifier(params);
    }
    issueRestricted(params) {
        return this.assets.issueRestricted(params);
    }
    reissue(params) {
        return this.assets.reissue(params);
    }
    reissueRestricted(params) {
        return this.assets.reissueRestricted(params);
    }
    tagAddresses(params) {
        return this.assets.tagAddresses(params);
    }
    untagAddresses(params) {
        return this.assets.untagAddresses(params);
    }
    freezeAddresses(params) {
        return this.assets.freezeAddresses(params);
    }
    unfreezeAddresses(params) {
        return this.assets.unfreezeAddresses(params);
    }
    freezeAssetGlobally(params) {
        return this.assets.freezeAssetGlobally(params);
    }
    unfreezeAssetGlobally(params) {
        return this.assets.unfreezeAssetGlobally(params);
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

Object.defineProperty(exports, "entropyToMnemonic", {
    enumerable: true,
    get: function () { return NeuraiKey.entropyToMnemonic; }
});
Object.defineProperty(exports, "generateMnemonic", {
    enumerable: true,
    get: function () { return NeuraiKey.generateMnemonic; }
});
Object.defineProperty(exports, "isMnemonicValid", {
    enumerable: true,
    get: function () { return NeuraiKey.isMnemonicValid; }
});
exports.scripts = neuraiScripts__namespace;
exports.Wallet = Wallet;
exports.createInstance = createInstance;
exports.default = neuraiWallet;
//# sourceMappingURL=index.cjs.map
