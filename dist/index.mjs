import {getRPC as $93qLg$getRPC, methods as $93qLg$methods} from "@neuraiproject/neurai-rpc";
import $93qLg$neuraiprojectneuraikey from "@neuraiproject/neurai-key";
import {Buffer as $93qLg$Buffer} from "buffer";
import $93qLg$neuraiprojectneuraisigntransaction, {sign as $93qLg$sign} from "@neuraiproject/neurai-sign-transaction";



const $9de421449659004c$export$ffff6aea08fd9487 = 1e8;



const $de17ee1c983f5fa9$var$ONE_HUNDRED_MILLION = 1e8;
function $de17ee1c983f5fa9$export$24d1144bbf44c6c6(rpc, addresses) {
    return rpc("getaddressdeltas", [
        {
            addresses: addresses,
            assetName: ""
        }
    ]);
}
function $de17ee1c983f5fa9$export$4e309754b4830e29(rpc, signedTransaction) {
    const p = rpc("sendrawtransaction", [
        signedTransaction
    ]);
    p.catch((e)=>{
        console.log("send raw transaction");
        console.dir(e);
    });
    return p;
}
function $de17ee1c983f5fa9$export$4e98a95db76a53e1(rpc, rawTransactionHex, privateKeys) {
    const s = rpc("signrawtransaction", [
        rawTransactionHex,
        null,
        privateKeys
    ]);
    return s;
}
function $de17ee1c983f5fa9$export$fcbdf06914f0237a(rpc, raw) {
    return rpc("decoderawtransaction", [
        raw
    ]);
}
function $de17ee1c983f5fa9$export$b7bc66c041203976(rpc, id) {
    return rpc("getrawtransaction", [
        id,
        true
    ]);
}
function $de17ee1c983f5fa9$export$3c514ecc803e4adc(rpc, inputs, outputs) {
    return rpc("createrawtransaction", [
        inputs,
        outputs
    ]);
}
async function $de17ee1c983f5fa9$export$f78173835dcde49f(rpc, address) {
    return rpc("validateaddress", [
        address
    ]);
}
function $de17ee1c983f5fa9$export$df96cd8d56be0ab1(rpc, addresses) {
    const includeAssets = true;
    const promise = rpc("getaddressbalance", [
        {
            addresses: addresses
        },
        includeAssets
    ]);
    return promise;
}
function $de17ee1c983f5fa9$export$1021589f9720f1bb(list) {
    //Remember, sort mutates the underlaying array
    //Sort by satoshis, lowest first to prevent dust.
    return list.sort(function(a, b) {
        if (a.satoshis > b.satoshis) return 1;
        if (a.satoshis < b.satoshis) return -1;
        return 0;
    });
}
async function $de17ee1c983f5fa9$export$2c023684d71dad7(rpc, addresses) {
    const list = await rpc("getaddressutxos", [
        {
            addresses: addresses
        }
    ]);
    $de17ee1c983f5fa9$export$1021589f9720f1bb(list);
    return list;
}
function $de17ee1c983f5fa9$export$61ff118ad91d2b8c(rpc, addresses, assetName) {
    const assets = rpc("getaddressutxos", [
        {
            addresses: addresses,
            assetName: assetName
        }
    ]);
    return assets;
}
function $de17ee1c983f5fa9$export$11b542b4427a1a57(rpc, addresses) {
    /*
  Seems like getaddressutxos either return XNA UTXOs or asset UTXOs
  Never both.
  So we make two requests and we join the answer
  */ const raven = rpc("getaddressutxos", [
        {
            addresses: addresses
        }
    ]);
    const assets = rpc("getaddressutxos", [
        {
            addresses: addresses,
            assetName: "*"
        }
    ]);
    return Promise.all([
        raven,
        assets
    ]).then((values)=>{
        const all = values[0].concat(values[1]);
        return all;
    });
}
async function $de17ee1c983f5fa9$export$6bbaa6939a98b630(rpc) {
    const ids = await rpc("getrawmempool", []);
    const result = [];
    for (const id of ids){
        const transaction = await $de17ee1c983f5fa9$export$b7bc66c041203976(rpc, id);
        result.push(transaction);
    }
    return result;
}
function $de17ee1c983f5fa9$export$6a4ffba0c6186ae7(UTXOs) {
    const inputs = UTXOs.map(function(bla) {
        //OK we have to convert from "unspent" format to "vout"
        const obj = {
            txid: bla.txid,
            vout: bla.outputIndex,
            address: bla.address
        };
        return obj;
    });
    return inputs;
}



