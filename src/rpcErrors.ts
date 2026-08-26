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

type RpcErrorShape = {
  error?: unknown;
  description?: unknown;
  status?: unknown;
  statusText?: unknown;
};

/** Brand shared across bundles so a normalised error is never re-wrapped. */
const NORMALIZED_BRAND = Symbol.for("neurai.jswallet.normalizedRpcError");

export function isNormalizedRpcError(value: unknown): value is Error {
  return (
    value instanceof Error &&
    (value as unknown as Record<symbol, unknown>)[NORMALIZED_BRAND] === true
  );
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Extract a human-readable description from any of the rpc rejection shapes
 * (or from an `Error`/string thrown by other layers).
 */
export function describeRpcRejection(reason: unknown): string {
  if (reason instanceof Error && reason.message) {
    return reason.message;
  }
  if (typeof reason === "string") return reason;

  if (reason && typeof reason === "object") {
    const value = reason as RpcErrorShape;

    if (value.error && typeof value.error === "object") {
      const rpcError = value.error as { message?: unknown; code?: unknown };
      if (rpcError.message) {
        return rpcError.code !== undefined && rpcError.code !== null
          ? `${String(rpcError.message)} (code ${String(rpcError.code)})`
          : String(rpcError.message);
      }
      return stringifyUnknown(value.error);
    }

    if (value.error) return stringifyUnknown(value.error);
    if (value.description) return stringifyUnknown(value.description);
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
export function extractJsonRpcCode(reason: unknown): number | undefined {
  if (!reason || typeof reason !== "object") return undefined;
  const error = (reason as RpcErrorShape).error;
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

/**
 * Turn an rpc rejection into a branded `Error`. Already-normalised errors are
 * returned unchanged so stacked wrappers (wallet rpc → asset rpc) never
 * duplicate context or lose the JSON-RPC code.
 */
export function normalizeRpcError(reason: unknown, context: string): Error {
  if (isNormalizedRpcError(reason)) return reason;

  const err = new Error(`${context}: ${describeRpcRejection(reason)}`) as Error & {
    cause?: unknown;
    code?: number;
  };
  err.cause = reason;
  const code = extractJsonRpcCode(reason);
  if (code !== undefined) err.code = code;
  (err as unknown as Record<symbol, unknown>)[NORMALIZED_BRAND] = true;
  return err;
}

export type RpcClient = (method: string, params: any[]) => Promise<unknown>;

/**
 * Wrap a raw `getRPC` client so every rejection resolves the public contract:
 * `Error` with method context, `cause` and (when applicable) `code`.
 */
export function wrapRpc(rpc: RpcClient): RpcClient {
  return async function normalizedRpc(method: string, params: any[]) {
    try {
      return await rpc(method, params);
    } catch (reason) {
      throw normalizeRpcError(reason, `RPC ${String(method)} failed`);
    }
  };
}
