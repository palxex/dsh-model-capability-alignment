/**
 * One scan: what each provider's endpoint says versus what its entries keep.
 *
 * This is the orchestration seam — the only place that knows both the file and
 * the network. Everything it calls is a pure function over data, so the whole
 * comparison is testable without a profile, a network, or a clock.
 *
 * @module src/scan
 */
import { parsePatch, type FieldPatch, type PatchScope } from './patch.js';
import type { Document } from 'yaml';
/** Where a row came from: your config, or only the endpoint's listing. */
export type ModelOrigin = 'config' | 'endpoint';
/** One model as the scan reports it, for the settings page. */
export interface ScannedModel {
    id: string;
    /** What the entry declares now. */
    current: {
        input?: string[];
        reasoningEfforts?: readonly string[];
    };
    /** What the endpoint says, when it named this model. */
    endpoint: {
        input?: string[];
        reasoningEfforts?: string[];
    } | null;
    /** Whether the endpoint named this model at all. */
    listed: boolean;
    /**
     * Whether this model is one the profile keeps (`config`) or one the endpoint
     * serves that the profile does not list (`endpoint`).
     *
     * Both are shown, because seeing the whole listing is how a user spots a
     * model the route could serve but their config never mentioned. Only
     * `config` rows carry patches: writing an `endpoint` row would mean adding
     * the model to the profile, and a model the user removed is removed on
     * purpose — a plugin must not offer to undo that from a checkbox next to a
     * capability fix.
     */
    origin: ModelOrigin;
    /**
     * When the scan ran a liveness probe (scope.prune), what the route answered:
     * `verdict` `ok` keeps the model, anything else is a removal candidate with
     * the reason shown beside the row. Absent when no probe ran. The reason is
     * a stable key the page translates; `detail` carries raw technical text.
     */
    prune?: {
        verdict: string;
        reason: {
            key: string;
            detail?: string;
        };
        ms?: number;
    };
    /** The patches this model would receive under the given scope. */
    patches: FieldPatch[];
    /** Why a field the endpoint published is not being patched, when it is not. */
    withheld: Array<{
        key: string;
        detail?: string;
    }>;
}
/** One provider's slice of a scan. */
export interface ScannedProvider {
    id: string;
    baseURL?: string;
    /** The models this provider keeps, in file order. */
    models: ScannedModel[];
    /** What went wrong reaching this endpoint, when something did. */
    error?: string;
}
/** A whole scan, ready to render. */
export interface ScanResult {
    providers: ScannedProvider[];
    /** Models the endpoint serves that no route in scope keeps. */
    unlistedCount: number;
}
/**
 * Resolve the API key one route's profile names, if it names one.
 *
 * The profile carries `apiKeyEnv`, a credential *reference*; the value lives
 * in the host's credential store, which only the host half can read. Returning
 * `undefined` is normal and correct for a keyless gateway.
 */
export type CredentialResolver = (profile: unknown) => Promise<string | undefined> | string | undefined;
/** What one route needs to list its models. */
export interface ListingRequest {
    url: string;
    /** `x-api-key` for the Anthropic shape, `Authorization: Bearer` otherwise. */
    headers: Record<string, string>;
}
/**
 * Fetches one listing body; injected so tests need no network.
 *
 * A route that needs a credential cannot be scanned without one, and a plugin
 * that only ever scanned keyless gateways would cover exactly one vendor. The
 * caller resolves the credential because this module must not know where
 * secrets live.
 */
export type ListingFetcher = (request: ListingRequest, signal?: AbortSignal) => Promise<unknown>;
/**
 * The listing path for one protocol.
 *
 * OpenAI-shaped routes list at `{baseURL}/models`. An Anthropic Messages route
 * lists at `{root}/v1/models`, where the root is the base without a trailing
 * `/v1` segment — pi-ai normalises that segment, so a gateway documented both
 * ways still answers.
 *
 * @param baseURL - the profile's base URL.
 * @param api - the profile's protocol.
 */
export declare function listingUrl(baseURL: string, api?: string): string;
/**
 * The headers one route's listing needs.
 *
 * An Anthropic-shaped route authenticates with `x-api-key` and a version
 * header; every other protocol pi-ai speaks takes a bearer token. An absent
 * key sends none, which is correct for a keyless gateway (Ollama, LM Studio)
 * and produces the route's own 401 for one that needs it — reported per
 * provider, never as a plugin failure.
 */
export declare function listingHeaders(api: string | undefined, apiKey: string | undefined): Record<string, string>;
/**
 * Scan one patch document against a set of endpoints.
 *
 * @param doc - the parsed patch.
 * @param scope - which fields the user asked to fill.
 * @param fetchListing - injected network seam.
 * @param signal - cancellation for the whole scan.
 */
export declare function scanDocument(doc: Document, scope: PatchScope, fetchListing: ListingFetcher, resolveCredential?: CredentialResolver, signal?: AbortSignal, only?: readonly string[]): Promise<ScanResult>;
/** Re-export so a caller can parse once and scan the same document. */
export { parsePatch };
