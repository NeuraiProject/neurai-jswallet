# neurai-jswallet

Non-custodial Neurai wallet library for JavaScript and TypeScript.

By default it talks to the Neurai blockchain through public RPC services at
`https://rpc-main.neurai.org/rpc` (mainnet) and `https://rpc-testnet.neurai.org/rpc`
(testnet). You can point it at any RPC endpoint you control — see
[Run your own blockchain node](#run-your-own-blockchain-node).

> **Status:** EXPERIMENTAL. Test thoroughly before using on mainnet.

## What's inside

`neurai-jswallet` is a thin wallet shell that wires together the Neurai SDK
stack. It owns key management, address scanning, UTXO discovery and signing,
delegates transaction construction and asset operations to dedicated
libraries, and re-exports the low-level script primitives so callers don't
need extra installs:

| Concern | Library |
|---|---|
| Mnemonic / HD-key derivation (legacy + PQ) | [`@neuraiproject/neurai-key`](https://www.npmjs.com/package/@neuraiproject/neurai-key) |
| Raw transaction builders (payments, transfers, issue, reissue, freeze, tag) | [`@neuraiproject/neurai-create-transaction`](https://www.npmjs.com/package/@neuraiproject/neurai-create-transaction) |
| Asset orchestration & queries | [`@neuraiproject/neurai-assets`](https://www.npmjs.com/package/@neuraiproject/neurai-assets) |
| Script primitives (covenants, multisig, AuthScript, OP_RETURN, P2SH/P2WSH...) | [`@neuraiproject/neurai-scripts`](https://www.npmjs.com/package/@neuraiproject/neurai-scripts) |
| Transaction signing (legacy ECDSA + ML-DSA-44 PQ) | [`@neuraiproject/neurai-sign-transaction`](https://www.npmjs.com/package/@neuraiproject/neurai-sign-transaction) |
| RPC client | [`@neuraiproject/neurai-rpc`](https://www.npmjs.com/package/@neuraiproject/neurai-rpc) |

Supported networks: `xna`, `xna-test`, `xna-legacy`, `xna-legacy-test`,
`xna-pq` (post-quantum mainnet), `xna-pq-test` (post-quantum testnet).

## Install

```sh
npm install @neuraiproject/neurai-jswallet
```

## Build outputs

The package ships three flavours so it can be consumed from any environment:

| File | Format | Use |
|---|---|---|
| `dist/index.cjs` | CommonJS | Node, bundlers (`require`) |
| `dist/index.js` | ESM | Node, bundlers (`import`) |
| `dist/browser.js` | ESM (deps inlined) | Modern browsers |
| `dist/NeuraiJsWallet.global.js` | IIFE | Drop in a `<script>` tag — exposes `window.NeuraiJsWallet` |

Examples below use ESM (`.mjs`).

## Quick start

```js
import NeuraiWallet, { generateMnemonic } from "@neuraiproject/neurai-jswallet";

// Create a brand-new wallet
const mnemonic = generateMnemonic();
const wallet = await NeuraiWallet.createInstance({
  mnemonic,
  network: "xna-test",
});

console.log(mnemonic);
console.log(await wallet.getBalance());

// Or restore from an existing mnemonic
const restored = await NeuraiWallet.createInstance({
  mnemonic: "horse sort develop lab chest talk gift damp session sun festival squirrel",
  network: "xna-test",
});
```

### Mnemonic utilities

Top-level helpers re-exported from `@neuraiproject/neurai-key`. Useful before
a wallet instance exists (creating, restoring, validating the seed):

```js
import {
  generateMnemonic,
  isMnemonicValid,
  entropyToMnemonic,
} from "@neuraiproject/neurai-jswallet";

const mnemonic = generateMnemonic();          // 12 words, fresh entropy
isMnemonicValid(mnemonic);                    // true / false
entropyToMnemonic("00112233445566778899aabbccddeeff"); // hex → words
```

The same names are exposed on `globalThis.NeuraiJsWallet` when loading the
IIFE bundle from a `<script>` tag, so a browser wallet can be built from a
single script.

### Full key namespace

For advanced consumers (offline derivation, manual HD key handling, address
pair generation, AuthScript helpers...) the entire `@neuraiproject/neurai-key`
surface is exposed under the `key` namespace:

```js
import { key } from "@neuraiproject/neurai-jswallet";

// Address pair (sync, no RPC)
const { address, WIF } = key.getAddressPair("xna-test", mnemonic, 0, 0, passphrase);

// HD primitives
const hdKey = key.getHDKey("xna-test", mnemonic, passphrase);
const coin = key.getCoinType("xna-test");
const derived = key.getAddressByPath("xna-test", hdKey, "m/44'/175'/0'/0/0");

// PQ-HD primitives
const pqHd = key.getPQHDKey("xna-pq-test", mnemonic, passphrase);
const pqAddr = key.getPQAddressByPath("xna-pq-test", pqHd, "m_pq/100'/1'/0'/0'/0'");
```

Same access from a browser bundle: `NeuraiJsWallet.key.getAddressPair(...)`.

## Common operations

```js
import NeuraiWallet from "@neuraiproject/neurai-jswallet";

const wallet = await NeuraiWallet.createInstance({
  mnemonic: "horse sort develop lab chest talk gift damp session sun festival squirrel",
  network: "xna-test",
});

wallet.getAddresses();             // string[] — all derived addresses
wallet.getAddressObjects();        // metadata: path, publicKey, privateKey, WIF, seedKey
await wallet.getBalance();         // base currency balance
await wallet.getAssets();          // asset balances
await wallet.getReceiveAddress();  // first unused external address
await wallet.getChangeAddress();   // first unused internal address
await wallet.getHistory();         // address deltas
await wallet.getMempool();         // mempool entries for this wallet's addresses
await wallet.getUTXOs();           // all UTXOs (XNA + assets)
await wallet.getAssetUTXOs();      // asset UTXOs only
wallet.getPrivateKeyByAddress(addr);
```

## Send XNA and assets

```js
import NeuraiWallet from "@neuraiproject/neurai-jswallet";

const wallet = await NeuraiWallet.createInstance({
  mnemonic: "mesh beef tuition ensure apart picture rabbit tomato ancient someone alter embrace",
  network: "xna-test",
});

// Send 100 XNA
const xnaTx = await wallet.send({
  toAddress: "tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy",
  amount: 100,
});
console.log("XNA tx:", xnaTx.transactionId);

// Send 313 BUTTER tokens
const assetTx = await wallet.send({
  assetName: "BUTTER",
  amount: 313,
  toAddress: "tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy",
});
console.log("Asset tx:", assetTx.transactionId);
```

### Drain the wallet — `sendMax`

Pass `sendMax: true` to send the entire base-currency (XNA) balance to a
single recipient. The wallet ends at exactly **0** — no leftover dust, no
manual fee inflation. Internally the size is estimated **without** a change
output and the amount is computed as `balance − fee` in satoshis (so there is
no IEEE-754 drift). `amount` is ignored and may be omitted.

```js
const result = await wallet.send({
  toAddress: "tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy",
  sendMax: true,
});
console.log(result.transactionId);
console.log(result.debug.sentMax);    // true
console.log(result.debug.fee);        // actual fee paid
console.log(result.debug.amount);     // amount that reached the recipient
```

Restrictions: `sendMax` only works for the base currency (XNA) and a single
recipient. Combining it with `assetName` or `sendMany` throws a
`ValidationError`.

> **Sub-dust change is absorbed into the fee.** For *any* send (with or
> without `sendMax`), if the change output would be under the network's
> 546-sat dust threshold the wallet drops the change output entirely and the
> residue becomes part of the miner fee. This is the only way for the network
> to accept the transaction — sub-dust outputs are rejected. The actual
> absorbed sats are reported as `result.debug.dustAbsorbedSats` for
> transparency.

### Send to many recipients

```js
const result = await wallet.sendMany({
  assetName: "BUTTER",
  outputs: {
    tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy: 1,
    tD9hhanNRywGzn2mCwLkmrf3USWAD5REMA: 2,
  },
});
console.log(result.transactionId);
```

### Build without broadcasting

`send` and `sendMany` build, sign **and** broadcast. To inspect a transaction
(fee, change, raw hex) before broadcasting, use the `create*` variants:

```js
const draft = await wallet.createTransaction({
  toAddress: "tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy",
  amount: 1,
});

console.log(draft.debug.fee);
console.log(draft.debug.signedTransaction);   // hex, ready to broadcast
console.log(draft.debug.rawUnsignedTransaction);

// Broadcast manually when ready
await wallet.sendRawTransaction(draft.debug.signedTransaction);
```

`createSendManyTransaction({ outputs, assetName })` does the same for
multi-output transactions.

### Forced UTXOs and change addresses

`send`/`sendMany`/`createTransaction` accept optional fine-grained controls:

```js
await wallet.sendMany({
  assetName: "BUTTER",
  outputs: { tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy: 1 },
  forcedUTXOs: [
    {
      utxo: { address, assetName, txid, outputIndex, script, satoshis, value },
      address,
      privateKey: addressObject.WIF, // or seedKey object for PQ
    },
  ],
  forcedChangeAddressBaseCurrency: "tKevLHxnRC4srYDP6vGrYPRESkL9p4wd5Y",
  forcedChangeAddressAssets:       "tL1vjZj1KYd1FuAcCv4KWQPYMsJxA2rJoH",
});
```

## Asset operations

The wallet exposes a full asset toolkit through `wallet.assets` — and as
shortcuts directly on the wallet — backed by `@neuraiproject/neurai-assets`.

Every method accepts these common options:

| Option | Default | Meaning |
|---|---|---|
| `broadcast` | `true` | Sign and submit. Set `false` to inspect only. |
| `toAddress` | `wallet.getReceiveAddress()` | Recipient of the issued / reissued asset |
| `changeAddress` | `wallet.getChangeAddress()` | XNA change destination |

All return an `AssetOpResult`:

```ts
{
  transactionId: string | null,
  rawTx: string,
  signedTransaction: string,
  fee: number,
  burnAmount: number,
  changeAddress: string | null,
  changeAmount: number | null,
  inputs: Array<{ txid: string; vout: number; address: string }>,
  outputs: Array<Record<string, unknown>>,
}
```

### How an asset op talks to the node

Internally, every asset op runs in two phases — build (`@neuraiproject/neurai-assets` selects UTXOs and produces an unsigned `rawTx`) and sign + broadcast (this wallet derives the witness and submits). To keep round-trip count low against remote / public RPC endpoints, the wallet:

- reuses the UTXOs that the build phase already fetched (`result.utxos`) instead of re-querying `getaddressutxos` / `getaddressmempool` before signing — saves 4-5 RPC calls per op.
- relies on `@neuraiproject/neurai-assets ≥ 1.3.1`, which caches `estimatesmartfee` for the lifetime of a single build (the rate is stable for that window) — saves 1 more.

If `result.utxos` ever lacks the `script` field (older `neurai-assets` releases or unusual code paths), the wallet falls back to a fresh fetch automatically — slower path, but always correct.

Net effect: an `issueRoot` from a PQ address went from ~12 RPC round trips to ~5 in this version. Latency improvement scales linearly with your RPC RTT.

### Issue assets

```js
// ROOT asset
await wallet.issueRoot({
  assetName: "MYTOKEN",
  quantity: 1_000_000,
  units: 2,            // 0–8 decimals
  reissuable: true,
  ipfsHash: undefined, // optional metadata
});

// SUB asset (requires owning the parent)
await wallet.issueSub({
  assetName: "MYTOKEN/SUB",
  quantity: 100,
  units: 0,
  reissuable: false,
});

// UNIQUE assets (NFTs)
await wallet.issueUnique({
  rootName: "MYTOKEN",
  assetTags: ["#001", "#002", "#003"],
  ipfsHashes: [hash1, hash2, hash3],   // optional, one per tag
});

// QUALIFIER (KYC tag)
await wallet.issueQualifier({
  assetName: "#KYC",
  quantity: 10,
});

// RESTRICTED asset (compliance / verifier)
await wallet.issueRestricted({
  assetName: "$STOCK",
  quantity: 1_000_000,
  verifierString: "#KYC",
  units: 0,
  reissuable: true,
});

// DEPIN (soulbound)
await wallet.issueDepin({
  assetName: "DEVICE001",
  quantity: 1,
  ipfsHash: "Qm...",
});
```

### Reissue

```js
await wallet.reissue({
  assetName: "MYTOKEN",
  quantity: 500_000,        // additional supply
  units: 2,
  reissuable: true,
});

await wallet.reissueRestricted({
  assetName: "$STOCK",
  quantity: 250_000,
  verifierString: "#KYC",   // optional new verifier
});
```

### Tag / untag (qualifier)

```js
await wallet.tagAddresses({
  qualifierName: "#KYC",
  targetAddresses: [
    "tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy",
    "tD9hhanNRywGzn2mCwLkmrf3USWAD5REMA",
  ],
});

await wallet.untagAddresses({
  qualifierName: "#KYC",
  targetAddresses: ["tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy"],
});
```

### Freeze (restricted assets)

```js
// Freeze specific addresses for a restricted asset
await wallet.freezeAddresses({
  assetName: "$STOCK",
  targetAddresses: ["tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy"],
});

await wallet.unfreezeAddresses({
  assetName: "$STOCK",
  targetAddresses: ["tBkQUwLYgNuQysgaqYH6F75UiNvcsA5Wmy"],
});

// Freeze the whole asset globally
await wallet.freezeAssetGlobally({ assetName: "$STOCK" });
await wallet.unfreezeAssetGlobally({ assetName: "$STOCK" });
```

## Asset queries

Read-only blockchain queries are exposed through `wallet.assets.queries`:

```js
const data = await wallet.assets.queries.getAssetData("BUTTER");
const exists = await wallet.assets.queries.assetExists("BUTTER");
const all = await wallet.assets.queries.listAssets("MY*", true, 100, 0);
const mine = await wallet.assets.queries.listMyAssets();
const holders = await wallet.assets.queries.listAddressesByAsset("BUTTER");
const balances = await wallet.assets.queries.listAssetBalancesByAddress(addr);

// Qualifiers / restrictions
await wallet.assets.queries.checkAddressTag(addr, "#KYC");
await wallet.assets.queries.listTagsForAddress(addr);
await wallet.assets.queries.checkAddressRestriction(addr, "$STOCK");
await wallet.assets.queries.isAddressFrozen(addr, "$STOCK");
await wallet.assets.queries.checkGlobalRestriction("$STOCK");
await wallet.assets.queries.getVerifierString("$STOCK");

// DEPIN
await wallet.assets.queries.listDepinHolders("DEVICE001");
await wallet.assets.queries.checkDepinValidity("DEVICE001", addr);
```

## Low-level script primitives

`@neuraiproject/neurai-scripts` is re-exported under the `scripts` namespace so
you don't need a second `npm install` to assemble custom scripts (covenants,
multisig, OP_RETURN, AuthScript, P2WSH/P2SH...).

```js
import { scripts } from "@neuraiproject/neurai-jswallet";

// Partial-fill covenants (legacy + PQ)
const orderHex = scripts.buildPartialFillScriptHex({ ... });
const cancelSig = scripts.buildCancelScriptSig({ ... });
const orderHexPQ = scripts.buildPartialFillScriptPQHex({ ... });

// Standard scripts
const p2pkh = scripts.encodeP2PKHScriptPubKey(pubKeyHash);
const redeem = scripts.encodeMultisigRedeemScript({ m: 2, pubkeys: [...] });
const p2sh = scripts.encodeP2SHScriptPubKey(scriptHash);
const opReturn = scripts.encodeNullDataScript(payload);

// Core primitives
const builder = new scripts.ScriptBuilder()
  .opcode(scripts.opcodes.OP_DUP)
  .opcode(scripts.opcodes.OP_HASH160)
  .pushBytes(pubKeyHash);
```

See [`@neuraiproject/neurai-scripts`](https://www.npmjs.com/package/@neuraiproject/neurai-scripts)
for the full API.

## Sweep an external private key

Move every UTXO held by an arbitrary WIF private key into your wallet. Only
legacy networks are supported — sweeping PQ keys is not allowed.

```js
const result = await wallet.sweep("KxA0...WIF...", true /* broadcast */);
console.log(result.transactionId);
```

## Post-quantum wallets (PQ)

`xna-pq` and `xna-pq-test` use NIP-022 PQ-HD derivation (every path level
hardened) and ML-DSA-44 signatures. Address format is bech32m starting with
`nq1` / `tnq1`.

```js
const pq = await NeuraiWallet.createInstance({
  mnemonic: "result pact model attract result puzzle final boss private educate luggage era",
  network: "xna-pq-test",
  offlineMode: true, // skip RPC discovery — useful when the node has not yet indexed PQ
});

const addr = await pq.getReceiveAddress();    // tnq1...
const obj = pq.getAddressObjects()[0];
console.log(obj.seedKey);                     // hex ML-DSA-44 seed
```

> The same `wallet.send`, `wallet.createTransaction`, asset operations etc.
> all work for PQ wallets — the signer detects the address type and produces a
> ML-DSA-44 witness.

## Passphrase support (BIP39 25th word)

An optional passphrase derives a completely different set of addresses from the
same mnemonic. **If you lose the passphrase you cannot recover the wallet
even with the mnemonic.**

```js
const wallet = await NeuraiWallet.createInstance({
  mnemonic: "your twelve word mnemonic phrase here",
  network: "xna-test",
  passphrase: "my secret passphrase",   // omit or "" for the default wallet
});
```

Use cases:
- Extra layer of security on top of the mnemonic
- Multiple wallets from a single seed
- Plausible deniability (different passphrases → different wallets)

## Configuration

```ts
interface IOptions {
  mnemonic: string;
  network?: "xna" | "xna-test" | "xna-legacy" | "xna-legacy-test" | "xna-pq" | "xna-pq-test";
  passphrase?: string;
  rpc_url?: string;
  rpc_username?: string;
  rpc_password?: string;
  minAmountOfAddresses?: number;   // pre-derive at least N addresses on init
  offlineMode?: boolean;           // skip every RPC call during init/address selection
}
```

See [`dist/entries/index.d.ts`](./dist/entries/index.d.ts) for the full TypeScript surface.

### Use a custom RPC

```js
const wallet = await NeuraiWallet.createInstance({
  mnemonic,
  network: "xna-test",
  rpc_url:      "http://localhost:8888",
  rpc_username: "myuser",
  rpc_password: "mypassword",
});
```

### Run your own blockchain node

To expose your own node over HTTPS:

- [`neurai-rpc-proxy`](https://github.com/neuraiproject/neurai-rpc-proxy)
- [Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/)

## Advanced — direct RPC access

Every wallet exposes the underlying RPC function as `wallet.rpc`:

```js
const wallet = await NeuraiWallet.createInstance({ mnemonic, network: "xna-test" });

const blockhash = await wallet.rpc("getbestblockhash", []);
const block = await wallet.rpc("getblock", [blockhash]);
console.log(block);
```

## Use from a browser via `<script>`

A single IIFE bundle exposes everything you need (wallet API, mnemonic
helpers, script primitives, asset toolkit) on `window.NeuraiJsWallet`. No
extra scripts required:

```html
<script src="https://unpkg.com/@neuraiproject/neurai-jswallet/dist/NeuraiJsWallet.global.js"></script>
<script type="module">
  const mnemonic = NeuraiJsWallet.generateMnemonic();
  const wallet = await NeuraiJsWallet.createInstance({
    mnemonic,
    network: "xna-test",
    offlineMode: true,
  });
  console.log(mnemonic);
  console.log(await wallet.getReceiveAddress());
</script>
```

## License

MIT
