import test from 'node:test'
import assert from 'node:assert/strict'
import { normaliseModalities, normalizeMenu, readEndpointModels, sameVocabulary } from '../src/endpoint.ts'

test('modalities are canonicalised to text-then-image', () => {
  assert.deepEqual(normaliseModalities(['image', 'text']), ['text', 'image'])
  assert.deepEqual(normaliseModalities(['text']), ['text'])
  assert.deepEqual(normaliseModalities(['text', 'image', 'video']), ['text', 'image'])
})

test('an absent or empty declaration means the endpoint said nothing', () => {
  assert.equal(normaliseModalities(undefined), undefined)
  assert.equal(normaliseModalities(null), undefined)
  assert.equal(normaliseModalities([]), undefined)
  assert.equal(normaliseModalities(['audio']), undefined)
})

test('every modality spelling a gateway uses is read', () => {
  const shapes = [
    { input: ['text', 'image'] },
    { input_modalities: ['text', 'image'] },
    { modalities: { input: ['text', 'image'] } },
    { architecture: { input_modalities: ['text', 'image'] } },
  ]
  for (const row of shapes) {
    assert.deepEqual(readEndpointModels({ data: [{ id: 'm', ...row }] }), [{ id: 'm', input: ['text', 'image'] }], JSON.stringify(row))
  }
})

test('a data array and a models map both read', () => {
  assert.deepEqual(readEndpointModels({ data: [{ id: 'a', input: ['text'] }] }), [{ id: 'a', input: ['text'] }])
  assert.deepEqual(readEndpointModels({ models: { a: { input: ['text'] } } }), [{ id: 'a', input: ['text'] }])
})

test('the map key is the endpoint-facing id', () => {
  assert.deepEqual(readEndpointModels({ models: { 'served/alias': { id: 'canonical', input: ['text'] } } }), [{ id: 'served/alias', input: ['text'] }])
})

test('effort menus read from the effort and the option shape', () => {
  assert.deepEqual(readEndpointModels({ data: [{ id: 'm', x_ofm_efforts: ['low', 'high'] }] }), [{ id: 'm', reasoningEfforts: ['low', 'high'] }])
  assert.deepEqual(
    readEndpointModels({ data: [{ id: 'm', reasoning_options: [{ type: 'effort', values: ['low', 'max'] }] }] }),
    [{ id: 'm', reasoningEfforts: ['low', 'max'] }],
  )
})

test('a malformed row is skipped, not fatal', () => {
  const rows = readEndpointModels({ data: [{ id: 'ok', input: ['text'] }, { nope: 1 }, null, 'x', { id: '' }] })
  assert.deepEqual(rows, [{ id: 'ok', input: ['text'] }])
})

test('a repeated id is reported once', () => {
  assert.equal(readEndpointModels({ data: [{ id: 'm', input: ['text'] }, { id: 'm', input: ['text', 'image'] }] }).length, 1)
})

test('a body that is neither shape reads as nothing', () => {
  assert.deepEqual(readEndpointModels({}), [])
  assert.deepEqual(readEndpointModels(null), [])
  assert.deepEqual(readEndpointModels({ data: 'nope' }), [])
})

test("pi-ai's own vocabulary is recognised and a gateway's is not", () => {
  assert.equal(sameVocabulary(['low', 'high', 'max']), true)
  assert.equal(sameVocabulary(['light', 'high', 'extra_high']), false)
  // `off` is pi-ai's spelling; a gateway that says `none` is using its own.
  assert.equal(sameVocabulary(['off', 'low', 'medium', 'xhigh']), true)
  assert.equal(sameVocabulary(['none', 'low', 'medium', 'xhigh']), false)
})

test('gateway menus translate into pi-ai vocabulary', () => {
  // A menu that says `disabled|high` is pi-ai's `off|high` under other names.
  // Writing `disabled` would fail the schema and drop the entry; translating
  // keeps the real information. Unknown spellings still withhold.
  assert.deepEqual(normalizeMenu(['disabled', 'high']), ['off', 'high'])
  assert.deepEqual(normalizeMenu(['none', 'low']), ['off', 'low'])
  assert.deepEqual(normalizeMenu(['low', 'high', 'max']), ['low', 'high', 'max'])
  assert.deepEqual(normalizeMenu(['light', 'high', 'extra_high']), undefined)
  // A gateway's own effort ladder maps by rank: the OFM free lane's
  // light|balanced|deep is three real rungs (2048 / 8192 / unbounded), and the
  // gateway resolves whatever pi-ai sends back onto those rungs.
  assert.deepEqual(normalizeMenu(['light', 'balanced', 'deep']), ['minimal', 'medium', 'max'])
})
