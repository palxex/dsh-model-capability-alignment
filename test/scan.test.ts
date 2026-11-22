import http from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'
import { listingHeaders, listingUrl, scanDocument } from '../src/scan.ts'
import { parsePatch } from '../src/patch.ts'

const PATCH = `- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      ofm-desktop:
        api: openai-completions
        baseURL: http://127.0.0.1:18900/v1
        models:
          - id: vision-model
            contextWindow: 1000000
          - id: text-model
            contextWindow: 131072
      no-base:
        api: openai-completions
        models:
          - id: whatever
`

const listing = (rows: unknown) => async () => ({ data: rows })

test('the listing URL appends /models exactly once', () => {
  assert.equal(listingUrl('http://h/v1'), 'http://h/v1/models')
  assert.equal(listingUrl('http://h/v1/'), 'http://h/v1/models')
  assert.equal(listingUrl('http://h/v1/models'), 'http://h/v1/models')
})

test('a scan reports what each kept model would receive', async () => {
  const doc = parsePatch(PATCH)
  const result = await scanDocument(doc, { input: true, reasoningEfforts: true }, listing([
    { id: 'vision-model', input: ['text', 'image'], x_ofm_efforts: ['low', 'high'] },
    { id: 'text-model', input: ['text'] },
  ]))
  const ofm = result.providers.find(p => p.id === 'ofm-desktop')!
  assert.equal(ofm.error, undefined)
  const vision = ofm.models.find(m => m.id === 'vision-model')!
  assert.deepEqual(vision.endpoint, { input: ['text', 'image'], reasoningEfforts: ['low', 'high'] })
  assert.deepEqual(vision.patches.map(p => p.field).sort(), ['input', 'reasoningEfforts'])
  const text = ofm.models.find(m => m.id === 'text-model')!
  assert.deepEqual(text.patches.map(p => p.field), ['input'])
})

test('a model the endpoint serves but the profile dropped is shown, adoptable by explicit tick', async () => {
  // The listing is complete on purpose: seeing that a route serves a model the
  // profile does not keep is information. Its patches carry `adopt: true` —
  // they are real writes, but only for the model the user explicitly ticked,
  // and applyPatches mints a minimal entry for it. Nothing adopts by default:
  // the page pre-ticks its own rows only.
  const doc = parsePatch(PATCH)
  const result = await scanDocument(doc, { input: true, reasoningEfforts: false }, listing([
    { id: 'vision-model', input: ['text', 'image'] },
    { id: 'a-model-user-deleted', input: ['text', 'image'] },
  ]))
  const ofm = result.providers.find(p => p.id === 'ofm-desktop')!
  const dropped = ofm.models.find(m => m.id === 'a-model-user-deleted')
  assert.ok(dropped, 'the off-list model is listed')
  assert.equal(dropped.origin, 'endpoint')
  assert.deepEqual(dropped.current, {}, 'it declares nothing, having no entry')
  assert.deepEqual(
    dropped.patches.map(patch => ({ field: patch.field, value: patch.value, adopt: patch.adopt })),
    [{ field: 'input', value: ['text', 'image'], adopt: true }],
    'its write is an explicit adoption',
  )
  assert.equal(result.unlistedCount, 1)
})

test('the endpoint listing order is untouched, with gone-upstream rows first', async () => {
  // The rows the profile keeps but the endpoint no longer serves lead the
  // list with a "gone upstream" marker; everything else is shown in the
  // endpoint's own order, whether the profile keeps it or not. No promotion
  // of "our" models, no special decoration.
  const doc = parsePatch(`- id: llm-pi-ai
  config:
    providers:
      demo:
        api: openai-completions
        baseURL: http://demo/v1
        models:
          - id: vanished
          - id: shared
`)
  const result = await scanDocument(doc, { input: true, reasoningEfforts: false }, listing([
    { id: 'first-extra', input: ['text'] },
    { id: 'shared', input: ['text'] },
    { id: 'second-extra', input: ['text'] },
  ]))
  const demo = result.providers.find(p => p.id === 'demo')!
  assert.deepEqual(demo.models.map(m => m.id), ['vanished', 'first-extra', 'shared', 'second-extra'])
  assert.deepEqual(demo.models.map(m => m.origin), ['config', 'endpoint', 'config', 'endpoint'])
  assert.equal(demo.models[0].listed, false, 'the vanished row carries the gone marker')
})

