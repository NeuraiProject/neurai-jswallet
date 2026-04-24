import NeuraiAssets, { AssetQueries } from "@neuraiproject/neurai-assets";

import { Wallet } from "../neuraiWallet";
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

    const rpc: RpcFn = (method, p) =>
      this.wallet.rpc(method, (p as any[]) ?? []);
    const assets = new (NeuraiAssets as any)(rpc, {
      network: this.wallet.network,
      addresses: this.wallet.getAddresses(),
      changeAddress,
      toAddress,
    });

    const opParams: Record<string, unknown> = { ...params };
    delete opParams.broadcast;
    delete opParams.toAddress;
    delete opParams.changeAddress;

    const result = await op(assets, {
      ...opParams,
      toAddress,
      changeAddress,
      walletAddresses: this.wallet.getAddresses(),
      network: this.wallet.network,
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
    const { utxos: spendable } = await loadSpendableFunds(this.wallet);
    const map = buildUTXOMap(spendable);

    const inputUTXOs: IUTXO[] = [];
    for (const i of result.inputs ?? []) {
      const key = utxoKey({ txid: i.txid, outputIndex: i.vout });
      const found = map.get(key);
      if (found) {
        inputUTXOs.push(found);
        continue;
      }
      // Fallback: synthesize a minimal UTXO from the BuildInput; sign-tx
      // requires `script` so try to reconstruct it.
      throw new Error(
        `Could not find UTXO ${key} in the wallet's spendable set; cannot sign asset op`,
      );
    }

    const privateKeys = buildPrivateKeyMap(this.wallet, inputUTXOs);
    return signRawTransaction(
      this.wallet.network as ChainType,
      result.rawTx,
      inputUTXOs,
      privateKeys,
    );
  }
}
