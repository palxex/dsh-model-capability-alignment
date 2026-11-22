import test from 'node:test'
import assert from 'node:assert/strict'

import { resolvePatchLocation } from '../src/index.ts'

const fallback = () => ({ file: '/home/u/.dsh/profiles/web/cordis.patch.yml', exists: true })

test('the launcher patch path wins over every constructed guess', () => {
  // Desktop keeps its own profile, and its home differs from the CLI's. The
  // composed path the launcher reports is the only value that is right on
  // both, so it outranks the constructed layout — the bug this pins: a
  // hardcoded 'web' made every Windows install read a profile that does not
  // exist there, and the provider dropdown stayed empty.
  const resolved = resolvePatchLocation(
    { patchPath: 'C:/Users/u/.dsh/profiles/desktop/cordis.patch.yml' },
    fallback,
    () => true,
  )
  assert.equal(resolved.file, 'C:/Users/u/.dsh/profiles/desktop/cordis.patch.yml')
  assert.equal(resolved.exists, true)
})

test('the reported profile directory is the second tier', () => {
  const resolved = resolvePatchLocation(
    { dir: '/home/u/.dsh/profiles/desktop' },
    fallback,
    () => true,
  )
  assert.equal(resolved.file, '/home/u/.dsh/profiles/desktop/cordis.patch.yml')
})

test('without a context the constructed layout is used', () => {
  assert.deepEqual(resolvePatchLocation(undefined, fallback, () => true), fallback())
})

test('a context path that does not exist is reported, not silently replaced', () => {
  // Falling through to a different profile here would edit the wrong file;
  // the caller refuses with a message naming the path instead.
  const resolved = resolvePatchLocation(
    { patchPath: '/nope/cordis.patch.yml' },
    fallback,
    () => false,
  )
  assert.equal(resolved.file, '/nope/cordis.patch.yml')
  assert.equal(resolved.exists, false)
})