test('a kept model the endpoint never names is listed with no endpoint facts', async () => {
  const doc = parsePatch(PATCH)
  const result = await scanDocument(doc, { input: true, reasoningEfforts: false }, listing([{ id: 'vision-model', input: ['text', 'image'] }]))
  const ofm = result.providers.find(p => p.id === 'ofm-desktop')!
  const text = ofm.models.find(m => m.id === 'text-model')!
  assert.equal(text.listed, false)
  assert.equal(text.endpoint, null)
  assert.deepEqual(text.patches, [])
})

test('an endpoint failure is reported against its provider, not thrown', async () => {
  const doc = parsePatch(PATCH)
  const result = await scanDocument(doc, { input: true, reasoningEfforts: false }, async () => { throw new Error('connection refused') })
  assert.equal(result.providers.length, 2)
  assert.equal(result.providers.find(p => p.id === 'ofm-desktop')!.error, 'connection refused')
  assert.equal(result.providers.find(p => p.id === 'no-base')!.error, 'the profile declares no baseURL')
})

test('a profile with no baseURL is reported, not fetched', async () => {
  let called = 0
  const doc = parsePatch(PATCH)
  const result = await scanDocument(doc, { input: true, reasoningEfforts: false }, async () => { called += 1; return { data: [] } })
  const noBase = result.providers.find(p => p.id === 'no-base')!
  assert.equal(noBase.error, 'the profile declares no baseURL')
  assert.equal(called, 1, 'only the provider with a baseURL was fetched')
})

test("a gateway's own level names are shown but withheld from the plan", async () => {
  const doc = parsePatch(PATCH)
  const result = await scanDocument(doc, { input: false, reasoningEfforts: true }, listing([
    { id: 'vision-model', x_ofm_efforts: ['light', 'high', 'extra_high'] },
  ]))
  const vision = result.providers.find(p => p.id === 'ofm-desktop')!.models.find(m => m.id === 'vision-model')!
  assert.deepEqual(vision.endpoint?.reasoningEfforts, ['light', 'high', 'extra_high'])
  assert.deepEqual(vision.patches, [], 'a foreign vocabulary is never written')
  assert.deepEqual(vision.withheld, [{ key: 'withheld-vocabulary', detail: 'light|high|extra_high' }])
})

test('the scan respects the requested scope', async () => {
  const doc = parsePatch(PATCH)
  const result = await scanDocument(doc, { input: false, reasoningEfforts: true }, listing([
    { id: 'vision-model', input: ['text', 'image'], x_ofm_efforts: ['low', 'high'] },
  ]))
  const vision = result.providers.find(p => p.id === 'ofm-desktop')!.models.find(m => m.id === 'vision-model')!
  assert.deepEqual(vision.patches.map(p => p.field), ['reasoningEfforts'])
})

test('an anthropic route lists at {root}/v1/models, any other at {base}/models', () => {
  assert.equal(listingUrl('http://h/v1', 'openai-completions'), 'http://h/v1/models')
  assert.equal(listingUrl('http://h/v1', 'anthropic-messages'), 'http://h/v1/models')
  assert.equal(listingUrl('http://h', 'anthropic-messages'), 'http://h/v1/models')
  assert.equal(listingUrl('http://h/anthropic/v1', 'anthropic-messages'), 'http://h/anthropic/v1/models')
  assert.equal(listingUrl('http://h/v1/models', 'openai-responses'), 'http://h/v1/models')
})

test('each protocol gets its own authentication header', () => {
  assert.deepEqual(listingHeaders('openai-completions', 'k'), { accept: 'application/json', authorization: 'Bearer k' })
  assert.deepEqual(listingHeaders('anthropic-messages', 'k'), {
    accept: 'application/json', 'x-api-key': 'k', 'anthropic-version': '2023-06-01',
  })
})

test('a keyless route sends no credential header', () => {
  assert.deepEqual(listingHeaders('openai-completions', undefined), { accept: 'application/json' })
  assert.deepEqual(listingHeaders(undefined, ''), { accept: 'application/json' })
})

