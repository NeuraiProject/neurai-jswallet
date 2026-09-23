/**
 * neurai-key 5 address types.
 *
 * The wallet network names keep the derivation they had with neurai-key 4
 * (0.15.x): the vectors below were produced by neurai-key 4.0.1 with the
 * derivation paths of jswallet 0.15.5, so an upgraded wallet must derive the
 * very same keys and scriptPubKeys. Only the text of the generic AuthScript v1
 * addresses changes (nq1p… → nc1p…, the node's encoding since neurai-key 5).
 */
const NeuraiWallet = require("../../dist/index.cjs");
const { expect } = require("chai");
const { bech32m } = require("bech32");
const NeuraiKeyModule = require("@neuraiproject/neurai-key");
const NeuraiKey = NeuraiKeyModule.default ?? NeuraiKeyModule;
const { decodeAddress, encodeDestinationScript, parseTransaction } = require("@neuraiproject/neurai-create-transaction");

const MNEMONIC = "result pact model attract result puzzle final boss private educate luggage era";

// Produced with neurai-key 4.0.1 + jswallet 0.15.5 paths.
const NEURAI_KEY_4_VECTORS = {
  "xna": [
    {
      "external": "NWeC9vTbTHJXMJyWt93CVeD8HQYjc4HMwt",
      "internal": "NP6H7hnkrqVADtFfeofHXTQ5qaAGu5vwAu"
    },
    {
      "external": "NLhdtwjgrcEkRqjJZkRY4sjhkJ93EytLeE",
      "internal": "NRYT7zihLQTGpcK4PKHnTFuQsLaTGJYzqm"
    }
  ],
  "xna-test": [
    {
      "external": "tAc2uWDixKv5UwTFnZdzJ3yVo89SSrExES",
      "internal": "tMMFPeNjd1xxYqarHsr1scpAZq3tUSGXeS"
    },
    {
      "external": "tPXGaMRNwZuV1UKSrD9gABPscrJWUmedQ9",
      "internal": "t9x8AcpJ9tCeNvAXKPHXSgwMqXxMy6A6nw"
    }
  ],
  "xna-legacy": [
    {
      "external": "NgvGXFQyczpZtSZKHKbjM9Ud1j8uJDaQaM",
      "internal": "NaGfzUNFn6XYfAP7efFWBAbBib5BfJDvpG"
    },
    {
      "external": "NLdcSXGQvCVf2RTKhx7GZom34f1JADhBTp",
      "internal": "NQM5zP6jkwDgCZ2UQiUicW4e3YcWc4NY4S"
    }
  ],
  "xna-legacy-test": [
    {
      "external": "tAc2uWDixKv5UwTFnZdzJ3yVo89SSrExES",
      "internal": "tMMFPeNjd1xxYqarHsr1scpAZq3tUSGXeS"
    },
    {
      "external": "tPXGaMRNwZuV1UKSrD9gABPscrJWUmedQ9",
      "internal": "t9x8AcpJ9tCeNvAXKPHXSgwMqXxMy6A6nw"
    }
  ],
  "xna-pq": [
    {
      "address": "nq1p5e3g0zyumlt8utualrdsfhnxad9ea9vc3ful3cndx5neh45cj0cqyt49ek",
      "commitment": "a66287889cdfd67e2f9df8db04de66eb4b9e95988a79f8e26d35279bd69893f0"
    },
    {
      "address": "nq1px4yy0ekppwu747tt29akrmtqryj8ghvt2tqmhqgpxvmjlznhkaqs8ujjy3",
      "commitment": "354847e6c10bb9eaf96b517b61ed601924745d8b52c1bb810133372f8a77b741"
    }
  ],
  "xna-pq-test": [
    {
      "address": "tnq1pdsj0aztvgwv3rwgml360stpyp228zrggyga6n4sdenmetm6wv3tqzddk95",
      "commitment": "6c24fe896c439911b91bfc74f82c240a94710d08223ba9d60dccf795ef4e6456"
    },
    {
      "address": "tnq1pjdrv4t2x96wjq5zjh9875pts8yjzrxfuw09re97nscs5n3lf5aqs7uvu9e",
      "commitment": "9346caad462e9d205052b94fea0570392421993c73ca3c97d3862149c7e9a741"
    }
  ]
};

