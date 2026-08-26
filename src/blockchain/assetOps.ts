// Named import: the package publishes `NeuraiAssets` both as default and as a
// named export, but only the named form survives every interop (rollup CJS
// output resolved the default import to the module namespace).
import { AssetQueries, NeuraiAssets } from "@neuraiproject/neurai-assets";

import { Wallet } from "../neuraiWallet";
import { normalizeRpcError } from "../rpcErrors";
import { ChainType, IUTXO } from "../Types";
import {
  broadcastSignedTransaction,
  buildPrivateKeyMap,
  buildUTXOMap,
  loadSpendableFunds,
  signRawTransaction,
  utxoKey,
} from "./txEngine";

export interface AssetOpResult {
  transactionId: string | null;
  rawTx: string;
  signedTransaction: string;
  fee: number;
  burnAmount: number;
  changeAddress: string | null;
  changeAmount: number | null;
  inputs: Array<{ txid: string; vout: number; address: string }>;
  outputs: Array<Record<string, unknown>>;
  assetData?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface AssetOpExecuteOptions {
  /** Whether to broadcast after signing. Defaults to true. */
  broadcast?: boolean;
  /** Override toAddress (recipient). Defaults to wallet receiveAddress. */
  toAddress?: string;
  /** Override change address. Defaults to wallet changeAddress. */
  changeAddress?: string;
}

type RpcFn = (method: string, params?: unknown[]) => Promise<unknown> | unknown;

function getAssetPackageNetwork(network: ChainType): ChainType {
  if (network === "xna-legacy-test") return "xna-test";
  if (network === "xna-legacy") return "xna";
  return network;
}

// `asset_quantity` reaches createrawtransaction untouched: neurai-assets
// >= 1.3.2 emits the user-facing display amount and the daemon scales it via
// AmountFromValue. The old jswallet-side rescaling (÷10^(8-units)) double-
// compensated and zeroed the quantity of any units<8 issue/reissue.

function createAssetRpc(wallet: Wallet): RpcFn {
  return async (method, p) => {
    try {
      const params = (p as any[]) ?? [];
      const result = await wallet.rpc(method, params);
      if (method === "createrawtransaction" && !result) {
        throw new Error("createrawtransaction returned an empty result");
      }
      return result;
    } catch (error) {
      // wallet.rpc rejections are already normalised Errors and pass through
      // unchanged (message and JSON-RPC code intact); only local failures
      // like the empty-createrawtransaction check gain this context.
      throw normalizeRpcError(error, `RPC ${method} failed`);
    }
  };
}

export class WalletAssets {
  readonly queries: AssetQueries;
  private readonly wallet: Wallet;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
    const rpc: RpcFn = (method, params) =>
      this.wallet.rpc(method, (params as any[]) ?? []);
    this.queries = new AssetQueries(rpc);
  }

  // --- Asset issuance ---