test('the scan sends the credential its resolver returns', async () => {
  const doc = parsePatch(PATCH)
  const seen: Array<Record<string, string>> = []
  await scanDocument(doc, { input: true, reasoningEfforts: false }, async request => {
    seen.push(request.headers)
    return { data: [] }
  }, () => 'secret')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].authorization, 'Bearer secret')
})

test('a route whose endpoint refuses is reported without stopping the rest', async () => {
  const doc = parsePatch(`- id: llm-pi-ai
  name: x
  config:
    providers:
      locked:
        api: openai-completions
        baseURL: http://locked/v1
        models:
          - id: a
      open:
        api: openai-completions
        baseURL: http://open/v1
        models:
          - id: b
`)
  const result = await scanDocument(doc, { input: true, reasoningEfforts: false }, async request => {
    if (request.url.startsWith('http://locked')) throw new Error('HTTP 401 (this route needs a credential)')
    return { data: [{ id: 'b', input: ['text', 'image'] }] }
  })
  assert.match(result.providers.find(p => p.id === 'locked')!.error!, /401/)
  assert.deepEqual(result.providers.find(p => p.id === 'open')!.models[0].patches.map(p => p.field), ['input'])
})

test('a scan restricted to one route never touches the others', async () => {
  const doc = parsePatch(`- id: llm-pi-ai
  name: x
  config:
    providers:
      first:
        api: openai-completions
        baseURL: http://first/v1
        models:
          - id: a
      second:
        api: openai-completions
        baseURL: http://second/v1
        models:
          - id: b
`)
  const urls: string[] = []
  const result = await scanDocument(
    doc, { input: true, reasoningEfforts: false },
    async request => { urls.push(request.url); return { data: [{ id: urls.length === 0 ? 'a' : 'a', input: ['text', 'image'] }] } },
    undefined, undefined,
    ['first'],
  )
  assert.deepEqual(urls, ['http://first/v1/models'], 'only the selected route was fetched')
  assert.deepEqual(result.providers.map(p => p.id), ['first'])
})

test('an empty route list scans every route', async () => {
  const doc = parsePatch(PATCH)
  const urls: string[] = []
  await scanDocument(doc, { input: true, reasoningEfforts: false }, async request => {
    urls.push(request.url)
    return { data: [] }
  }, undefined, undefined, [])
  assert.equal(urls.length, 1, 'the one route with a baseURL was fetched')
})

test('a route the profile does not configure is silently absent, not an error', async () => {
  const doc = parsePatch(PATCH)
  const result = await scanDocument(doc, { input: true, reasoningEfforts: false }, async () => ({ data: [] }), undefined, undefined, ['no-such-route'])
  assert.deepEqual(result.providers, [])
})