function reencode(address, hrp) {
  return bech32m.encode(hrp, bech32m.decode(address).words);
}

async function offlineWallet(network, extra = {}) {
  return NeuraiWallet.createInstance({ mnemonic: MNEMONIC, network, offlineMode: true, ...extra });
}

describe("neurai-key 5 address types", () => {
  for (const network of ["xna", "xna-test", "xna-legacy", "xna-legacy-test"]) {
    it(`${network} derives the same Legacy addresses as 0.15 (neurai-key 4)`, async () => {
      const wallet = await offlineWallet(network);
      const addresses = wallet.getAddresses();
      NEURAI_KEY_4_VECTORS[network].forEach((pair, position) => {
        expect(addresses[position * 2]).to.equal(pair.external);
        expect(addresses[position * 2 + 1]).to.equal(pair.internal);
      });
      expect(wallet.getAddressObjects()[0].keyType).to.equal("legacy");
    });
  }

  for (const [network, hrp] of [["xna-pq", "nc"], ["xna-pq-test", "tnc"]]) {
    it(`${network} keeps the 0.15 PQ keys and scripts, encoded as ${hrp}1p…`, async () => {
      const wallet = await offlineWallet(network);
      const objects = wallet.getAddressObjects();
      NEURAI_KEY_4_VECTORS[network].forEach((old, position) => {
        expect(objects[position].commitment).to.equal(old.commitment);
        expect(objects[position].address).to.equal(reencode(old.address, hrp));
        expect(objects[position].witnessVersion).to.equal(1);
        expect(Buffer.from(encodeDestinationScript(objects[position].address)).toString("hex")).to.equal(
          "5120" + old.commitment,
        );
      });
    });
  }

  it("xna-ecdsa / xna-ecdsa-test derive strict ECDSA witness v3 addresses (m/84')", async () => {
    for (const [network, keyNetwork, prefix, coinType] of [
      ["xna-ecdsa", "xna", "nq1r", 1900],
      ["xna-ecdsa-test", "xna-test", "tnq1r", 1],
    ]) {
      const wallet = await offlineWallet(network);
      const [external, internal] = wallet.getAddressObjects();
      const pair = NeuraiKey.getAddressPair(keyNetwork, MNEMONIC, 0, 0);
      expect(external.address).to.equal(pair.external.address);
      expect(internal.address).to.equal(pair.internal.address);
      expect(external.address.startsWith(prefix)).to.equal(true);
      expect(external.path).to.equal(`m/84'/${coinType}'/0'/0/0`);
      expect(internal.path).to.equal(`m/84'/${coinType}'/0'/1/0`);
      expect(external.keyType).to.equal("ecdsa");
      expect(decodeAddress(external.address).type).to.equal("ecdsa");
    }
  });

  it("xna-pq-strict / xna-pq-strict-test derive strict PQ witness v2 addresses", async () => {
    for (const [network, keyNetwork, prefix] of [
      ["xna-pq-strict", "xna-pq", "pq1z"],
      ["xna-pq-strict-test", "xna-pq-test", "tpq1z"],
    ]) {
      const wallet = await offlineWallet(network, { minAmountOfAddresses: 2 });
      const objects = wallet.getAddressObjects();
      expect(objects[0].address).to.equal(NeuraiKey.getPQAddress(keyNetwork, MNEMONIC, 0, 0).address);
      expect(objects[1].address).to.equal(NeuraiKey.getPQAddress(keyNetwork, MNEMONIC, 0, 1).address);
      expect(objects[0].address.startsWith(prefix)).to.equal(true);
      expect(objects[0].keyType).to.equal("pq");
      // Same PQ key as the generic v1 address of the same position.
      const v1 = await offlineWallet(network.replace("-strict", ""));
      expect(v1.getAddressObjects()[0].publicKey).to.equal(objects[0].publicKey);
    }
  });

  it("strict PQ and ECDSA wallets pick distinct receive / change addresses", async () => {
    for (const network of ["xna-pq-strict-test", "xna-ecdsa-test"]) {
      const wallet = await offlineWallet(network, { minAmountOfAddresses: 5 });
      const receive = await wallet.getReceiveAddress();
      const change = await wallet.getChangeAddress();
      const assetChange = await wallet.getAssetChangeAddress();
      expect(new Set([receive, change, assetChange]).size, network).to.equal(3);
    }
  });

  for (const [network, opcode] of [["xna-pq-strict-test", "52"], ["xna-ecdsa-test", "53"]]) {
    it(`${network} builds and signs a payment with the strict 4-item witness`, async () => {
      const wallet = await offlineWallet(network, { minAmountOfAddresses: 2 });
      const from = wallet.getAddressObjects()[0];
      const to = wallet.getAddressObjects()[2].address;
      const utxo = {
        address: from.address,
        assetName: "XNA",
        txid: "11".repeat(32),
        outputIndex: 0,
        script: opcode + "20" + from.commitment,
        satoshis: 200000000,
        value: 2,
      };
      wallet.getMempool = async () => [];
      wallet.getAssetUTXOs = async () => [];
      wallet.getUTXOs = async () => [utxo];
      wallet.getUTXOsInMempool = async () => [];
      wallet.rpc = async (method) => {
        if (method === "estimatesmartfee") return { feerate: 0.05 };
        throw new Error(`Unexpected RPC call: ${method}`);
      };
      const result = await wallet.createTransaction({ toAddress: to, amount: 1 });
      const tx = parseTransaction(result.debug.signedTransaction);
      expect(tx.inputs[0].witness).to.have.length(4);
      expect(tx.inputs[0].witness[3]).to.equal("51");
      expect(tx.outputs[0].scriptPubKeyHex).to.equal(Buffer.from(encodeDestinationScript(to)).toString("hex"));
    });
  }

  it("drops PQ change below the node's PQ dust limit (3060 sats) but keeps it on Legacy", async () => {
    async function changeOf(network, script, extraSats) {
      const wallet = await offlineWallet(network, { minAmountOfAddresses: 2 });
      const from = wallet.getAddressObjects()[0];
      const to = "t7pvKtaVzbcsUijMT3z8KA4bkF1XxUiKqN"; // outside the wallet
      const utxoScript = script(from);
      const setup = (satoshis) => {
        const utxo = { address: from.address, assetName: "XNA", txid: "22".repeat(32), outputIndex: 0, script: utxoScript, satoshis, value: satoshis / 1e8 };
        wallet.getMempool = async () => [];
        wallet.getAssetUTXOs = async () => [];
        wallet.getUTXOs = async () => [utxo];
        wallet.getUTXOsInMempool = async () => [];
        wallet.rpc = async (method) => {
          if (method === "estimatesmartfee") return { feerate: 0.01 };
          throw new Error(`Unexpected RPC call: ${method}`);
        };
      };
      // First pass: learn the fee with plenty of change.
      setup(300000000);
      const probe = await wallet.createTransaction({ toAddress: to, amount: 1 });
      const feeSats = Math.round(Number(probe.debug.fee) * 1e8);
      setup(100000000 + feeSats + extraSats);
      return wallet.createTransaction({ toAddress: to, amount: 1 });
    }
    const pq = await changeOf("xna-pq-test", (from) => "5120" + from.commitment, 2000);
    expect(pq.debug.dustAbsorbedSats).to.equal(2000);
    const legacy = await changeOf(
      "xna-test",
      (from) => Buffer.from(encodeDestinationScript(from.address)).toString("hex"),
      2000,
    );
    expect(legacy.debug.dustAbsorbedSats).to.equal(0);
  });

  it("knows the base currency of every network and rejects unknown ones", async () => {
    const { getBaseCurrencyByNetwork } = NeuraiWallet.default;
    for (const network of [
      "xna", "xna-test", "xna-legacy", "xna-legacy-test", "xna-pq", "xna-pq-test",
      "xna-pq-strict", "xna-pq-strict-test", "xna-ecdsa", "xna-ecdsa-test",
    ]) {
      expect(getBaseCurrencyByNetwork(network)).to.equal("XNA");
    }
    expect(() => getBaseCurrencyByNetwork("xna-authscript")).to.throw(/Unknown network/);
    let error;
    try {
      await offlineWallet("mainnet");
    } catch (caught) {
      error = caught;
    }
    expect(error && error.message).to.match(/Unknown network/);
  });
});
