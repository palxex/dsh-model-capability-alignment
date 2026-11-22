/**
 * SSE record parsing for the probe, absorbed from `gst/ofm-model-probe`'s
 * `lib/sse.mjs`. The gateway emits standard OpenAI-style SSE records that can
 * straddle TCP chunk boundaries, so a stateful splitter is required — a naive
 * per-chunk split on `\n\n` loses the split record and silently reports "no
 * content", which would prune a working model.
 */
/** What one streamed reply accumulated. */
export interface SSEAccumulator {
    content: string;
    reasoning: string;
    toolCalls: number;
    finish: string | null;
    streamError: string | null;
    firstTokenAt: number | null;
    lastTokenAt: number | null;
    _buffer: string;
}
/** A push-based splitter for the real reader loop. */
export declare function parseSSEChunk(now?: () => number): {
    push(text: string): SSEAccumulator;
    finish(): SSEAccumulator;
};