test('the liveness probe sweeps every model the route serves and reports verdicts', async () => {
  // The probe rides the same scan when scope.prune is present. It talks real
  // HTTP (the sweep's shape: a streaming one-word reply), so this test stands
  // up a tiny SSE gateway: alive answers ok, dead opens and stalls, retired
  // 404s, lied answers with the wrong word.
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const model = (JSON.parse(body) as { model?: string }).model ?? ''
      if (model === 'kept-dead') {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        // Open the stream and never finish it; the probe's timeout classifies.
        response.write('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')
        return
      }
      if (model === 'retired') {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'model does not exist' } }))
        return
      }
      if (model === 'lied') {
        // A reply with real content but not the induced word: the model (or
        // gateway) answered something else. Still `ok` — content arrived over
        // this model's route — but the reason says the word never showed.
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(`data: {"choices":[{"delta":{"content":"certainly"},"finish_reason":"stop"}]}\n\n`)
        response.write('data: [DONE]\n\n')
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    const doc = parsePatch(`- id: llm-pi-ai
  config:
    providers:
      demo:
        api: openai-completions
        baseURL: http://127.0.0.1:${port}/v1
        models:
          - id: kept-alive
          - id: kept-dead
          - id: retired
          - id: slow-start
          - id: lied
`)
    const result = await scanDocument(
      doc,
      { input: true, reasoningEfforts: false, prune: { modelTimeoutMs: 1500, concurrency: 3, budgetMs: 60_000 } },
      async () => ({ data: [{ id: 'kept-alive', input: ['text'] }] }),
      undefined, undefined, ['demo'],
    )
    const demo = result.providers.find(p => p.id === 'demo')!
    const byId = new Map(demo.models.map(m => [m.id, m]))
    assert.equal(byId.get('kept-alive')!.prune!.verdict, 'ok', 'the stub model answered the induced word')
    assert.deepEqual(byId.get('kept-alive')!.prune!.reason, { key: 'answered-induced' }, 'the reply matched the induced word')
    assert.deepEqual(byId.get('lied')!.prune!.reason, { key: 'answered-offword', detail: 'certainly' }, 'a real-but-wrong reply is told apart')
    assert.equal(byId.get('retired')!.prune!.verdict, 'invalid', '404 names the id as gone')
    assert.equal(byId.get('kept-dead')!.prune!.verdict, 'timeout', 'a stalled stream is its own verdict')
    // The spend guard: the cut happens at the first token, so a slow-start
    // stream is classified ok in roughly the time to that token, not after
    // the model finishes or the timeout runs out.
    const slow = byId.get('slow-start')!.prune!
    assert.equal(slow.verdict, 'ok', 'the first token is the verdict')
    assert.ok(slow.ms < 1500, `cut at first token (${slow.ms}ms), not at timeout`)
  } finally {
    server.close()
  }
})

test('no probe runs without scope.prune', async () => {
  const doc = parsePatch(PATCH)
  const result = await scanDocument(doc, { input: true, reasoningEfforts: false }, listing([{ id: 'vision-model', input: ['text'] }]))
  const ofm = result.providers.find(p => p.id === 'ofm-desktop')!
  assert.ok(ofm.models.every(m => m.prune === undefined), 'no row carries a prune verdict')
})

test('a custom probe prompt checks its own last word', async () => {
  // The induced word is the prompt's last token: a user who swaps the prompt
  // for their own wording swaps the verification word with it, so the reply
  // check always verifies what was actually asked.
  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const prompt = (JSON.parse(body) as { messages?: Array<{ content?: string }> }).messages?.[0]?.content ?? ''
      const reply = prompt.includes('pong') ? 'pong' : 'certainly'
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`data: {"choices":[{"delta":{"content":"${reply}"},"finish_reason":"stop"}]}\n\n`)
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    const doc = parsePatch(`- id: llm-pi-ai
  config:
    providers:
      demo:
        api: openai-completions
        baseURL: http://127.0.0.1:${port}/v1
        models:
          - id: honest
`)
    const result = await scanDocument(
      doc,
      { input: false, reasoningEfforts: false, prune: { modelTimeoutMs: 5000, concurrency: 1, budgetMs: 60_000, prompt: 'just reply pong' } },
      async () => ({ data: [] }),
      undefined, undefined, ['demo'],
    )
    const row = result.providers[0].models[0]
    assert.deepEqual(row.prune!.reason, { key: 'answered-induced' }, 'the custom prompt induced its own last word')
  } finally {
    server.close()
  }
})

test('the probe records the round trip it measured', async () => {
  // The page shows the recorded time; it never re-measures. A probe that
  // answered carries the milliseconds it took, so the row can report it.
  const server = http.createServer((request, response) => {
    request.on('data', () => {})
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    const doc = parsePatch(`- id: llm-pi-ai
  config:
    providers:
      demo:
        api: openai-completions
        baseURL: http://127.0.0.1:${port}/v1
        models:
          - id: quick
`)
    const result = await scanDocument(
      doc,
      { input: false, reasoningEfforts: false, prune: { modelTimeoutMs: 5000, concurrency: 1, budgetMs: 30_000 } },
      async () => ({ data: [] }),
      undefined, undefined, ['demo'],
    )
    const row = result.providers[0].models.find(model => model.id === 'quick')!
    assert.equal(row.prune?.verdict, 'ok')
    assert.equal(typeof row.prune?.ms, 'number', 'the measured round trip rides along')
    assert.ok((row.prune?.ms ?? -1) >= 0)
  } finally {
    server.close()
  }
})
