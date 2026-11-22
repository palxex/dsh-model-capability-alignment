/**
 * The one write path: scan, plan, back up, write, verify.
 *
 * Kept separate from `scan.ts` so the read-only path can never write: a scan
 * is safe to run any time, an apply is the only thing that touches bytes.
 *
 * @module src/apply
 */
import { type FieldPatch, type PatchScope } from './patch.js';
import { type CredentialResolver, type ListingFetcher, type ScanResult } from './scan.js';
import { type Backup, type PatchLocation } from './store.js';
/** What one apply did. */
export interface ApplyResult {
    /** The plan that was carried out. */
    patches: FieldPatch[];
    /** The backup written before the replacement. */
    backup: Backup;
    /**
     * The scan the plan came from, when this call had to run one. An explicit
     * field list needs no scan, so a write costs a parse and some bytes — not a
     * listing round trip per route and a liveness probe per model.
     */
    scan?: ScanResult;
    /** How many fields were actually written (a stale plan writes fewer). */
    written: number;
}
/**
 * Carry out one apply.
 *
 * @param location - the profile patch to edit.
 * @param scope - which fields to fill.
 * @param fetchListing - injected network seam.
 * @param filter - keep only these models, when the caller selected a subset.
 * @param signal - cancellation.
 */
export declare function applyPatchesToProfile(location: PatchLocation, scope: PatchScope, fetchListing: ListingFetcher, options?: {
    resolveCredential?: CredentialResolver;
    signal?: AbortSignal;
    /** Restrict the scan (and so the write) to these provider routes. */
    providers?: readonly string[];
    /** The exact writes to perform; when absent, the scan plans them. */
    fields?: readonly FieldPatch[];
    /**
     * The model ids in the order the page displayed them, per provider route.
     * A write is a permutation of the file, and the permutation belongs to the
     * review — so the caller that composed the list also names its order.
     */
    order?: Readonly<Record<string, readonly string[]>>;
}): Promise<ApplyResult>;
