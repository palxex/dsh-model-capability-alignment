import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyPatchesToProfile } from '../src/apply.ts'
import { resolvePatchFile } from '../src/store.ts'
import { readProviders, readModels, currentFields, parsePatch } from '../src/patch.ts'

const PATCH = `# hand-written header this plugin must not eat
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      demo:
        api: openai-completions
        baseURL: http://demo/v1
        models:
          - id: vision-model
            contextWindow: 1000000
          - id: text-model
            contextWindow: 131072
`

function sandbox(text = PATCH) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modality-apply-'))
  fs.mkdirSync(path.join(root, 'profiles', 'web'), { recursive: true })
  const location = resolvePatchFile(root, 'web')
  fs.writeFileSync(location.file, text)
  return location
}

const listing = (rows: unknown[]) => async () => ({ data: rows })

test('an apply writes the fields and leaves a backup of the original', async () => {
  const location = sandbox()
  const result = await applyPatchesToProfile(location, { input: true, reasoningEfforts: false }, listing([
    { id: 'vision-model', input: ['text', 'image'] },
    { id: 'text-model', input: ['text'] },
  ]))
  assert.equal(result.written, 2)
  assert.equal(fs.readFileSync(result.backup.file, 'utf8'), PATCH, 'the backup is the pre-edit bytes')
  const after = parsePatch(fs.readFileSync(location.file, 'utf8'))
  const models = readModels(readProviders(after).get('demo')!)
  assert.deepEqual(currentFields(models.get('vision-model')!), { input: ['text', 'image'] })
})

