/** Why a model is being dropped or kept; the page translates the wording. */
export type PruneVerdict = 'ok' | 'invalid' | 'unusable' | 'limited' | 'needs-auth' | 'timeout' | 'error' | 'transport';
export interface ProbeOptions {
    /** Route base URL, e.g. `http://127.0.0.1:18900/v1`. */
    baseURL: string;
    apiKey?: string;
    /** Hard per-model bound in milliseconds. */
    modelTimeoutMs: number;
    /** Requests in flight at once. */
    concurrency: number;
    /** Overall budget in milliseconds; models not reached are `skipped`. */
    budgetMs: number;
    /** The probe prompt; the reply is checked for its last word. */
    prompt?: string;
    /**
     * Per-request output cap in tokens — a backstop for a model that ignores
     * the one-word instruction (or a reasoning model thinking past it), not the
     * spend target. The prompt is what keeps a healthy reply at a few tokens.
     */
    outputCap?: number;
    signal?: AbortSignal;
}
export interface ProbeOutcome {
    verdict: PruneVerdict | 'skipped';
    reason: PruneReason;
    /** Round-trip milliseconds when the request completed. */
    ms?: number;
}
/**
 * A stable reason key the page translates, plus raw detail it appends as-is.
 *
 * The wording lives in the client's dictionaries, so a Chinese user never
 * reads a host-side English sentence; what cannot be translated — the HTTP
 * status and the gateway's own error text — rides as `detail`, which is
 * technical content either language keeps verbatim.
 */
export interface PruneReason {
    key: 'answered' | 'answered-induced' | 'answered-offword' | 'answered-toolcall' | 'no-answer-in-timeout' | 'transport' | 'lane-auth' | 'id-gone' | 'needs-login' | 'gateway-refused' | 'quota' | 'plan' | 'http-error' | 'skipped-budget';
    detail?: string;
}
/**
 * Classify one probe outcome, mirroring the sweep's table: `ok` keeps a model,
 * everything else names a reason it failed to serve a turn.
 */
export declare function classify(input: {
    status: number | null;
    error: string | null;
    content: string;
    toolCalls: number;
    stalled: boolean;
    timeoutMs: number;
}): {
    verdict: PruneVerdict;
    reason: PruneReason;
};
/** Probe a route's model list under one shared budget, out of order by design. */
export declare function probeModels(models: readonly string[], options: ProbeOptions): Promise<Map<string, ProbeOutcome>>;