class $df4abebf0c223404$export$2191b9da168c6cf0 extends Error {
    constructor(message){
        super(message); // (1)
        this.name = "ValidationError"; // (2)
    }
}
class $df4abebf0c223404$export$66c44d927ffead98 extends Error {
    constructor(message){
        super(message); // (1)
        this.name = "InvalidAddressError"; // (2)
    }
}
class $df4abebf0c223404$export$b276096bbba16879 extends Error {
    constructor(message){
        super(message); // (1)
        this.name = "InsufficientFundsError"; // (2)
    }
}



var $8a6a99603cc26764$require$Buffer = $93qLg$Buffer;
async function $8a6a99603cc26764$var$isValidAddress(rpc, address) {
    const obj = await $de17ee1c983f5fa9$export$f78173835dcde49f(rpc, address);
    return obj.isvalid === true;
}
function $8a6a99603cc26764$var$sumOfUTXOs(UTXOs) {
    let unspentNeuraiAmount = 0;
    UTXOs.map(function(item) {
        const newValue = item.satoshis / 1e8;
        unspentNeuraiAmount = unspentNeuraiAmount + newValue;
    });
    return unspentNeuraiAmount;
}
/*

    "Chicken and egg" situation.
    We need to calculate how much we shall pay in fees based on the size of the transaction.
    When adding inputs/outputs for the fee, we increase the fee.

    Lets start by first assuming that we will pay 1 XNA in fee (that is sky high).
    Than we check the size of the transaction and then we just adjust the change output so the fee normalizes
*/ async function $8a6a99603cc26764$var$getFee(rpc, inputs, outputs) {
    const ONE_KILOBYTE = 1024;
    //Create a raw transaction to get an aproximation for transaction size.
    const raw = await $de17ee1c983f5fa9$export$3c514ecc803e4adc(rpc, inputs, outputs);
    //Get the length of the string bytes not the string
    //This is NOT the exact size since we will add an output for the change address to the transaction
    //We add 20% to the size, to cover extra input for fee
    const size = $8a6a99603cc26764$require$Buffer.from(raw).length / ONE_KILOBYTE * 1.2;
    let fee = 0.02;
    //Ask the "blockchain" **estimatesmartfee**
    try {
        const confirmationTarget = 100;
        const asdf = await rpc("estimatesmartfee", [
            confirmationTarget
        ]);
        if (!asdf.errors) fee = asdf.feerate;
    } catch (e) {}
    const result = fee * Math.max(1, size);
    return result;
}
function $8a6a99603cc26764$var$getDefaultSendResult() {
    const sendResult = {
        transactionId: "undefined",
        debug: {
            assetName: "",
            assetUTXOs: [],
            amount: 0,
            fee: 0,
            inputs: [],
            outputs: null,
            xnaChangeAmount: 0,
            xnaUTXOs: [],
            unspentXNAAmount: "",
            xnaAmount: 0
        }
    };
    return sendResult;
}
async function $8a6a99603cc26764$export$89db4734f6c919c4(options) {
    const { amount: amount , assetName: assetName , baseCurrency: baseCurrency , changeAddress: changeAddress , changeAddressAssets: changeAddressAssets , fromAddressObjects: fromAddressObjects , network: network , toAddress: toAddress , rpc: rpc  } = options;
    const sendResult = $8a6a99603cc26764$var$getDefaultSendResult();
    sendResult.debug.amount = amount;
    const MAX_FEE = 4;
    const isAssetTransfer = assetName !== baseCurrency;
    //VALIDATION
    if (await $8a6a99603cc26764$var$isValidAddress(rpc, toAddress) === false) throw new (0, $df4abebf0c223404$export$66c44d927ffead98)("Invalid address " + toAddress);
    if (amount < 0) throw new (0, $df4abebf0c223404$export$2191b9da168c6cf0)("Cant send less than zero");
    const addresses = fromAddressObjects.map((a)=>a.address);
    //Do we have enough of the asset?
    if (isAssetTransfer === true) {
        if (!changeAddressAssets) throw new (0, $df4abebf0c223404$export$2191b9da168c6cf0)("No changeAddressAssets");
        const b = await $de17ee1c983f5fa9$export$df96cd8d56be0ab1(rpc, addresses);
        const a = b.find((asset)=>asset.assetName === assetName);
        if (!a) throw new (0, $df4abebf0c223404$export$b276096bbba16879)("You do not have any " + assetName);
        const balance = a.balance / (0, $9de421449659004c$export$ffff6aea08fd9487);
        if (balance < amount) throw new (0, $df4abebf0c223404$export$b276096bbba16879)("You do not have " + amount + " " + assetName);
    }
    let allBaseCurrencyUTXOs = await $de17ee1c983f5fa9$export$2c023684d71dad7(rpc, addresses);
    //Remove UTXOs that are currently in mempool
    const mempool = await $de17ee1c983f5fa9$export$6bbaa6939a98b630(rpc);
    allBaseCurrencyUTXOs = allBaseCurrencyUTXOs.filter((UTXO)=>$8a6a99603cc26764$export$9ffd76c05265a057(mempool, UTXO) === false);
    const enoughBaseCurrencyUTXOs = $8a6a99603cc26764$export$aef5e6c96bd29914(allBaseCurrencyUTXOs, isAssetTransfer ? 1 : amount + MAX_FEE);
    //Sum up the whole unspent amount
    let unspentBaseCurrencyAmount = $8a6a99603cc26764$var$sumOfUTXOs(enoughBaseCurrencyUTXOs);
    if (unspentBaseCurrencyAmount <= 0) throw new (0, $df4abebf0c223404$export$b276096bbba16879)("Not enough XNA to transfer asset, perhaps your wallet has pending transactions");
    sendResult.debug.unspentXNAAmount = unspentBaseCurrencyAmount.toLocaleString();
    if (isAssetTransfer === false) {
        if (amount > unspentBaseCurrencyAmount) throw new (0, $df4abebf0c223404$export$b276096bbba16879)("Insufficient funds, cant send " + amount.toLocaleString() + " only have " + unspentBaseCurrencyAmount.toLocaleString());
    }
    const baseCurrencyAmountToSpend = isAssetTransfer ? 0 : amount;
    sendResult.debug.xnaUTXOs = enoughBaseCurrencyUTXOs;
    const inputs = $de17ee1c983f5fa9$export$6a4ffba0c6186ae7(enoughBaseCurrencyUTXOs);
    const outputs = {};
    //Add asset inputs
    sendResult.debug.assetUTXOs = [];
    if (isAssetTransfer === true) {
        if (!changeAddressAssets) throw new (0, $df4abebf0c223404$export$2191b9da168c6cf0)("changeAddressAssets is mandatory when transfering assets");
        const assetUTXOs = await $8a6a99603cc26764$var$addAssetInputsAndOutputs(rpc, addresses, assetName, amount, inputs, outputs, toAddress, changeAddressAssets);
        sendResult.debug.assetUTXOs = assetUTXOs;
    } else if (isAssetTransfer === false) outputs[toAddress] = baseCurrencyAmountToSpend;
    const fee = await $8a6a99603cc26764$var$getFee(rpc, inputs, outputs);
    sendResult.debug.assetName = assetName;
    sendResult.debug.fee = fee;
    sendResult.debug.xnaAmount = 0;
    const baseCurrencyChangeAmount = unspentBaseCurrencyAmount - baseCurrencyAmountToSpend - fee;
    sendResult.debug.xnaChangeAmount = baseCurrencyChangeAmount;
    //Obviously we only add change address if there is any change
    if ($8a6a99603cc26764$export$82aafe8193f6c0ba(baseCurrencyChangeAmount) > 0) outputs[changeAddress] = $8a6a99603cc26764$export$82aafe8193f6c0ba(baseCurrencyChangeAmount);
    //Now we have enough UTXos, lets create a raw transactions
    sendResult.debug.inputs = inputs;
    sendResult.debug.outputs = outputs;
    const raw = await $de17ee1c983f5fa9$export$3c514ecc803e4adc(rpc, inputs, outputs);
    sendResult.debug.rawUnsignedTransaction = raw;
    //OK lets find the private keys (WIF) for input addresses
    const privateKeys = {};
    inputs.map(function(input) {
        const addy = input.address;
        const addressObject = fromAddressObjects.find((a)=>a.address === addy);
        if (addressObject) privateKeys[addy] = addressObject.WIF;
    });
    sendResult.debug.privateKeys = privateKeys;
    let UTXOs = [];
    if (enoughBaseCurrencyUTXOs) UTXOs = UTXOs.concat(enoughBaseCurrencyUTXOs);
    if (sendResult.debug.assetUTXOs) UTXOs = UTXOs.concat(sendResult.debug.assetUTXOs);
    try {
        const signedTransaction = (0, $93qLg$sign)(network, raw, UTXOs, privateKeys);
        sendResult.debug.signedTransaction = signedTransaction;
        const txid = await $de17ee1c983f5fa9$export$4e309754b4830e29(rpc, signedTransaction);
        sendResult.transactionId = txid;
    } catch (e) {
        sendResult.debug.error = e;
    }
    return sendResult;
}
async function $8a6a99603cc26764$var$addAssetInputsAndOutputs(rpc, addresses, assetName, amount, inputs, outputs, toAddress, changeAddressAssets) {
    let assetUTXOs = await $de17ee1c983f5fa9$export$61ff118ad91d2b8c(rpc, addresses, assetName);
    const mempool = await $de17ee1c983f5fa9$export$6bbaa6939a98b630(rpc);
    assetUTXOs = assetUTXOs.filter((UTXO)=>$8a6a99603cc26764$export$9ffd76c05265a057(mempool, UTXO) === false);
    const _UTXOs = $8a6a99603cc26764$export$aef5e6c96bd29914(assetUTXOs, amount);
    const tempInputs = $de17ee1c983f5fa9$export$6a4ffba0c6186ae7(_UTXOs);
    tempInputs.map((item)=>inputs.push(item));
    outputs[toAddress] = {
        transfer: {
            [assetName]: amount
        }
    };
    const assetSum = $8a6a99603cc26764$var$sumOfUTXOs(_UTXOs);
    const needsChange = assetSum - amount > 0;
    if (needsChange) outputs[changeAddressAssets] = {
        transfer: {
            [assetName]: assetSum - amount
        }
    };
    return _UTXOs; //Return the UTXOs used for asset transfer
}
function $8a6a99603cc26764$export$82aafe8193f6c0ba(num) {
    //Found answer here https://stackoverflow.com/questions/11832914/how-to-round-to-at-most-2-decimal-places-if-necessary
    //In JavaScript the number 77866.98 minus 111 minus 0.2 equals 77755.95999999999
    //We want it to be 77755.96
    return Math.trunc(num * 100) / 100;
}
function $8a6a99603cc26764$export$aef5e6c96bd29914(utxos, amount) {
    /*
  Scenario ONE
  Bob has 300 UTXO with 1 XNA each.
  Bob has one UTXO with 400 XNA.

  Bob intends to send 300 XNA
  In this case the best thing to do is to use the single 400 UTXO

  SCENARIO TWO

  Alice have tons of small UTXOs like 0.03 XNA, 0.2 XNA, she wants to send 5 XNA.
  In this case it makes sense to clean up the "dust", so you dont end up with a lot of small change.


  */ //For small transactions,start with small transactions first.
    let tempAmount = 0;
    const returnValue = [];
    utxos.map(function(utxo) {
        if (utxo.satoshis !== 0 && tempAmount < amount) {
            const value = utxo.satoshis / (0, $9de421449659004c$export$ffff6aea08fd9487);
            tempAmount = tempAmount + value;
            returnValue.push(utxo);
        }
    });
    //Did we use a MASSIVE amount of UTXOs to safisfy this transaction?
    //In this case check if we do have one single UTXO that can satisfy our needs
    if (returnValue.length > 10) {
        const largerUTXO = utxos.find((utxo)=>utxo.satoshis / (0, $9de421449659004c$export$ffff6aea08fd9487) > amount);
        if (largerUTXO) //Send this one UTXO that covers it all
        return [
            largerUTXO
        ];
    }
    return returnValue;
}
function $8a6a99603cc26764$export$9ffd76c05265a057(mempool, UTXO) {
    function format(transactionId, index) {
        return transactionId + "_" + index;
    }
    const listOfUTXOsInMempool = [];
    mempool.map((transaction)=>{
        transaction.vin.map((vin)=>{
            const id = format(vin.txid, vin.vout);
            listOfUTXOsInMempool.push(id);
        });
    });
    const index = listOfUTXOsInMempool.indexOf(format(UTXO.txid, UTXO.outputIndex));
    const isInMempool = index > -1;
    return isInMempool;
}