test('an apply keeps the hand-written comment', async () => {
  const location = sandbox()
  await applyPatchesToProfile(location, { input: true, reasoningEfforts: false }, listing([{ id: 'vision-model', input: ['text', 'image'] }]))
  assert.match(fs.readFileSync(location.file, 'utf8'), /^# hand-written header/m)
})

test('an apply refuses when the entry already declares the field', async () => {
  // Both entries already declare their modalities, so the endpoint agrees with
  // the file and there is nothing left to write.
  const already = `# header
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      demo:
        api: openai-completions
        baseURL: http://demo/v1
        models:
          - id: vision-model
            contextWindow: 1000000
            input:
              - text
              - image
`
  const location = sandbox(already)
  const before = fs.readFileSync(location.file, 'utf8')
  await assert.rejects(
    () => applyPatchesToProfile(location, { input: true, reasoningEfforts: false }, listing([{ id: 'vision-model', input: ['text', 'image'] }])),
    /nothing to write/,
  )
  assert.equal(fs.readFileSync(location.file, 'utf8'), before, 'a refused apply writes nothing')
  const backups = fs.readdirSync(path.dirname(location.file)).filter(name => name.includes('.bak-'))
  assert.deepEqual(backups, [], 'a refused apply takes no backup')
})

test('an explicit field list writes only what it names', async () => {
  const location = sandbox()
  const result = await applyPatchesToProfile(
    location, { input: true, reasoningEfforts: false },
    listing([{ id: 'vision-model', input: ['text', 'image'] }, { id: 'text-model', input: ['text'] }]),
    { providers: ['demo'], fields: [{ provider: 'demo', model: 'text-model', field: 'input', value: ['text'] }] },
  )
  assert.equal(result.written, 1)
  const after = parsePatch(fs.readFileSync(location.file, 'utf8'))
  const models = readModels(readProviders(after).get('demo')!)
  assert.deepEqual(currentFields(models.get('text-model')!), { input: ['text'] })
  assert.deepEqual(currentFields(models.get('vision-model')!), {}, 'the unselected model is untouched')
})

test('a field naming an off-list model adopts it into the profile', async () => {
  const location = sandbox()
  const result = await applyPatchesToProfile(
    location, { input: true, reasoningEfforts: false },
    listing([{ id: 'vision-model', input: ['text', 'image'] }, { id: 'newcomer', input: ['text', 'image'] }]),
    { providers: ['demo'], fields: [{ provider: 'demo', model: 'newcomer', field: 'input', value: ['text', 'image'], adopt: true }] },
  )
  assert.equal(result.written, 1)
  const after = parsePatch(fs.readFileSync(location.file, 'utf8'))
  const models = readModels(readProviders(after).get('demo')!)
  assert.deepEqual(currentFields(models.get('newcomer')!), { input: ['text', 'image'] })
  // The adopted entry is minimal: no invented name, no invented window.
  const raw = models.get('newcomer')!
  assert.equal(raw.get('id'), 'newcomer')
  assert.equal(raw.get('contextWindow'), undefined)
  assert.equal(raw.get('name'), undefined)
})

test('an endpoint failure writes nothing', async () => {
  const location = sandbox()
  const before = fs.readFileSync(location.file, 'utf8')
  await assert.rejects(
    () => applyPatchesToProfile(location, { input: true, reasoningEfforts: false }, async () => { throw new Error('offline') }),
    /nothing to write/,
  )
  assert.equal(fs.readFileSync(location.file, 'utf8'), before)
})

test('an apply bounded to one route writes no other route, even unticked', async () => {
  // The bug this pins: "Apply all" sent no model list, so the host wrote every
  // route the profile configured rather than the one on screen.
  const twoRoutes = `- id: llm-pi-ai
  name: x
  config:
    providers:
      on-screen:
        api: openai-completions
        baseURL: http://demo/v1
        models:
          - id: kept
      other-route:
        api: openai-completions
        baseURL: http://demo/v1
        models:
          - id: kept
`
  const location = sandbox(twoRoutes)
  const result = await applyPatchesToProfile(
    location, { input: true, reasoningEfforts: false },
    listing([{ id: 'kept', input: ['text', 'image'] }]),
    { providers: ['on-screen'] },
  )
  assert.equal(result.written, 1, 'only the selected route gained a field')
  const after = parsePatch(fs.readFileSync(location.file, 'utf8'))
  const providers = readProviders(after)
  assert.deepEqual(currentFields(readModels(providers.get('on-screen')!).get('kept')!), { input: ['text', 'image'] })
  assert.deepEqual(currentFields(readModels(providers.get('other-route')!).get('kept')!), {}, 'the other route is untouched')
})

test('a field without adopt never invents an entry', async () => {
  // The page only sends `adopt` for a row the user explicitly ticked; a field
  // that lost its marker (a stale client, a hand-built call) must be skipped
  // rather than minting an entry and resurrecting a model the user deleted.
  const location = sandbox()
  const result = await applyPatchesToProfile(
    location, { input: true, reasoningEfforts: false },
    listing([{ id: 'vision-model', input: ['text', 'image'] }]),
    { providers: ['demo'], fields: [{ provider: 'demo', model: 'a-model-user-deleted', field: 'input', value: ['text', 'image'] }] },
  ).catch((error: Error) => error)
  assert.ok(result instanceof Error, 'the apply refuses instead of silently doing nothing')
  assert.match((result as Error).message, /no entry in this profile accepts a-model-user-deleted/)
  assert.equal(fs.readFileSync(location.file, 'utf8'), PATCH, 'the file is untouched')
})

test('a remove field drops the profile entry and nothing else', async () => {
  const location = sandbox()
  const result = await applyPatchesToProfile(
    location, { input: true, reasoningEfforts: false },
    listing([{ id: 'text-model', input: ['text'] }]),
    { providers: ['demo'], fields: [{ provider: 'demo', model: 'text-model', field: 'input', value: [], remove: true }] },
  )
  assert.equal(result.written, 1)
  const after = parsePatch(fs.readFileSync(location.file, 'utf8'))
  assert.equal(readModels(readProviders(after).get('demo')!).get('text-model'), undefined, 'the entry is gone')
})
