/**
 * Liveness probe for one route's models, in the shape DSH actually sends.
 *
 * This absorbs `gst/ofm-model-probe`: the sweep asked every listed model for a
 * one-word answer over a streaming `chat/completions` call and classified the
 * outcome, because a model that cannot answer in DSH is worse than a missing
 * one — selecting it produces a failed turn. The verdicts, the streaming shape
 * and the timeout/stall distinction all carry over:
 *
 * - the spend control is the prompt: it asks for one word ("just reply ok"),
 *   so a healthy model answers in a couple of tokens and the reply is checked
 *   for that word — which also proves the prompt reached a real model;
 * - a stream that opened (200) but produced nothing is `timeout`, not `error`
 *   — reading that as a generic error once removed nine healthy models;
 * - `transport` (no HTTP status at all) says nothing about the model and is
 *   never a removal ground on its own.
 */
import { parseSSEChunk } from './sse-shim.js';
/** The probe's whole input: an instruction whose honest answer is one word.
 *
 * The spend control is the PROMPT, not a cut: the model generates what it
 * generates, and refusing to read it would hide nothing from the bill. Asking
 * for a one-word reply means a healthy model emits a couple of tokens and
 * stops, and — the point of the specific word — the reply VERIFIES that the
 * instruction reached a real model: a gateway fabricating responses, a cache
 * replaying someone else's turn, or a model that never saw the prompt all
 * fail the `ok` check below.
 */
const DEFAULT_PROMPT = 'just reply ok';
/**
 * The word the reply is checked for: the prompt's last token. "just reply ok"
 * induces "ok"; a custom prompt induces its own last word, which keeps the
 * pairing honest — the user cannot set a prompt whose verification word they
 * did not also choose.
 */
function inducedWord(prompt) {
    const words = prompt.trim().split(/\s+/);
    return words[words.length - 1] ?? prompt.trim();
}
/**
 * Classify one probe outcome, mirroring the sweep's table: `ok` keeps a model,
 * everything else names a reason it failed to serve a turn.
 */
export function classify(input) {
    const { status, error, content, toolCalls, stalled, timeoutMs } = input;
    if (toolCalls > 0)
        return { verdict: 'ok', reason: { key: 'answered-toolcall' } };
    if (content.trim() !== '')
        return { verdict: 'ok', reason: { key: 'answered' } };
    // A stream that opened but produced nothing is its own verdict: the gateway
    // accepted the request and never delivered, which reads differently from a
    // model that answered garbage or a 5xx.
    if (stalled || error === '__timeout__')
        return { verdict: 'timeout', reason: { key: 'no-answer-in-timeout', detail: `${Math.round(timeoutMs / 1000)}s` } };
    const lower = (error ?? '').toLowerCase();
    if (status === null || status === 0)
        return { verdict: 'transport', reason: { key: 'transport' } };
    if (lower.includes('lane') && lower.includes('credential'))
        return { verdict: 'lane-auth', reason: { key: 'lane-auth' } };
    if (status === 404 || lower.includes('does not exist') || lower.includes('not found'))
        return { verdict: 'invalid', reason: { key: 'id-gone' } };
    if (status === 401 || status === 403) {
        if (lower.includes('login') || lower.includes('auth') || lower.includes('token'))
            return { verdict: 'needs-auth', reason: { key: 'needs-login' } };
        return { verdict: 'needs-auth', reason: { key: 'gateway-refused', detail: `HTTP ${status}` } };
    }
    if (status === 429 || lower.includes('quota') || lower.includes('rate limit') || lower.includes('free usage'))
        return { verdict: 'limited', reason: { key: 'quota' } };
    if (lower.includes('plan') || lower.includes('pricing') || lower.includes('subscribe'))
        return { verdict: 'unusable', reason: { key: 'plan' } };
    return { verdict: 'error', reason: { key: 'http-error', detail: `HTTP ${status}${error ? ` — ${error.slice(0, 120)}` : ''}` } };
}
/**
 * Probe one model with a streaming one-word request; never throws.
 *
 * Reads the reply to the end — the model spends what it spends either way, so
 * cutting the read at the first token would only blind the check while the
 * bill stays the same. What makes the probe cheap is the prompt: it asks for
 * one word, so an honest model answers in a couple of tokens. And because the
 * word is specific, a full read proves more than liveness: the reply must
 * actually be that word, which rules out fabricated or cached responses that
 * never touched the model.
 */
async function probeOne(options, model) {
    const started = Date.now();
    let status = null;
    let error = null;
    let stalled = false;
    const splitter = parseSSEChunk();
    try {
        const response = await fetch(`${options.baseURL.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }),
                'content-type': 'application/json',
                accept: 'text/event-stream',
            },
            body: JSON.stringify({
                model,
                stream: true,
                max_tokens: options.outputCap ?? 512,
                messages: [{ role: 'user', content: options.prompt ?? DEFAULT_PROMPT }],
            }),
            signal: options.signal?.aborted === true
                ? options.signal
                : AbortSignal.timeout(options.modelTimeoutMs),
        });
        status = response.status;
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            let payload = null;
            try {
                payload = JSON.parse(text);
            }
            catch { /* an HTML front page */ }
            error = payload?.error?.message ?? text.slice(0, 300);
        }
        else if (response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            for (;;) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                splitter.push(decoder.decode(value, { stream: true }));
            }
        }
    }
    catch (cause) {
        // A timeout abort with no status is transport; mid-stream (200 already
        // seen) it is a stall — the stream opened but the model never answered.
        if (cause?.name === 'TimeoutError') {
            stalled = true;
            error = '__timeout__';
        }
        else {
            error = String(cause?.message ?? cause);
            status = status ?? 0;
        }
    }
    const acc = splitter.finish();
    if (stalled === true && status !== null && status >= 200 && status < 300)
        error = '__timeout__';
    const { verdict, reason } = classify({
        status,
        error,
        content: acc.content,
        toolCalls: acc.toolCalls,
        stalled,
        timeoutMs: options.modelTimeoutMs,
    });
    // An `ok` that came from real content splits by whether the induced word
    // arrived: it is the difference between "the model answered my prompt" and
    // "something answered something". A tool-call reply keeps its own reason.
    if (verdict === 'ok' && acc.toolCalls === 0) {
        const induced = acc.content.toLowerCase().includes(inducedWord(options.prompt ?? DEFAULT_PROMPT));
        return {
            verdict: 'ok',
            reason: induced
                ? { key: 'answered-induced' }
                : { key: 'answered-offword', detail: acc.content.trim().slice(0, 40) },
            ms: Date.now() - started,
        };
    }
    return { verdict, reason, ms: Date.now() - started };
}
/** Probe a route's model list under one shared budget, out of order by design. */
export async function probeModels(models, options) {
    const out = new Map();
    const deadline = Date.now() + options.budgetMs;
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency, models.length)) }, async () => {
        for (;;) {
            if (options.signal?.aborted === true)
                return;
            const index = cursor++;
            if (index >= models.length)
                return;
            const model = models[index];
            if (Date.now() >= deadline) {
                out.set(model, { verdict: 'skipped', reason: { key: 'skipped-budget' } });
                continue;
            }
            out.set(model, await probeOne(options, model));
        }
    });
    await Promise.all(workers);
    return out;
}
