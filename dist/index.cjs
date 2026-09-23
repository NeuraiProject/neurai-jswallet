'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var amounts = require('@neuraiproject/neurai-create-transaction/amounts');
var Signer = require('@neuraiproject/neurai-sign-transaction');
var neuraiCreateTransaction = require('@neuraiproject/neurai-create-transaction');
var neuraiRpc = require('@neuraiproject/neurai-rpc');
var NeuraiKey = require('@neuraiproject/neurai-key');
var neuraiAssets = require('@neuraiproject/neurai-assets');
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

var NeuraiKey__namespace = /*#__PURE__*/_interopNamespaceDefault(NeuraiKey);
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

const CHAINS = {
    xna: { family: "legacy", keyNetwork: "xna-legacy", testnet: false, keyType: "legacy", singleBranch: false },
    "xna-test": { family: "legacy", keyNetwork: "xna-legacy-test", testnet: true, keyType: "legacy", singleBranch: false },
    "xna-legacy": { family: "legacy", keyNetwork: "xna-old-legacy", testnet: false, keyType: "legacy", singleBranch: false },
    "xna-legacy-test": { family: "legacy", keyNetwork: "xna-legacy-test", testnet: true, keyType: "legacy", singleBranch: false },
    "xna-pq": { family: "authscript-pq", keyNetwork: "xna-authscript", testnet: false, keyType: "pq", singleBranch: true },
    "xna-pq-test": { family: "authscript-pq", keyNetwork: "xna-authscript-test", testnet: true, keyType: "pq", singleBranch: true },
    "xna-pq-strict": { family: "pq", keyNetwork: "xna-pq", testnet: false, keyType: "pq", singleBranch: true },
    "xna-pq-strict-test": { family: "pq", keyNetwork: "xna-pq-test", testnet: true, keyType: "pq", singleBranch: true },
    "xna-ecdsa": { family: "ecdsa", keyNetwork: "xna", testnet: false, keyType: "ecdsa", singleBranch: false },
    "xna-ecdsa-test": { family: "ecdsa", keyNetwork: "xna-test", testnet: true, keyType: "ecdsa", singleBranch: false },
};
/** Every wallet network name. */
const CHAIN_TYPES = Object.keys(CHAINS);
/**
 * Configuration of a wallet network. Throws on an unknown name instead of
 * silently falling back to mainnet.
 */
function getChainConfig(network) {
    const config = CHAINS[network];
    if (!config) {
        throw new Error(`Unknown network ${JSON.stringify(network)}. Expected one of ${CHAIN_TYPES.join(", ")}`);
    }
    return config;
}
/** True for the networks whose addresses use the native PQ tree. */
function isPQNetwork(network) {
    return getChainConfig(network).singleBranch;
}
/**
 * The network label to hand to neurai-sign-transaction. The signer only uses
 * its chain (WIF version byte and per-network rules), so the neurai-key 5
 * label of the wallet's family is passed.
 */
function getSignerNetwork(network) {
    return getChainConfig(network).keyNetwork;
}
/** neurai-key 5 network of the Legacy P2PKH address of a WIF on this chain. */
function getLegacyKeyNetwork(network) {
    return getChainConfig(network).testnet ? "xna-legacy-test" : "xna-legacy";
}
/** neurai-key 5 network of the ECDSA witness v3 address of a WIF on this chain. */
function getECDSAKeyNetwork(network) {
    return getChainConfig(network).testnet ? "xna-test" : "xna";
}
/**
 * Chain family label for @neuraiproject/neurai-assets: `xna` / `xna-test`
 * for Legacy wallets, `xna-pq` / `xna-pq-test` (its AuthScript label) for the
 * witness families.
 */
function getAssetPackageNetwork(network) {
    const { testnet, family } = getChainConfig(network);
    if (family === "legacy")
        return testnet ? "xna-test" : "xna";
    return testnet ? "xna-pq-test" : "xna-pq";
}