//sight rate burger maid melody slogan attitude gas account sick awful hammer
//OH easter egg ;)
const $67c46d86d9d50c48$var$WIF = "Kz5U4Bmhrng4o2ZgwBi5PjtorCeq2dyM7axGQfdxsBSwCKi5ZfTw";
async function $67c46d86d9d50c48$export$322a62cff28f560a(WIF, wallet, onlineMode) {
    const privateKey = (0, $93qLg$neuraiprojectneuraikey).getAddressByWIF(wallet.network, WIF);
    const result = {};
    const rpc = wallet.rpc;
    const obj = {
        addresses: [
            privateKey.address
        ]
    };
    const baseCurrencyUTXOs = await rpc("getaddressutxos", [
        obj
    ]);
    const obj2 = {
        addresses: [
            privateKey.address
        ],
        assetName: "*"
    };
    const assetUTXOs = await rpc("getaddressutxos", [
        obj2
    ]);
    const UTXOs = assetUTXOs.concat(baseCurrencyUTXOs);
    result.UTXOs = UTXOs;
    //Create a raw transaction with ALL UTXOs
    if (UTXOs.length === 0) {
        result.errorDescription = "Address " + privateKey.address + " has no funds";
        return result;
    }
    const balanceObject = {};
    UTXOs.map((utxo)=>{
        if (!balanceObject[utxo.assetName]) balanceObject[utxo.assetName] = 0;
        balanceObject[utxo.assetName] += utxo.satoshis;
    });
    const keys = Object.keys(balanceObject);
    //Start simple, get the first addresses from the wallet
    const outputs = {};
    const fixedFee = 0.02; // should do for now
    keys.map((assetName, index)=>{
        const address = wallet.getAddresses()[index];
        const amount = balanceObject[assetName] / 1e8;
        if (assetName === wallet.baseCurrency) outputs[address] = (0, $8a6a99603cc26764$export$82aafe8193f6c0ba)(amount - fixedFee);
        else outputs[address] = {
            transfer: {
                [assetName]: amount
            }
        };
    });
    result.outputs = outputs;
    //Convert from UTXO format to INPUT fomat
    const inputs = UTXOs.map((utxo, index)=>{
        /*   {
         "txid":"id",                      (string, required) The transaction id
         "vout":n,                         (number, required) The output number
         "sequence":n                      (number, optional) The sequence number
       } 
       */ const input = {
            txid: utxo.txid,
            vout: utxo.outputIndex
        };
        return input;
    });
    //Create raw transaction
    const rawHex = await rpc("createrawtransaction", [
        inputs,
        outputs
    ]);
    const privateKeys = {
        [privateKey.address]: WIF
    };
    const signedHex = (0, $93qLg$neuraiprojectneuraisigntransaction).sign(wallet.network, rawHex, UTXOs, privateKeys);
    result.rawTransaction = signedHex;
    if (onlineMode === true) result.transactionId = await rpc("sendrawtransaction", [
        signedHex
    ]);
    return result;
}


