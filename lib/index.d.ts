/**
 * Host half: expose the scan / apply pair to the settings page.
 *
 * The plugin owns no provider and serves no model. It is a maintenance surface
 * for one gap in pi-ai's discovery: `readListing` publishes id, name and the
 * two capacities, and nothing else — so `input` and `reasoningEfforts` exist in
 * the config schema, are honoured at runtime, and are never written by anybody.
 * An OpenAI-compatible route is therefore announced text-only no matter what it
 * serves.
 *
 * @module src/index
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type ScanResult } from './scan.js';
import type { FieldPatch } from './patch.js';
export declare const name = "pi-ai-modality-patcher";
/** What the settings page reads. */
export interface ProviderSummary {
    id: string;
    baseURL?: string;
    modelCount: number;
    /** Models that already declare at least one of the two fields. */
    declaredCount: number;
}
/** The scan payload the page renders. */
export interface ScanPayload extends ScanResult {
    file: string;
    providers: ScanResult['providers'];
    summary: ProviderSummary[];
}
/** One apply the page requested. */
export interface ApplyPayload {
    patches: FieldPatch[];
    backup: string;
    written: number;
}
/**
 * The services the host plugin entry needs.
 *
 * Mirrored on the service class below: a class handed to `ctx.plugin` is
 * resolved against ITS static `inject`, not this module's.
 */
export declare const inject: string[];
/**
 * Resolve the patch file to edit from the launcher's context.
 *
 * Pure so the precedence is testable without a live host: the exact composed
 * path wins, then the reported profile directory, then the constructed
 * `home/profiles/<name>` layout. `undefined` from `context` means the host
 * runs without it and the caller's own fallback applies.
 */
export declare function resolvePatchLocation(context: {
    dir?: string;
    patchPath?: string;
} | undefined, fallback: () => {
    file: string;
    exists: boolean;
}, exists?: (file: string) => boolean): {
    file: string;
    exists: boolean;
};
/**
 * The host service behind `ctx.remote.piAiModality`.
 *
 * A `TypertRemoteService` is how a plugin exposes its own operations to the
 * settings page: the gateway turns each `@Remote` method into a call on the
 * wire namespace, so the client needs no channel of its own (a self-made
 * `connection.rpc.handle` channel is retired and answers 405).
 */
export declare class ModalityPatcherService extends TypertRemoteService {
    /**
     * Dependencies this service waits for before it constructs.
     *
     * `typert` is the gateway binding `TypertRemoteService` needs; `settings` and
     * `credentials` are what its methods read. Declared here rather than only at
     * module scope because cordis resolves a class plugin against its own static
     * `inject`.
     */
    static inject: string[];
    private readonly home;
    private readonly host;
    constructor(ctx: Context);
    /**
     * Resolve the credential a route's profile names.
     *
     * A profile stores `apiKeyEnv`, a *reference*; the value lives in the host's
     * credential store. This mirrors what pi-ai's own adapter does — the store
     * first, then the launch environment, and an absent reference means the
     * route is keyless (Ollama, LM Studio, or an OFM-style local gateway).
     *
     * A missing credential is not an error here: the scan reports the route's
     * own 401 against that provider and carries on with the rest, because one
     * unconfigured route must not deny the others their scan.
     */
    private credentialFor;
    /**
     * The profile patch this plugin edits.
     *
     * The launcher hands the exact composed patch path to the host as
     * `profileContext.patchPath`; using it removes every guess about home
     * layout and profile name (Desktop keeps its own profile, and its home
     * differs from the CLI's). The constructed path stays as a fallback for a
     * host that runs without that context.
     */
    private locationOf;
    private readDocument;
    /**
     * This plugin's own version, read from its package manifest.
     *
     * Read per call rather than captured at load: the page shows it so a user
     * can tell which build is live, and a development copy that was rebuilt in
     * place keeps answering the new number without a restart (the module stays
     * loaded; only the manifest changes). A missing or unreadable manifest
     * reports `unknown` instead of failing the page.
     */
    version(): {
        version: string;
    };
    /** Every provider in the active profile, with what it keeps. */
    providers(): ProviderSummary[];
    /**
     * Compare the profile against every configured endpoint, read-only.
     *
     * Safe to run any time: a scan parses and renders nothing.
     */
    /**
     * @param request - which fields to compare. The gateway matches `args`
     *   against declared parameter names, so the client wraps it as `{ request }`.
     */
    scan(request: unknown): Promise<ScanPayload>;
    /**
     * Write the selected models' fields, after a backup.
     *
     * @param request - the scope, and optionally the exact models to write.
     */
    apply(request: unknown): Promise<ApplyPayload>;
}
/** The default export registers the plugin's host half. */
export declare function apply(ctx: Context): void;
