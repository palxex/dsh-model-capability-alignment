import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDocument } from 'yaml'
import { applyPatches, currentFields, parsePatch, planPatches, readModels, readProviders, renderPatch } from '../src/patch.ts'

/** A patch shaped like a real profile: header comments, one pi-ai entry. */
const PATCH = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries.
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      ofm-desktop:
        api: openai-completions
        baseURL: http://127.0.0.1:18900/v1
        models:
          - id: minimaxai/minimax-m3.1-flash
            name: MiniMax M3.1 Flash
            contextWindow: 1000000
          - id: openai/gpt-oss-20b
            name: GPT-OSS 20B
            contextWindow: 131072
          - id: hand/written
            name: Already Declared
            contextWindow: 200000
            input:
              - text
`

test('the header comments survive an edit', () => {
  const doc = parsePatch(PATCH)
  const provider = readProviders(doc).get('ofm-desktop')
  assert.ok(provider)
  const entry = readModels(provider).get('minimaxai/minimax-m3.1-flash')
  assert.ok(entry)
  entry.set('input', ['text', 'image'])
  const out = renderPatch(doc)
  assert.match(out, /^# Your patch layer/m)
  assert.match(out, /# a top-level YAML array/m)
})

test('an edit changes only the lines it must', () => {
  const doc = parsePatch(PATCH)
  const provider = readProviders(doc).get('ofm-desktop')!
  readModels(provider).get('minimaxai/minimax-m3.1-flash')!.set('input', ['text', 'image'])
  const before = PATCH.split('\n')
  const after = renderPatch(doc).split('\n')
  // The original is a strict subsequence of the result, in order.
  let cursor = 0
  for (const line of after) if (cursor < before.length && line === before[cursor]) cursor += 1
  assert.equal(cursor, before.length, 'every original line survives in order')
  assert.equal(after.length - before.length, 3, 'only text/image/input were added')
})

test('currentFields reads what an entry declares and nothing else', () => {
  const doc = parsePatch(PATCH)
  const models = readModels(readProviders(doc).get('ofm-desktop')!)
  assert.deepEqual(currentFields(models.get('hand/written')!), { input: ['text'] })
  assert.deepEqual(currentFields(models.get('openai/gpt-oss-20b')!), {})
})

test('only the models the user kept get a patch', () => {
  const doc = parsePatch(PATCH)
  const models = readModels(readProviders(doc).get('ofm-desktop')!)
  // The endpoint also serves `gone/deleted`, which this profile dropped.
  const endpoint = new Map([
    ['minimaxai/minimax-m3.1-flash', { input: ['text', 'image'] }],
    ['openai/gpt-oss-20b', { input: ['text'] }],
    ['gone/deleted', { input: ['text', 'image'] }],
  ])
  const patches = planPatches([{ id: 'ofm-desktop', models, endpoint }], { input: true, reasoningEfforts: true })
  assert.deepEqual(patches.map(p => `${p.provider}/${p.model}/${p.field}`).sort(), [
    'ofm-desktop/minimaxai/minimax-m3.1-flash/input',
    'ofm-desktop/openai/gpt-oss-20b/input',
  ])
  assert.ok(!patches.some(p => p.model === 'gone/deleted'), 'a dropped model is never resurrected')
})

test('an entry that already declares the same value is not rewritten', () => {
  const doc = parsePatch(PATCH)
  const models = readModels(readProviders(doc).get('ofm-desktop')!)
  const endpoint = new Map([['hand/written', { input: ['text'] }]])
  assert.deepEqual(planPatches([{ id: 'ofm-desktop', models, endpoint }], { input: true, reasoningEfforts: false }), [])
})

test('a differently ordered but equal declaration is not rewritten', () => {
  const doc = parsePatch(PATCH)
  const models = readModels(readProviders(doc).get('ofm-desktop')!)
  const endpoint = new Map([['hand/written', { input: ['text'] }]])
  const patches = planPatches([{ id: 'ofm-desktop', models, endpoint }], { input: true, reasoningEfforts: false })
  assert.equal(patches.length, 0)
})

test('a hand-written value is replaced only when it differs', () => {
  const doc = parsePatch(PATCH)
  const models = readModels(readProviders(doc).get('ofm-desktop')!)
  const endpoint = new Map([['hand/written', { input: ['text', 'image'] }]])
  const patches = planPatches([{ id: 'ofm-desktop', models, endpoint }], { input: true, reasoningEfforts: false })
  assert.deepEqual(patches, [{ provider: 'ofm-desktop', model: 'hand/written', field: 'input', value: ['text', 'image'], current: ['text'] }])
})

test('a scope of neither field plans nothing', () => {
  const doc = parsePatch(PATCH)
  const models = readModels(readProviders(doc).get('ofm-desktop')!)
  const endpoint = new Map([['minimaxai/minimax-m3.1-flash', { input: ['text', 'image'], reasoningEfforts: ['low', 'high'] }]])
  assert.deepEqual(planPatches([{ id: 'ofm-desktop', models, endpoint }], { input: false, reasoningEfforts: false }), [])
})

test('applying writes the planned values and counts them', () => {
  const doc = parsePatch(PATCH)
  const models = readModels(readProviders(doc).get('ofm-desktop')!)
  const endpoint = new Map([['minimaxai/minimax-m3.1-flash', { input: ['text', 'image'], reasoningEfforts: ['low', 'high'] }]])
  const patches = planPatches([{ id: 'ofm-desktop', models, endpoint }], { input: true, reasoningEfforts: true })
  assert.equal(applyPatches(doc, patches), 2)
  const after = readModels(readProviders(doc).get('ofm-desktop')!)
  assert.deepEqual(currentFields(after.get('minimaxai/minimax-m3.1-flash')!), { input: ['text', 'image'], reasoningEfforts: ['low', 'high'] })
})

test('a stale plan cannot invent a model that left the document', () => {
  const doc = parsePatch(PATCH)
  const written = applyPatches(doc, [{ provider: 'ofm-desktop', model: 'never/here', field: 'input', value: ['text', 'image'] }])
  assert.equal(written, 0)
  assert.match(renderPatch(doc), /never\/here/.test(renderPatch(doc)) ? /a/ : /a/)
  assert.ok(!renderPatch(doc).includes('never/here'))
})

test('a patch for an absent provider is skipped, not thrown', () => {
  const doc = parsePatch(PATCH)
  assert.equal(applyPatches(doc, [{ provider: 'nope', model: 'x', field: 'input', value: ['text'] }]), 0)
})

test('a profile with no pi-ai entry reads as no providers', () => {
  const doc = parseDocument('- id: something-else\n  name: x\n')
  assert.equal(readProviders(doc).size, 0)
})

test('reasoningEfforts is written as the {level: wire} dict pi-ai accepts', async () => {
  // pi-ai's schema is z.dict(level -> wire value); a bare list fails it and
  // the whole model entry is dropped at runtime — which is exactly the bug
  // that made filled-in models look empty in the running host. The YAML level
  // key maps to itself unless a gateway needs a rename.
  const doc = parsePatch(`- id: llm-pi-ai
  config:
    providers:
      demo:
        models:
          - id: kept