  async issueRoot(
    params: {
      assetName: string;
      quantity: number;
      units?: number;
      reissuable?: boolean;
      hasIpfs?: boolean;
      ipfsHash?: string;
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, params2) => assets.createRootAsset(params2), params);
  }

  async issueSub(
    params: {
      assetName: string;
      quantity: number;
      units?: number;
      reissuable?: boolean;
      hasIpfs?: boolean;
      ipfsHash?: string;
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.createSubAsset(p), params);
  }

  async issueDepin(
    params: {
      assetName: string;
      quantity: number;
      ipfsHash?: string;
      reissuable?: boolean;
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.createDepinAsset(p), params);
  }

  async issueUnique(
    params: {
      rootName: string;
      assetTags: string[];
      ipfsHashes?: Array<string | undefined>;
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.createUniqueAssets(p), params);
  }

  async issueQualifier(
    params: {
      assetName: string;
      quantity: number;
      ipfsHash?: string;
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.createQualifier(p), params);
  }

  async issueRestricted(
    params: {
      assetName: string;
      quantity: number;
      verifierString: string;
      units?: number;
      reissuable?: boolean;
      ipfsHash?: string;
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.createRestrictedAsset(p), params);
  }

  // --- Reissue ---

  async reissue(
    params: {
      assetName: string;
      quantity: number;
      units?: number;
      reissuable?: boolean;
      ipfsHash?: string;
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.reissueAsset(p), params);
  }

  async reissueRestricted(
    params: {
      assetName: string;
      quantity: number;
      verifierString?: string;
      units?: number;
      reissuable?: boolean;
      ipfsHash?: string;
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
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
  async transfer(
    params: {
      assetName: string;
      recipients: Array<{ address: string; amount: number }>;
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.transferAsset(p), params);
  }

  // --- Tag / untag (qualifier) ---

  async tagAddresses(
    params: {
      qualifierName: string;
      targetAddresses: string[];
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.tagAddresses(p), params);
  }

  async untagAddresses(
    params: {
      qualifierName: string;
      targetAddresses: string[];
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.untagAddresses(p), params);
  }

  // --- Freeze (restricted assets) ---

  async freezeAddresses(
    params: {
      assetName: string;
      targetAddresses: string[];
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.freezeAddresses(p), params);
  }

  async unfreezeAddresses(
    params: {
      assetName: string;
      targetAddresses: string[];
    } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.unfreezeAddresses(p), params);
  }

  async freezeAssetGlobally(
    params: { assetName: string } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.freezeAssetGlobally(p), params);
  }

  async unfreezeAssetGlobally(
    params: { assetName: string } & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    return this._exec((assets, p) => assets.unfreezeAssetGlobally(p), params);
  }

  // --- Internals ---

  private async _exec(
    op: (assets: any, params: Record<string, unknown>) => Promise<any>,
    rawParams: object & AssetOpExecuteOptions,
  ): Promise<AssetOpResult> {
    const params = rawParams as Record<string, unknown>;
    const broadcast = (params.broadcast as boolean | undefined) !== false;
    const toAddress =
      (params.toAddress as string | undefined) || (await this.wallet.getReceiveAddress());
    const changeAddress =
      (params.changeAddress as string | undefined) || (await this.wallet.getChangeAddress());

    // NIP-040: the wallet resolver is the single source of the marker
    // (override → node, fail-closed). neurai-assets >= 1.4.1 keeps this
    // config value, hands it to its builders and does not ask the node again.
    // It governs the `localRawBuild.params.assetMarker` metadata; the
    // broadcast `rawTx` is produced by the node via `createrawtransaction`
    // and always carries the marker the node itself requires.
    const assetMarker = await this.wallet.resolveAssetMarker();

    const rpc = createAssetRpc(this.wallet);
    const network = getAssetPackageNetwork(this.wallet.network);
    const assets = new (NeuraiAssets as any)(rpc, {
      network,
      addresses: this.wallet.getAddresses(),
      changeAddress,
      toAddress,
      assetMarker,
    });

    const opParams: Record<string, unknown> = { ...params };
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

    let txid: string | null = null;
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
      inputs: (result.inputs ?? []).map((i: any) => ({
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
  private async _signResult(result: any): Promise<string> {
    // neurai-assets's selector already fetched the UTXOs from
    // `getaddressutxos` (which includes `script`) and exposes them on
    // `result.utxos`. Reusing them here avoids a redundant round trip
    // through the RPC for `getaddressutxos` / `getaddressmempool` /
    // `estimatesmartfee` per asset operation.
    let inputUTXOs: IUTXO[];
    try {
      inputUTXOs = this._resolveInputUTXOs(
        result.inputs ?? [],
        (result.utxos ?? []) as IUTXO[],
      );
    } catch {
      // Fall back to a fresh wallet-side fetch if anything is missing
      // (older neurai-assets versions, mempool inputs, or other corner
      // cases). Slower path, but always correct.
      const { utxos: spendable } = await loadSpendableFunds(this.wallet);
      inputUTXOs = this._resolveInputUTXOs(result.inputs ?? [], spendable);
    }

    const privateKeys = buildPrivateKeyMap(this.wallet, inputUTXOs);
    return signRawTransaction(
      this.wallet.network as ChainType,
      result.rawTx,
      inputUTXOs,
      privateKeys,
    );
  }

  private _resolveInputUTXOs(
    inputs: Array<{ txid: string; vout: number }>,
    candidates: IUTXO[],
  ): IUTXO[] {
    const map = buildUTXOMap(candidates);
    const resolved: IUTXO[] = [];
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