const $c3676b79c37149df$var$URL_MAINNET = "https://xna-rpc-mainnet.ting.finance/rpc";
const $c3676b79c37149df$var$URL_TESTNET = "https://xna-rpc-testnet.ting.finance/rpc";
class $c3676b79c37149df$export$bcca3ea514774656 {
    setBaseCurrency(currency) {
        this.baseCurrency = currency;
    }
    getBaseCurrency() {
        return this.baseCurrency;
    }
    /**
   * Sweeping a private key means to send all the funds the address holds to your your wallet.
   * The private key you sweep do not become a part of your wallet.
   *
   * NOTE: the address you sweep needs to cointain enough XNA to pay for the transaction
   *
   * @param WIF the private key of the address that you want move funds from
   * @returns either a string, that is the transaction id or null if there were no funds to send
   */ sweep(WIF, onlineMode) {
        const wallet = this;
        return (0, $67c46d86d9d50c48$export$322a62cff28f560a)(WIF, wallet, onlineMode);
    }
    getAddressObjects() {
        return this.addressObjects;
    }
    getAddresses() {
        const addresses = this.addressObjects.map((obj)=>{
            return obj.address;
        });
        return addresses;
    }
    async init(options) {
        let username = "anonymous";
        let password = "anonymous";
        let url = $c3676b79c37149df$var$URL_MAINNET;
        //VALIDATION
        if (!options) throw Error("option argument is mandatory");
        if (options.offlineMode === true) this.offlineMode = true;
        if (!options.mnemonic) throw Error("option.mnemonic is mandatory");
        url = options.rpc_url || url;
        password = options.rpc_password || url;
        username = options.rpc_username || url;
        if (options.network) {
            this.network = options.network;
            this.setBaseCurrency($c3676b79c37149df$export$af0c167f1aa2328f(options.network));
        }
        if (options.network === "xna-test" && !options.rpc_url) url = $c3676b79c37149df$var$URL_TESTNET;
        this.rpc = (0, $93qLg$getRPC)(username, password, url);
        //DERIVE ADDRESSES BIP44, external 20 unused (that is no history, not no balance)
        //TODO improve performance by creating blocks of 20 addresses and check history for all 20 at once
        //That is one history lookup intead of 20
        this._mnemonic = options.mnemonic;
        const ACCOUNT = 0;
        //Should we create an extra amount of addresses at startup?
        if (options.minAmountOfAddresses) for(let i = 0; i < options.minAmountOfAddresses; i++){
            const o = (0, $93qLg$neuraiprojectneuraikey).getAddressPair(this.network, this._mnemonic, ACCOUNT, this.addressPosition);
            this.addressObjects.push(o.external);
            this.addressObjects.push(o.internal);
            this.addressPosition++;
        }
        let isLast20ExternalAddressesUnused = false;
        while(isLast20ExternalAddressesUnused === false){
            const tempAddresses = [];
            for(let i = 0; i < 20; i++){
                const o = (0, $93qLg$neuraiprojectneuraikey).getAddressPair(this.network, this._mnemonic, ACCOUNT, this.addressPosition);
                this.addressObjects.push(o.external);
                this.addressObjects.push(o.internal);
                this.addressPosition++;
                tempAddresses.push(o.external.address + "");
                tempAddresses.push(o.internal.address + "");
            }
            if (this.offlineMode === true) //BREAK generation of addresses and do NOT check history on the network
            isLast20ExternalAddressesUnused = true;
            else //If no history, break
            isLast20ExternalAddressesUnused = false === await this.hasHistory(tempAddresses);
        }
    }
    async hasHistory(addresses) {
        const includeAssets = true;
        const obj = {
            addresses: addresses
        };
        const asdf = await this.rpc((0, $93qLg$methods).getaddressbalance, [
            obj,
            includeAssets
        ]);
        //@ts-ignore
        const hasReceived = Object.values(asdf).find((asset)=>asset.received > 0);
        return !!hasReceived;
    }
    async _getFirstUnusedAddress(external) {
        //First, check if lastReceivedAddress
        if (external === true && this.receiveAddress) {
            const asdf = await this.hasHistory([
                this.receiveAddress
            ]);
            if (asdf === false) return this.receiveAddress;
        }
        if (external === false && this.changeAddress) {
            const asdf = await this.hasHistory([
                this.changeAddress
            ]);
            if (asdf === false) return this.changeAddress;
        }
        //First make a list of relevant addresses, either external (even) or change (odd)
        const addresses = [];
        this.getAddresses().map(function(address, index) {
            if (external === true && index % 2 === 0) addresses.push(address);
            else if (external === false && index % 2 !== 0) addresses.push(address);
        });
        //Use BINARY SEARCH
        // Binary search implementation to find the first item with `history` set to false
        const binarySearch = async (_addresses)=>{
            let low = 0;
            let high = _addresses.length - 1;
            let result = "";
            while(low <= high){
                const mid = Math.floor((low + high) / 2);
                const addy = _addresses[mid];
                const hasHistory = await this.hasHistory([
                    addy
                ]);
                if (hasHistory === false) {
                    result = addy;
                    high = mid - 1; // Continue searching towards the left
                } else low = mid + 1; // Continue searching towards the right
            }
            return result;
        };
        const result = await binarySearch(addresses);
        if (!result) //IF we have not found one, return the first address
        return addresses[0];
        if (external === true) this.receiveAddress = result;
        else this.changeAddress = result;
        return result;
    /*
    //even addresses are external, odd address are internal/changes
    for (let counter = 0; counter < addresses.length; counter++) {
      //Internal addresses should be even numbers
      if (external && counter % 2 !== 0) {
        continue;
      }
      //Internal addresses should be odd numbers
      if (external === false && counter % 2 === 0) {
        continue;
      }
      const address = addresses[counter];

      //If an address has tenth of thousands of transactions, getHistory will throw an exception

      const hasHistory = await this.hasHistory([address]);

      if (hasHistory === false) {
        if (external === true) {
          this.receiveAddress = address;
        }
        if (external === false) {
          this.changeAddress = address;
        }
        return address;
      }
    }
*/ }
    async getHistory() {
        const assetName = ""; //Must be empty string, NOT "*"
        const addresses = this.getAddresses();
        const deltas = this.rpc((0, $93qLg$methods).getaddressdeltas, [
            {
                addresses: addresses,
                assetName: assetName
            }
        ]);
        //@ts-ignore
        const addressDeltas = deltas;
        return addressDeltas;
    }
    async getMempool() {
        const method = (0, $93qLg$methods).getaddressmempool;
        const includeAssets = true;
        const params = [
            {
                addresses: this.getAddresses()
            },
            includeAssets
        ];
        return this.rpc(method, params);
    }
    async getReceiveAddress() {
        const isExternal = true;
        return this._getFirstUnusedAddress(isExternal);
    }
    async getChangeAddress() {
        const isExternal = false;
        return this._getFirstUnusedAddress(isExternal);
    }
    /**
   *
   * @param assetName if present, only return UTXOs for that asset, otherwise for all assets
   * @returns UTXOs for assets
   */ async getAssetUTXOs(assetName) {
        //If no asset name, set to wildcard, meaning all assets
        const _assetName = !assetName ? "*" : assetName;
        const chainInfo = false;
        const params = [
            {
                addresses: this.getAddresses(),
                chainInfo: chainInfo,
                assetName: _assetName
            }
        ];
        return this.rpc((0, $93qLg$methods).getaddressutxos, params);
    }
    async getUTXOs() {
        return this.rpc((0, $93qLg$methods).getaddressutxos, [
            {
                addresses: this.getAddresses()
            }
        ]);
    }
    getPrivateKeyByAddress(address) {
        const f = this.addressObjects.find((a)=>a.address === address);
        if (!f) return undefined;
        return f.WIF;
    }
    async send(options) {
        const { amount: amount , toAddress: toAddress  } = options;
        let { assetName: assetName  } = options;
        if (!assetName) assetName = this.baseCurrency;
        const changeAddress = await this.getChangeAddress();
        //Find the first change address after change address (emergency take the first).
        const addresses = this.getAddresses();
        let index = addresses.indexOf(changeAddress);
        if (index > addresses.length - 2) index = 1;
        if (index === -1) index = 1;
        const changeAddressAssets = addresses[index + 2];
        if (changeAddressAssets === changeAddress) throw Error("Internal Error, changeAddress and changeAddressAssets cannot be the same");
        //Validation
        if (!toAddress) throw Error("Wallet.send toAddress is mandatory");
        if (!amount) throw Error("Wallet.send amount is mandatory");
        if (changeAddress === toAddress) throw Error("Wallet.send change address cannot be the same as toAddress " + changeAddress);
        if (changeAddressAssets === toAddress) throw Error("Wallet.send change address for assets cannot be the same as toAddress " + changeAddressAssets);
        const props = {
            fromAddressObjects: this.addressObjects,
            amount: amount,
            assetName: assetName,
            baseCurrency: this.baseCurrency,
            changeAddress: changeAddress,
            changeAddressAssets: changeAddressAssets,
            network: this.network,
            rpc: this.rpc,
            toAddress: toAddress
        };
        return $8a6a99603cc26764$export$89db4734f6c919c4(props);
    }
    async getAssets() {
        const includeAssets = true;
        const params = [
            {
                addresses: this.getAddresses()
            },
            includeAssets
        ];
        const balance = await this.rpc((0, $93qLg$methods).getaddressbalance, params);
        //Remove baseCurrency
        const result = balance.filter((obj)=>{
            return obj.assetName !== this.baseCurrency;
        });
        return result;
    }
    async getBalance() {
        const includeAssets = false;
        const params = [
            {
                addresses: this.getAddresses()
            },
            includeAssets
        ];
        const balance = await this.rpc((0, $93qLg$methods).getaddressbalance, params);
        return balance.balance / (0, $9de421449659004c$export$ffff6aea08fd9487);
    }
    constructor(){
        this.rpc = (0, $93qLg$getRPC)("anonymous", "anonymous", $c3676b79c37149df$var$URL_MAINNET);
        this._mnemonic = "";
        this.network = "xna";
        this.addressObjects = [];
        this.receiveAddress = "";
        this.changeAddress = "";
        this.addressPosition = 0;
        this.baseCurrency = "XNA" //Default is XNA but it could be EVR
        ;
        this.offlineMode = false;
    }
}
var $c3676b79c37149df$export$2e2bcd8739ae039 = {
    createInstance: $c3676b79c37149df$export$99152e8d49ca4e7d
};
async function $c3676b79c37149df$export$99152e8d49ca4e7d(options) {
    const wallet = new $c3676b79c37149df$export$bcca3ea514774656();
    await wallet.init(options);
    return wallet;
}
function $c3676b79c37149df$export$af0c167f1aa2328f(network) {
    const map = {
        evr: "EVR",
        "evr-test": "EVR",
        xna: "XNA",
        "xna-test": "XNA"
    };
    return map[network];
}


export {$c3676b79c37149df$export$bcca3ea514774656 as Wallet, $c3676b79c37149df$export$af0c167f1aa2328f as getBaseCurrencyByNetwork, $c3676b79c37149df$export$2e2bcd8739ae039 as default, $c3676b79c37149df$export$99152e8d49ca4e7d as createInstance};
//# sourceMappingURL=index.mjs.map