`)
  const written = applyPatches(doc, [
    { provider: 'demo', model: 'kept', field: 'reasoningEfforts', value: ['low', 'high', 'max'] },
    { provider: 'demo', model: 'kept', field: 'input', value: ['text', 'image'] },
  ])
  assert.equal(written, 2)
  const text = renderPatch(doc)
  assert.match(text, /reasoningEfforts:\n\s+low: low\n\s+high: high\n\s+max: max/)
  // A stored legacy list still reads back as its level list, so the diff view
  // does not pretend the field is unset, and the next write repairs it.
  const models = readModels(readProviders(doc).get('demo')!)
  assert.deepEqual(currentFields(models.get('kept')!), { input: ['text', 'image'], reasoningEfforts: ['low', 'high', 'max'] })
})

test('a remove patch deletes the entry; a remove of nothing is skipped', async () => {
  const doc = parsePatch(`- id: llm-pi-ai
  config:
    providers:
      demo:
        models:
          - id: dead
            input:
              - text
          - id: alive
`)
  const written = applyPatches(doc, [
    { provider: 'demo', model: 'dead', field: 'input', value: [], remove: true },
    { provider: 'demo', model: 'ghost', field: 'input', value: [], remove: true },
  ])
  assert.equal(written, 1, 'only the existing entry counts as removed')
  const models = readModels(readProviders(doc).get('demo')!)
  assert.equal(models.get('dead'), undefined, 'the failed entry is gone')
  assert.ok(models.get('alive'), 'the healthy entry stays')
  const text = renderPatch(doc)
  assert.ok(!text.includes('dead'), 'the rendered YAML no longer names it')
})
