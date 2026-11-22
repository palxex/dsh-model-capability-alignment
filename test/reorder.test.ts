import test from 'node:test'
import assert from 'node:assert/strict'

import { parsePatch, readModels, readProviders, renderPatch } from '../src/patch.ts'
import { reorderModels } from '../src/reorder.ts'

const PATCH = `# hand-written header, keep me
- id: llm-pi-ai
  config:
    providers:
      demo:
        api: openai-completions
        models:
          # this comment belongs to zed
          - id: zed
            contextWindow: 1000
          - id: alpha
          - id: orphan
`

test('the listing order wins; unlisted entries keep their own order after it', () => {
  const doc = parsePatch(PATCH)
  const profile = readProviders(doc).get('demo')!
  assert.equal(reorderModels(profile, ['alpha', 'zed']), true)
  assert.deepEqual([...readModels(profile).keys()], ['alpha', 'zed', 'orphan'])
})

test('reordering moves nodes, it never re-creates them', () => {
  // A rebuilt node loses the comment attached above it, so the header and the
  // comment above `zed` both surviving is what says these are the same nodes.
  const doc = parsePatch(PATCH)
  const profile = readProviders(doc).get('demo')!
  reorderModels(profile, ['alpha', 'zed'])
  const text = renderPatch(doc)
  assert.ok(text.startsWith('# hand-written header, keep me'))
  assert.ok(text.includes('# this comment belongs to zed'))
  const zed = readModels(profile).get('zed')!
  assert.equal(zed.get('contextWindow'), 1000, 'the entry keeps its own fields')
})

test('an order that matches the file changes nothing', () => {
  const doc = parsePatch(PATCH)
  const profile = readProviders(doc).get('demo')!
  const before = renderPatch(doc)
  assert.equal(reorderModels(profile, ['zed', 'alpha', 'orphan']), false)
  assert.equal(renderPatch(doc), before, 'byte-identical when already ordered')
})

test('unknown ids and duplicates are ignored, never invented', () => {
  const doc = parsePatch(PATCH)
  const profile = readProviders(doc).get('demo')!
  reorderModels(profile, ['ghost', 'alpha', 'alpha', 'nope'])
  assert.deepEqual([...readModels(profile).keys()], ['alpha', 'zed', 'orphan'])
})

test('a profile with no models sequence is left alone', () => {
  const doc = parsePatch(`- id: llm-pi-ai
  config:
    providers:
      demo:
        api: openai-completions
`)
  const profile = readProviders(doc).get('demo')!
  assert.equal(reorderModels(profile, ['anything']), false)
})
