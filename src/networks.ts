import type { ChainType } from "./Types.js";

/**
 * Address family a wallet network derives:
 *
 * - `legacy`: Base58 P2PKH (`N…` / `t…`), BIP44 `m/44'/coin'/account'/change/index`
 * - `authscript-pq`: generic AuthScript witness v1 with an ML-DSA-44 key
 *   (`nc1p…` / `tnc1p…`), native PQ tree `m_pq/100'/coin'/account'/0'/index'`
 * - `pq`: strict PQ witness v2 (`pq1z…` / `tpq1z…`), same PQ tree
 * - `ecdsa`: strict ECDSA witness v3 (`nq1r…` / `tnq1r…`), `m/84'/coin'/account'/change/index`
 */
export type AddressFamily = "legacy" | "authscript-pq" | "pq" | "ecdsa";

/** neurai-key 5 network labels. */
export type KeyNetwork =
  | "xna"
  | "xna-test"
  | "xna-legacy"
  | "xna-legacy-test"
  | "xna-old-legacy"
  | "xna-pq"
  | "xna-pq-test"
  | "xna-authscript"
  | "xna-authscript-test";

export interface ChainConfig {
  /** Address family the wallet derives. */
  family: AddressFamily;
  /**
   * neurai-key 5 network that derives the wallet's addresses. It differs from
   * the wallet network name: jswallet keeps the names (and derivations) it had
   * with neurai-key 4, where `xna` was Legacy coin type 1900, `xna-legacy`
   * Legacy coin type 0 and `xna-pq` the generic AuthScript v1 PQ address.
   */
  keyNetwork: KeyNetwork;
  /** Testnet / regtest chain. */
  testnet: boolean;
  /** `keyType` of the derived address objects. */
  keyType: "legacy" | "pq" | "ecdsa";
  /**
   * PQ trees are hardened-only and have a single branch: receive, change and
   * asset change addresses come from the same list.
   */
  singleBranch: boolean;
}

const CHAINS: Record<ChainType, ChainConfig> = {
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
export const CHAIN_TYPES = Object.keys(CHAINS) as ChainType[];

/**
 * Configuration of a wallet network. Throws on an unknown name instead of
 * silently falling back to mainnet.
 */
export function getChainConfig(network: ChainType): ChainConfig {
  const config = CHAINS[network];
  if (!config) {
    throw new Error(
      `Unknown network ${JSON.stringify(network)}. Expected one of ${CHAIN_TYPES.join(", ")}`,
    );
  }
  return config;
}

/** True for the networks whose addresses use the native PQ tree. */
export function isPQNetwork(network: ChainType): boolean {
  return getChainConfig(network).singleBranch;
}

/**
 * The network label to hand to neurai-sign-transaction. The signer only uses
 * its chain (WIF version byte and per-network rules), so the neurai-key 5
 * label of the wallet's family is passed.
 */
export function getSignerNetwork(network: ChainType): KeyNetwork {
  return getChainConfig(network).keyNetwork;
}

/** neurai-key 5 network of the Legacy P2PKH address of a WIF on this chain. */
export function getLegacyKeyNetwork(network: ChainType): "xna-legacy" | "xna-legacy-test" {
  return getChainConfig(network).testnet ? "xna-legacy-test" : "xna-legacy";
}

/** neurai-key 5 network of the ECDSA witness v3 address of a WIF on this chain. */
export function getECDSAKeyNetwork(network: ChainType): "xna" | "xna-test" {
  return getChainConfig(network).testnet ? "xna-test" : "xna";
}

/**
 * Chain family label for @neuraiproject/neurai-assets: `xna` / `xna-test`
 * for Legacy wallets, `xna-pq` / `xna-pq-test` (its AuthScript label) for the
 * witness families.
 */
export function getAssetPackageNetwork(network: ChainType): "xna" | "xna-test" | "xna-pq" | "xna-pq-test" {
  const { testnet, family } = getChainConfig(network);
  if (family === "legacy") return testnet ? "xna-test" : "xna";
  return testnet ? "xna-pq-test" : "xna-pq";
}