const DEFAULT_FEE_RATE_XNA_PER_KB = 0.05;
const DUST_RELAY_FEE_SATS_PER_KB = 3000n;
const DUST_SIZE_BY_KIND = {
    p2pkh: 34n + 148n,
    authscript: 43n + 41n + 936n,
    pq: 43n + 41n + 936n,
    ecdsa: 43n + 41n + 28n,
};
/** Dust limit (sats) of an output paying `address`, as the node computes it. */
function dustThresholdSats(address) {
    const size = DUST_SIZE_BY_KIND[Signer.getAddressKind(address)] ?? DUST_SIZE_BY_KIND.p2pkh;
    return (size * DUST_RELAY_FEE_SATS_PER_KB) / 1000n;
}
function xnaToSats(xna) {
    return amounts.assertMoneyRange(amounts.decimalToSatoshis(xna));
}
function satsToXna(sats) {
    const raw = amounts.toRawInteger(sats);
    const abs = raw < 0n ? -raw : raw;
    const text = amounts.satoshisToDecimal(raw);
    return abs <= BigInt(Number.MAX_SAFE_INTEGER) ||
        (abs % 100000000n === 0n && abs / 100000000n <= BigInt(Number.MAX_SAFE_INTEGER))
        ? (amounts.decimalToSatoshis(String(Number(text))) === raw ? Number(text) : text) : text;
}
function utxoKey(utxo) {
    return `${utxo.txid}:${utxo.outputIndex}`;
}
function buildUTXOMap(utxos) {
    return new Map(utxos.map((u) => [utxoKey(u), u]));
}
function selectAllUTXOsByAsset(utxos, assetName) {
    const result = [];
    for (const u of utxos) {
        if (u.assetName !== assetName)
            continue;
        if (amounts.toRawInteger(u.satoshis) === 0n)
            continue;
        result.push(u);
    }
    return result;
}
function sumUTXOSatoshis(utxos, assetName) {
    let sum = 0n;
    for (const u of utxos) {
        if (u.assetName !== assetName)
            continue;
        sum += amounts.assertMoneyRange(u.satoshis, 'UTXO satoshis');
    }
    return sum;
}
function feeSatsFromVbytes(vbytes, feeRate) {
    if (!Number.isSafeInteger(vbytes) || vbytes < 0)
        throw new Error('Invalid transaction size');
    // RPC rates are XNA per 1,000 virtual bytes (CFeeRate::GetFeePerK).
    // Round upward: at most one satoshi above the node's integer truncation.
    return (BigInt(vbytes) * xnaToSats(feeRate) + 999n) / 1000n;
}
function selectUTXOs(utxos, assetName, amount) {
    const result = [];
    let sum = 0n;
    const required = xnaToSats(amount);
    // Forced UTXOs always go in first
    for (const u of utxos) {
        if (u.forced === true && u.assetName === assetName) {
            result.push(u);
            sum += amounts.assertMoneyRange(u.satoshis, 'UTXO satoshis');
        }
    }
    for (const u of utxos) {
        if (u.forced === true)
            continue;
        if (u.assetName !== assetName)
            continue;
        if (amounts.toRawInteger(u.satoshis) === 0n)
            continue;
        if (sum >= required)
            break;
        result.push(u);
        sum += amounts.assertMoneyRange(u.satoshis, 'UTXO satoshis');
    }
    if (sum < required) {
        throw new InsufficientFundsError(`You do not have ${amount} ${assetName} you only have ${satsToXna(sum)}`);
    }
    return result;
}
function estimateSizeVbytes(inputs, targets, network = "xna") {
    const payments = targets.filter((t) => typeof t === 'string')
        .map(address => ({ address, valueSats: 0n }));
    const transfers = targets.filter((t) => typeof t !== 'string')
        .map(t => ({ ...t, amountRaw: 0n }));
    const txInputs = utxosToTxInputs(inputs);
    // Amounts and marker contents do not affect size. Both supported markers
    // occupy three bytes. Serialize outputs to include asset payloads and varints.
    const raw = transfers.length
        ? neuraiCreateTransaction.createStandardAssetTransferTransaction({ inputs: txInputs, payments, transfers }).rawTx
        : neuraiCreateTransaction.createPaymentTransaction({ inputs: txInputs, payments }).rawTx;
    // The signer infers scripts from prevouts; its network argument does not
    // affect sizing. Dummy signatures provide a conservative pre-signing size.
    return Signer.estimateVirtualSize(getSignerNetwork(network), raw, inputs);
}
async function getFeeRate(wallet) {
    try {
        const confirmationTarget = 20;
        const response = (await wallet.rpc("estimatesmartfee", [
            confirmationTarget,
        ]));
        if (response && !response.errors && (typeof response.feerate === "number" || typeof response.feerate === "string")) {
            if (xnaToSats(response.feerate) > 0n)
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
    // The signer reads the input type from each prevout script; the network
    // only selects the chain (WIF version byte, NIP-025 rule).
    return Signer.sign(getSignerNetwork(network), rawTxHex, utxos, privateKeys);
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

/**
 * Normalisation of `@neuraiproject/neurai-rpc` (>= 0.5) rejections.
 *
 * The rpc package rejects with plain structured objects, not `Error`
 * instances. Three shapes exist:
 *
 *   1. JSON-RPC error (HTTP 200 or mapped to 4xx/5xx by the node):
 *        { error: { code, message }, description }
 *   2. HTTP error without a JSON-RPC body:
 *        { statusText, status, description, error }
 *   3. Transport failure:
 *        { originalError, type: "ServerUnreachable", error, description }
 *
 * jswallet's public contract is conventional: every failure coming from the
 * real RPC rejects as an `Error` whose `message` names the RPC method and the
 * useful description, whose `cause` holds the original rejection, and — when
 * the rejection carries a numeric JSON-RPC code — whose `code` property
 * exposes it so applications can branch without inspecting `cause`.
 *
 * Validation/build errors that do not come from the RPC are never funnelled
 * through here.
 */
/** Brand shared across bundles so a normalised error is never re-wrapped. */
const NORMALIZED_BRAND = Symbol.for("neurai.jswallet.normalizedRpcError");
function isNormalizedRpcError(value) {
    return (value instanceof Error &&
        value[NORMALIZED_BRAND] === true);
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
/**
 * Extract a human-readable description from any of the rpc rejection shapes
 * (or from an `Error`/string thrown by other layers).
 */
function describeRpcRejection(reason) {
    if (reason instanceof Error && reason.message) {
        return reason.message;
    }
    if (typeof reason === "string")
        return reason;
    if (reason && typeof reason === "object") {
        const value = reason;
        if (value.error && typeof value.error === "object") {
            const rpcError = value.error;
            if (rpcError.message) {
                return rpcError.code !== undefined && rpcError.code !== null
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
        return stringifyUnknown(reason);
    }
    return "Unknown RPC error";
}
/**
 * Numeric JSON-RPC error code carried by shapes 1 and 2, when present.
 * Transport/HTTP failures without a JSON-RPC body yield `undefined` — a code
 * is never invented.
 */
function extractJsonRpcCode(reason) {
    if (!reason || typeof reason !== "object")
        return undefined;
    const error = reason.error;
    if (!error || typeof error !== "object")
        return undefined;
    const code = error.code;
    return typeof code === "number" ? code : undefined;
}
/**
 * Turn an rpc rejection into a branded `Error`. Already-normalised errors are
 * returned unchanged so stacked wrappers (wallet rpc → asset rpc) never
 * duplicate context or lose the JSON-RPC code.
 */
function normalizeRpcError(reason, context) {
    if (isNormalizedRpcError(reason))
        return reason;
    const err = new Error(`${context}: ${describeRpcRejection(reason)}`);
    err.cause = reason;
    const code = extractJsonRpcCode(reason);
    if (code !== undefined)
        err.code = code;
    err[NORMALIZED_BRAND] = true;
    return err;
}
/**
 * Wrap a raw `getRPC` client so every rejection resolves the public contract:
 * `Error` with method context, `cause` and (when applicable) `code`.
 */
function wrapRpc(rpc) {
    return async function normalizedRpc(method, params) {
        try {
            return await rpc(method, params);
        }
        catch (reason) {
            throw normalizeRpcError(reason, `RPC ${String(method)} failed`);
        }
    };
}

/**
 * Addresses a secp256k1 WIF can hold funds on: its Legacy P2PKH address and,
 * for a compressed key, its strict ECDSA witness v3 address (neurai-key 5
 * `xna` / `xna-test`). The chain of the wallet selects the WIF version byte.
 */
function sweepableAddresses(WIF, wallet) {
    const addresses = [NeuraiKey.getAddressByWIF(getLegacyKeyNetwork(wallet.network), WIF).address];
    try {
        addresses.push(NeuraiKey.getAddressByWIF(getECDSAKeyNetwork(wallet.network), WIF).address);
    }
    catch {
        // Uncompressed WIF: no ECDSA witness v3 address.
    }
    return addresses;
}
/**
 * Sweep all UTXOs (XNA + assets) held by `WIF` into the wallet's first
 * addresses. The WIF is a secp256k1 key: its Legacy P2PKH address and its
 * ECDSA witness v3 address are swept together. Any wallet network can be the
 * destination, PQ ones included.
 */
async function sweep(WIF, wallet, onlineMode) {
    const fromAddresses = sweepableAddresses(WIF, wallet);
    const result = {};
    const rpc = wallet.rpc;
    result.fromAddress = fromAddresses[0];
    const baseCurrencyUTXOs = (await rpc("getaddressutxos", [
        { addresses: fromAddresses },
    ]));
    const assetUTXOs = (await rpc("getaddressutxos", [
        { addresses: fromAddresses, assetName: "*" },
    ]));
    const UTXOs = assetUTXOs.concat(baseCurrencyUTXOs);
    result.UTXOs = UTXOs;
    if (UTXOs.length === 0) {
        result.errorDescription = `Address ${fromAddresses.join(" / ")} has no funds`;
        return result;
    }
    // Total per asset (in satoshis)
    const balanceByAsset = {};
    for (const u of UTXOs) {
        balanceByAsset[u.assetName] = (balanceByAsset[u.assetName] ?? 0n) + amounts.assertMoneyRange(u.satoshis);
    }
    // Build outputs: each asset goes to a different wallet address
    const outputs = {};
    const transfers = [];
    const payments = [];
    const targets = Object.keys(balanceByAsset).map((assetName, index) => {
        const address = wallet.getAddresses()[index];
        return assetName === wallet.baseCurrency ? address : { address, assetName };
    });
    const fee = feeSatsFromVbytes(estimateSizeVbytes(UTXOs, targets, wallet.network), await getFeeRate(wallet));
    const baseIndex = Object.keys(balanceByAsset).indexOf(wallet.baseCurrency);
    const baseDestination = wallet.getAddresses()[Math.max(baseIndex, 0)];
    if ((balanceByAsset[wallet.baseCurrency] ?? 0n) - fee < dustThresholdSats(baseDestination)) {
        result.errorDescription = 'Insufficient XNA to cover the sweep fee and a spendable output';
        return result;
    }
    Object.keys(balanceByAsset).forEach((assetName, index) => {
        const destination = wallet.getAddresses()[index];
        const amount = balanceByAsset[assetName];
        if (assetName === wallet.baseCurrency) {
            const sendAmount = amounts.assertMoneyRange(amount - fee);
            outputs[destination] = satsToXna(sendAmount);
            payments.push({
                address: destination,
                valueSats: sendAmount,
            });
        }
        else {
            outputs[destination] = { transfer: { [assetName]: satsToXna(amount) } };
            transfers.push({
                address: destination,
                assetName,
                amountRaw: balanceByAsset[assetName],
            });
        }
    });
    result.outputs = outputs;
    const inputs = utxosToTxInputs(UTXOs);
    // NIP-040: the marker lookup only happens when the sweep actually moves
    // assets; an XNA-only sweep stays marker-free.
    const built = transfers.length > 0
        ? neuraiCreateTransaction.createStandardAssetTransferTransaction({
            inputs,
            payments,
            transfers,
            assetMarker: await wallet.resolveAssetMarker(),
        })
        : neuraiCreateTransaction.createPaymentTransaction({ inputs, payments });
    const signedHex = signRawTransaction(wallet.network, built.rawTx, UTXOs, Object.fromEntries(fromAddresses.map((address) => [address, WIF])));
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
    return amounts.assertMoneyRange(Object.values(outputs).reduce((t, v) => t + xnaToSats(v), 0n));
}
function tagForcedUTXOs(forced) {
    if (!forced || forced.length === 0)
        return [];
    return forced.map((f) => ({ ...f.utxo, forced: true }));
}
async function buildSendManyInternal(wallet, options) {
    const assetName = options.assetName || wallet.baseCurrency;
    const outputs = options.outputs;
    const sendMax = options.sendMax === true;
    if (!outputs || Object.keys(outputs).length === 0) {
        throw new ValidationError("outputs is mandatory");
    }
    const transferring = isAssetTransfer(wallet, assetName);
    if (sendMax) {
        if (transferring) {
            throw new ValidationError("sendMax is only supported for the base currency");
        }
        if (Object.keys(outputs).length !== 1) {
            throw new ValidationError("sendMax requires exactly one recipient");
        }
    }
    const forcedUTXOs = tagForcedUTXOs(options.forcedUTXOs);
    const { utxos: allUTXOs, feeRate } = await loadSpendableFunds(wallet, forcedUTXOs);
    const changeAddressBaseCurrency = options.forcedChangeAddressBaseCurrency ||
        (await wallet.getChangeAddress());
    const toAddresses = Object.keys(outputs);
    if (toAddresses.includes(changeAddressBaseCurrency)) {
        throw new ValidationError("Change address cannot be the same as to address");
    }
    const network = wallet.network;
    // ------------------------------------------------------------------
    // sendMax: drain entire base-currency balance, NO change output.
    // Math is done in satoshis to avoid IEEE-754 drift.
    // ------------------------------------------------------------------
    if (sendMax) {
        const recipient = toAddresses[0];
        const baseUTXOs = selectAllUTXOsByAsset(allUTXOs, wallet.baseCurrency);
        if (baseUTXOs.length === 0) {
            throw new InsufficientFundsError(`No ${wallet.baseCurrency} UTXOs available to spend`);
        }
        // Size estimated WITHOUT a change output — that is what we will broadcast.
        const sizeVbytes = estimateSizeVbytes(baseUTXOs, [recipient]);
        const feeSats = feeSatsFromVbytes(sizeVbytes, feeRate);
        const availableSats = sumUTXOSatoshis(baseUTXOs, wallet.baseCurrency);
        if (availableSats <= feeSats) {
            throw new InsufficientFundsError(`Available ${satsToXna(availableSats)} ${wallet.baseCurrency} cannot cover the fee ${satsToXna(feeSats)}`);
        }
        const amountSats = availableSats - feeSats;
        const txPayments = [
            { address: recipient, valueSats: amountSats },
        ];
        const inputs = utxosToTxInputs(baseUTXOs);
        const built = neuraiCreateTransaction.createPaymentTransaction({ inputs, payments: txPayments });
        const rawTxHex = built.rawTx;
        const forcedExtras = options.forcedUTXOs?.map((f) => ({
            address: f.address,
            privateKey: f.privateKey,
        }));
        const privateKeys = buildPrivateKeyMap(wallet, baseUTXOs, forcedExtras);
        const signedHex = signRawTransaction(network, rawTxHex, baseUTXOs, privateKeys);
        const walletMempool = await wallet.getMempool();
        const amountXna = satsToXna(amountSats);
        const feeXna = satsToXna(feeSats);
        return {
            rawTxHex,
            signedHex,
            inputs: baseUTXOs,
            outputs: { [recipient]: amountXna },
            fee: feeXna,
            baseCurrencyAmount: satsToXna(availableSats),
            baseCurrencyChange: 0,
            assetChange: 0,
            dustAbsorbedSats: 0,
            sentMax: true,
            walletMempool,
        };
    }
    // ------------------------------------------------------------------
    // Standard flow (asset transfer or regular XNA send).
    // ------------------------------------------------------------------
    const amount = totalAmount(outputs);
    let assetChange = 0n;
    let assetUTXOs = [];
    let baseCurrencyUTXOs = [];
    let baseCurrencyAmount;
    let changeAddressAsset = "";
    if (transferring) {
        assetUTXOs = selectUTXOs(allUTXOs, assetName, amounts.satoshisToDecimal(amount));
        assetChange = sumUTXOSatoshis(assetUTXOs, assetName) - amount;
        // For asset transfers we still need XNA UTXOs to pay the fee
        const previewSelection = selectUTXOs(allUTXOs, wallet.baseCurrency, 0.001);
        const previewSize = estimateSizeVbytes([...assetUTXOs, ...previewSelection], [...toAddresses, changeAddressBaseCurrency]);
        baseCurrencyAmount = amounts.satoshisToDecimal(feeSatsFromVbytes(previewSize, feeRate));
        baseCurrencyUTXOs = selectUTXOs(allUTXOs, wallet.baseCurrency, baseCurrencyAmount);
        changeAddressAsset =
            options.forcedChangeAddressAssets ||
                (await wallet.getAssetChangeAddress());
        if (toAddresses.includes(changeAddressAsset)) {
            throw new ValidationError("Change address cannot be the same as to address");
        }
    }
    else {
        baseCurrencyAmount = amounts.satoshisToDecimal(amount);
        baseCurrencyUTXOs = selectUTXOs(allUTXOs, wallet.baseCurrency, baseCurrencyAmount);
        // refine fee based on chosen inputs
        const sizeVbytes = estimateSizeVbytes(baseCurrencyUTXOs, [
            ...toAddresses,
            changeAddressBaseCurrency,
        ]);
        const fee = feeSatsFromVbytes(sizeVbytes, feeRate);
        baseCurrencyAmount = amounts.satoshisToDecimal(amount + fee);
        baseCurrencyUTXOs = selectUTXOs(allUTXOs, wallet.baseCurrency, baseCurrencyAmount);
    }
    // Adding inputs increases the fee. Repeat selection until those inputs
    // cover the fee estimated for their own size (bounded by available inputs).
    let selectedUTXOs = [];
    let feeSatsWithChange = 0n;
    for (let attempt = 0; attempt <= allUTXOs.length; attempt++) {
        selectedUTXOs = [...assetUTXOs, ...baseCurrencyUTXOs];
        feeSatsWithChange = feeSatsFromVbytes(estimateSizeVbytes(selectedUTXOs, transferring
            ? [...toAddresses.map(address => ({ address, assetName })), changeAddressBaseCurrency,
                ...(assetChange > 0n ? [{ address: changeAddressAsset, assetName }] : [])]
            : [...toAddresses, changeAddressBaseCurrency]), feeRate);
        const required = (transferring ? 0n : amount) + feeSatsWithChange;
        if (sumUTXOSatoshis(baseCurrencyUTXOs, wallet.baseCurrency) >= required)
            break;
        baseCurrencyUTXOs = selectUTXOs(allUTXOs, wallet.baseCurrency, amounts.satoshisToDecimal(required));
    }
    // Sat-precise change. Avoids the IEEE-754 drift that previously left
    // sub-dust change UTXOs that the network rejected.
    const baseCurrencyAvailableSats = sumUTXOSatoshis(baseCurrencyUTXOs, wallet.baseCurrency);
    const amountSats = transferring ? 0n : amount;
    const tentativeChangeSats = baseCurrencyAvailableSats - amountSats - feeSatsWithChange;
    if (tentativeChangeSats < 0n) {
        throw new InsufficientFundsError(`Selected UTXOs do not cover amount + fee for ${wallet.baseCurrency}`);
    }
    let baseCurrencyChangeSats;
    let feeSats;
    let dustAbsorbedSats = 0n;
    if (tentativeChangeSats < dustThresholdSats(changeAddressBaseCurrency)) {
        // Below dust → drop the change output. The residue is implicitly paid
        // to the miner as part of the fee. Required for the network to accept
        // the transaction (sub-dust outputs are non-standard).
        baseCurrencyChangeSats = 0n;
        feeSats = feeSatsWithChange + tentativeChangeSats;
        dustAbsorbedSats = tentativeChangeSats;
    }
    else {
        baseCurrencyChangeSats = tentativeChangeSats;
        feeSats = feeSatsWithChange;
    }
    const baseCurrencyChange = satsToXna(baseCurrencyChangeSats);
    const fee = satsToXna(feeSats);
    // Compose the user-facing outputs map.
    const totalOutputs = {};
    if (transferring) {
        if (assetChange > 0) {
            totalOutputs[changeAddressAsset] = {
                transfer: { [assetName]: satsToXna(assetChange) },
            };
        }
        for (const addy of toAddresses) {
            totalOutputs[addy] = { transfer: { [assetName]: outputs[addy] } };
        }
        if (baseCurrencyChangeSats > 0n) {
            totalOutputs[changeAddressBaseCurrency] = baseCurrencyChange;
        }
    }
    else {
        for (const addy of toAddresses) {
            totalOutputs[addy] = outputs[addy];
        }
        if (baseCurrencyChangeSats > 0n) {
            totalOutputs[changeAddressBaseCurrency] = baseCurrencyChange;
        }
    }
    // Build the actual rawTx via neurai-create-transaction, in satoshis.
    const inputs = utxosToTxInputs(selectedUTXOs);
    let rawTxHex;
    if (transferring) {
        const transfers = [];
        for (const [address, amt] of Object.entries(outputs)) {
            transfers.push({
                address,
                assetName,
                amountRaw: xnaToSats(amt),
            });
        }
        if (assetChange > 0) {
            transfers.push({
                address: changeAddressAsset,
                assetName,
                amountRaw: assetChange,
            });
        }
        const txPayments = [];
        if (baseCurrencyChangeSats > 0n) {
            txPayments.push({
                address: changeAddressBaseCurrency,
                valueSats: baseCurrencyChangeSats,
            });
        }
        // NIP-040: resolved immediately before building, only when the
        // transaction actually carries asset outputs. Pure-XNA sends never
        // trigger this lookup.
        const assetMarker = await wallet.resolveAssetMarker();
        const built = neuraiCreateTransaction.createStandardAssetTransferTransaction({
            inputs,
            payments: txPayments,
            transfers,
            assetMarker,
        });
        rawTxHex = built.rawTx;
    }
    else {
        const txPayments = [];
        for (const addy of toAddresses) {
            txPayments.push({
                address: addy,
                valueSats: xnaToSats(outputs[addy]),
            });
        }
        if (baseCurrencyChangeSats > 0n) {
            txPayments.push({
                address: changeAddressBaseCurrency,
                valueSats: baseCurrencyChangeSats,
            });
        }
        const built = neuraiCreateTransaction.createPaymentTransaction({ inputs, payments: txPayments });
        rawTxHex = built.rawTx;
    }
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
        baseCurrencyAmount: satsToXna(amountSats + feeSats),
        baseCurrencyChange,
        assetChange: transferring ? satsToXna(assetChange) : 0,
        dustAbsorbedSats: Number(dustAbsorbedSats),
        sentMax: false,
        walletMempool,
    };
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
            dustAbsorbedSats: build.dustAbsorbedSats,
            sentMax: build.sentMax,
            signedTransaction: build.signedHex,
            UTXOs: build.inputs,
            walletMempool: build.walletMempool,
        },
    };
}
async function createTransactionForOptions(wallet, options) {
    if (!options.toAddress)
        throw Error("toAddress is mandatory");
    const sendMax = options.sendMax === true;
    if (!sendMax && !options.amount)
        throw Error("amount is mandatory");
    const assetName = options.assetName || wallet.baseCurrency;
    const build = await buildSendManyInternal(wallet, {
        assetName,
        outputs: { [options.toAddress]: options.amount ?? 0 },
        sendMax,
        forcedChangeAddressAssets: options.forcedChangeAddressAssets,
        forcedChangeAddressBaseCurrency: options.forcedChangeAddressBaseCurrency,
        forcedUTXOs: options.forcedUTXOs,
    });
    // For sendMax the user-facing "amount" is the actual amount sent
    // (computed from balance − fee), not the value passed in by the caller.
    const reportedAmount = sendMax
        ? satsToXna(xnaToSats(build.baseCurrencyAmount) - xnaToSats(build.fee))
        : (options.amount ?? 0);
    return toSendResult(build, { amount: reportedAmount, assetName });
}
async function createSendManyForOptions(wallet, options) {
    const assetName = options.assetName || wallet.baseCurrency;
    const build = await buildSendManyInternal(wallet, options);
    const amount = options.sendMax === true
        ? satsToXna(xnaToSats(build.baseCurrencyAmount) - xnaToSats(build.fee))
        : satsToXna(totalAmount(options.outputs));
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

// Named import: the package publishes `NeuraiAssets` both as default and as a
// named export, but only the named form survives every interop (rollup CJS
// output resolved the default import to the module namespace).
// `asset_quantity` reaches createrawtransaction untouched: neurai-assets
// >= 1.3.2 emits the user-facing display amount and the daemon scales it via
// AmountFromValue. The old jswallet-side rescaling (÷10^(8-units)) double-
// compensated and zeroed the quantity of any units<8 issue/reissue.
function createAssetRpc(wallet) {
    return async (method, p) => {
        try {
            const params = p ?? [];
            const result = await wallet.rpc(method, params);
            if (method === "createrawtransaction" && !result) {
                throw new Error("createrawtransaction returned an empty result");
            }
            return result;
        }
        catch (error) {
            // wallet.rpc rejections are already normalised Errors and pass through
            // unchanged (message and JSON-RPC code intact); only local failures
            // like the empty-createrawtransaction check gain this context.
            throw normalizeRpcError(error, `RPC ${method} failed`);
        }
    };
}
class WalletAssets {
    queries;
    wallet;
    constructor(wallet) {
        this.wallet = wallet;
        const rpc = (method, params) => this.wallet.rpc(method, params ?? []);
        this.queries = new neuraiAssets.AssetQueries(rpc);
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
    // --- Transfer ---
    /**
     * Transfer an existing asset to one or more recipients.
     *
     * Works for any asset type. DePIN (`&`) assets are soulbound: this path
     * automatically spends and returns the asset's owner token (`&NAME!`) so the
     * transfer satisfies Neurai consensus — something the plain
     * `wallet.send`/`wallet.sendMany` asset path does NOT do. Use this for DePIN
     * transfers (and as a uniform transfer path for any other asset type).
     *
     * `amount` is in the asset's display units (the node scales by the asset's
     * declared decimals). `toAddress` from {@link AssetOpExecuteOptions} is
     * ignored here — recipients are taken from `recipients`.
     */
    async transfer(params) {
        return this._exec((assets, p) => assets.transferAsset(p), params);
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
        // NIP-040: the wallet resolver is the single source of the marker
        // (override → node, fail-closed). neurai-assets >= 1.4.1 keeps this
        // config value, hands it to its builders and does not ask the node again.
        // It governs the `localRawBuild.params.assetMarker` metadata; the
        // broadcast `rawTx` is produced by the node via `createrawtransaction`
        // and always carries the marker the node itself requires.
        const assetMarker = await this.wallet.resolveAssetMarker();
        const rpc = createAssetRpc(this.wallet);
        const network = getAssetPackageNetwork(this.wallet.network);
        const assets = new neuraiAssets.NeuraiAssets(rpc, {
            network,
            addresses: this.wallet.getAddresses(),
            changeAddress,
            toAddress,
            assetMarker,
        });
        const opParams = { ...params };
        delete opParams.broadcast;
        delete opParams.toAddress;
        delete opParams.changeAddress;
        // Sealed single source: neurai-assets gives per-operation params
        // precedence over config, so a caller-injected marker must never reach
        // the operation params.
        delete opParams.assetMarker;
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
        // neurai-assets's selector already fetched the UTXOs from
        // `getaddressutxos` (which includes `script`) and exposes them on
        // `result.utxos`. Reusing them here avoids a redundant round trip
        // through the RPC for `getaddressutxos` / `getaddressmempool` /
        // `estimatesmartfee` per asset operation.
        let inputUTXOs;
        try {
            inputUTXOs = this._resolveInputUTXOs(result.inputs ?? [], (result.utxos ?? []));
        }
        catch {
            // Fall back to a fresh wallet-side fetch if anything is missing
            // (older neurai-assets versions, mempool inputs, or other corner
            // cases). Slower path, but always correct.
            const { utxos: spendable } = await loadSpendableFunds(this.wallet);
            inputUTXOs = this._resolveInputUTXOs(result.inputs ?? [], spendable);
        }
        const privateKeys = buildPrivateKeyMap(this.wallet, inputUTXOs);
        return signRawTransaction(this.wallet.network, result.rawTx, inputUTXOs, privateKeys);
    }
    _resolveInputUTXOs(inputs, candidates) {
        const map = buildUTXOMap(candidates);
        const resolved = [];
        for (const i of inputs) {
            const key = utxoKey({ txid: i.txid, outputIndex: i.vout });
            const found = map.get(key);
            // Sign-tx requires `script` to derive the witness; bail out so the
            // caller can try the slower fallback path.
            if (!found || typeof found.script !== "string" || found.script.length === 0) {
                throw new Error(`Missing UTXO/script for ${key}`);
            }
            resolved.push(found);
        }
        return resolved;
    }
}

/** Base currency of a wallet network: XNA on every Neurai chain. */
function getBaseCurrencyByNetwork(network) {
    getChainConfig(network); // rejects unknown networks
    return "XNA";
}

async function getBalance(wallet, addresses) {
    const includeAssets = false;
    const params = [{ addresses }, includeAssets];
    const balance = (await wallet.rpc(neuraiRpc.methods.getaddressbalance, params));
    return satsToXna(balance.balance);
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
            obj.value = satsToXna(obj.balance);
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
// BIP44 for Legacy, BIP84-style purpose for strict ECDSA witness v3 (neurai-key 5).
const LEGACY_PURPOSE = 44;
const ECDSA_PURPOSE = 84;
//Avoid singleton (anti-pattern)
//Meaning multiple instances of the wallet must be able to co-exist
function getPQDerivationPath(testnet, account, index) {
    const coinType = testnet ? PQ_COIN_TYPE_TESTNET : PQ_COIN_TYPE_MAINNET;
    return `m_pq/${PQ_PURPOSE}'/${coinType}'/${account}'/${PQ_CHANGE_INDEX}'/${index}'`;
}
/**
 * Derives the address objects of one wallet network. The HD keys are built
 * once (seed generation is slow) and reused for every position.
 */
function createAddressDeriver(config, mnemonic, passphrase, account) {
    if (config.family === "authscript-pq" || config.family === "pq") {
        // One PQ HD tree serves the generic v1 and the strict v2 addresses.
        const hdKey = NeuraiKey.getPQHDKey(config.testnet ? "xna-pq-test" : "xna-pq", mnemonic, passphrase);
        return (position) => {
            const path = getPQDerivationPath(config.testnet, account, position);
            const derived = config.family === "pq"
                ? NeuraiKey.getPQAddressByPath(config.keyNetwork, hdKey, path)
                : NeuraiKey.getPQAuthScriptAddressByPath(config.keyNetwork, hdKey, path);
            return [{ ...derived, keyType: "pq" }];
        };
    }
    const keyNetwork = config.keyNetwork;
    const hdKey = NeuraiKey.getHDKey(keyNetwork, mnemonic, passphrase);
    const coinType = NeuraiKey.getCoinType(keyNetwork);
    const purpose = config.family === "ecdsa" ? ECDSA_PURPOSE : LEGACY_PURPOSE;
    const keyType = config.family === "ecdsa" ? "ecdsa" : "legacy";
    return (position) => [0, 1].map((change) => ({
        ...NeuraiKey.getAddressByPath(keyNetwork, hdKey, `m/${purpose}'/${coinType}'/${account}'/${change}/${position}`),
        keyType,
    }));
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
    rpc = wrapRpc(neuraiRpc.getRPC("anonymous", "anonymous", URL_NEURAI_MAINNET));
    _mnemonic = "";
    _passphrase = "";
    network = "xna";
    /**
     * NIP-040 marker override from `IOptions.assetMarker`. `undefined` means
     * "ask the node per build" (see {@link resolveAssetMarker}).
     */
    assetMarker = undefined;
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
        if (options.assetMarker !== undefined &&
            options.assetMarker !== "rvn" &&
            options.assetMarker !== "xna") {
            throw new ValidationError(`Invalid options.assetMarker: ${String(options.assetMarker)} (expected 'rvn' or 'xna', the value of getblockchaininfo.asset_marker)`);
        }
        // Always assign — re-initialising an instance without an override must
        // not keep the previous one.
        this.assetMarker = options.assetMarker;
        const chainConfig = getChainConfig(options.network ?? this.network);
        if (chainConfig.testnet) {
            url = URL_NEURAI_TESTNET;
        }
        url = options.rpc_url || url;
        password = options.rpc_password || password;
        username = options.rpc_username || username;
        if (options.network) {
            this.network = options.network;
            this.setBaseCurrency(getBaseCurrencyByNetwork(options.network));
        }
        this.rpc = wrapRpc(neuraiRpc.getRPC(username, password, url));
        this._mnemonic = options.mnemonic;
        this._passphrase = options.passphrase || "";
        //Generating the hd key is slow, so we re-use the object
        const ACCOUNT = 0;
        const deriveAddresses = createAddressDeriver(chainConfig, this._mnemonic, this._passphrase, ACCOUNT);
        const minAmountOfAddresses = Number.isFinite(options.minAmountOfAddresses)
            ? options.minAmountOfAddresses
            : 0;
        let doneDerivingAddresses = false;
        while (doneDerivingAddresses === false) {
            //We add new addresses to tempAddresses so we can check history for the last 20
            const tempAddresses = [];
            for (let i = 0; i < 20; i++) {
                // PQ networks: one object per position (single hardened branch).
                // Legacy / ECDSA: external then internal, interleaved, so receive and
                // change addresses are told apart by index parity.
                for (const addressObject of deriveAddresses(this.addressPosition)) {
                    this.addressObjects.push(addressObject);
                    tempAddresses.push(addressObject.address + "");
                }
                this.addressPosition++;
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
    /**
     * NIP-040 marker for locally built asset outputs, resolved fail-closed:
     *
     *   1. `IOptions.assetMarker` (wallet-level override) — validated, no RPC.
     *   2. `getblockchaininfo.asset_marker` from the wallet's node — the value
     *      the node requires for the next block candidate.
     *   3. `'rvn'` only when the call succeeded but the field is absent or
     *      `null` (nodes that predate NIP-040).
     *
     * A rejected/unreachable `getblockchaininfo` propagates as `Error` — it is
     * never converted into `'rvn'`, because that could silently produce a
     * consensus-invalid transaction on a post-NIP-040 chain. There is no cache:
     * the marker is asked for again on every build that contains asset outputs,
     * so a long-lived wallet keeps working across the activation crossover.
     */
    async resolveAssetMarker() {
        const override = this.assetMarker;
        if (override !== undefined) {
            if (override !== "rvn" && override !== "xna") {
                throw new ValidationError(`Invalid assetMarker override: ${String(override)} (expected 'rvn' or 'xna', the value of getblockchaininfo.asset_marker)`);
            }
            return override;
        }
        let info;
        try {
            info = await this.rpc(neuraiRpc.methods.getblockchaininfo, []);
        }
        catch (reason) {
            // wallet.rpc is normally wrapped already; normalizeRpcError leaves
            // branded errors untouched and converts raw rejections (e.g. from an
            // application-injected rpc) into the same Error contract.
            throw normalizeRpcError(reason, "RPC getblockchaininfo failed");
        }
        const marker = info
            ?.asset_marker;
        if (marker === undefined || marker === null) {
            return "rvn";
        }
        if (marker === "rvn" || marker === "xna") {
            return marker;
        }
        throw new Error(`Node reported an unknown getblockchaininfo.asset_marker: ${String(marker)} (expected 'rvn' or 'xna')`);
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
            sendMax: options.sendMax,
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
    transferAsset(params) {
        return this.assets.transfer(params);
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
            value: satsToXna(mempoolEntry.satoshis),
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
            if (amounts.toRawInteger(item.satoshis) < 0n) {
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
exports.key = NeuraiKey__namespace;
exports.scripts = neuraiScripts__namespace;
exports.Wallet = Wallet;
exports.createInstance = createInstance;
exports.default = neuraiWallet;
//# sourceMappingURL=index.cjs.map
