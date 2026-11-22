/**
 * SSE record parsing for the probe, absorbed from `gst/ofm-model-probe`'s
 * `lib/sse.mjs`. The gateway emits standard OpenAI-style SSE records that can
 * straddle TCP chunk boundaries, so a stateful splitter is required — a naive
 * per-chunk split on `\n\n` loses the split record and silently reports "no
 * content", which would prune a working model.
 */

/** What one streamed reply accumulated. */
export interface SSEAccumulator {
  content: string
  reasoning: string
  toolCalls: number
  finish: string | null
  streamError: string | null
  firstTokenAt: number | null
  lastTokenAt: number | null
  _buffer: string
}

function emptyAcc(): SSEAccumulator {
  return {
    content: '', reasoning: '', toolCalls: 0, finish: null,
    streamError: null, firstTokenAt: null, lastTokenAt: null, _buffer: '',
  }
}

function consumeRecord(record: string, acc: SSEAccumulator, now: () => number): void {
  for (const line of record.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '' || payload === '[DONE]') continue
    let json: {
      error?: { message?: string }
      choices?: Array<{ delta?: { content?: string, reasoning_content?: string, tool_calls?: Array<{ id?: string, function?: { name?: string } }> }, finish_reason?: string }>
    }
    try { json = JSON.parse(payload) } catch { continue }
    if (json.error !== undefined) { acc.streamError = String(json.error?.message ?? json.error); continue }
    const choice = json.choices?.[0]
    if (choice === undefined) continue
    const delta = choice.delta ?? {}
    // An empty delta (the opening `role: assistant` frame) is not a token;
    // only real text starts the clock.
    if (typeof delta.content === 'string' && delta.content !== '') {
      acc.content += delta.content
      acc.lastTokenAt = now()
      if (acc.firstTokenAt === null) acc.firstTokenAt = acc.lastTokenAt
    }
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
      acc.reasoning += delta.reasoning_content
      acc.lastTokenAt = now()
      if (acc.firstTokenAt === null) acc.firstTokenAt = acc.lastTokenAt
    }
    if (Array.isArray(delta.tool_calls) && delta.tool_calls.some(tc => tc?.id !== undefined || tc?.function?.name !== undefined)) {
      acc.toolCalls += 1
      acc.lastTokenAt = now()
      if (acc.firstTokenAt === null) acc.firstTokenAt = acc.lastTokenAt
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) acc.finish = choice.finish_reason
  }
}

/** A push-based splitter for the real reader loop. */
export function parseSSEChunk(now: () => number = Date.now): {
  push(text: string): SSEAccumulator
  finish(): SSEAccumulator
} {
  let acc = emptyAcc()
  return {
    push(text: string): SSEAccumulator {
      const normalised = text.replace(/\r\n/g, '\n')
      const joined = acc._buffer === '' ? normalised : acc._buffer + normalised
      const records = joined.split('\n\n')
      acc._buffer = records.pop() ?? ''
      for (const record of records) consumeRecord(record, acc, now)
      return acc
    },
    finish(): SSEAccumulator {
      // The last chunk before close may omit the blank line; parse the tail.
      if (acc._buffer !== '') {
        consumeRecord(acc._buffer, acc, now)
        acc._buffer = ''
      }
      return acc
    },
  }
}
