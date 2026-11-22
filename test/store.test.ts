import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BACKUP_KEEP, BACKUP_MARKER, backupPatch, readPatch, resolvePatchFile, writePatch } from '../src/store.ts'

function sandbox(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modality-patcher-'))
  fs.mkdirSync(path.join(root, 'profiles', 'web'), { recursive: true })
  return root
}

test('the patch path is <DSH_HOME>/profiles/<profile>/cordis.patch.yml', () => {
  const home = sandbox()
  assert.equal(resolvePatchFile(home, 'web').file, path.join(home, 'profiles', 'web', 'cordis.patch.yml'))
})

test('an absent patch file is reported, never invented', () => {
  const home = sandbox()
  const location = resolvePatchFile(home, 'web')
  assert.equal(location.exists, false)
  assert.throws(() => readPatch(location), /does not exist/)
  assert.equal(fs.existsSync(location.file), false, 'reading must not create the file')
})

test('reading an existing patch returns its bytes', () => {
  const home = sandbox()
  const location = resolvePatchFile(home, 'web')
  fs.writeFileSync(location.file, 'text\n')
  const found = resolvePatchFile(home, 'web')
  assert.equal(found.exists, true)
  assert.equal(readPatch(found), 'text\n')
})

test('a backup lands beside the original and holds the same bytes', () => {
  const home = sandbox()
  const location = resolvePatchFile(home, 'web')
  fs.writeFileSync(location.file, 'before\n')
  const backup = backupPatch(location, 'before\n', new Date('2026-11-18T08:30:00Z'))
  assert.match(backup.file, new RegExp(`cordis\\.patch\\.yml\\.${BACKUP_MARKER}2026-11-18_08-30-00$`))
  assert.equal(path.dirname(backup.file), path.dirname(location.file))
  assert.equal(fs.readFileSync(backup.file, 'utf8'), 'before\n')
  assert.equal(backup.bytes, Buffer.byteLength('before\n'))
})

test('two backups in the same second do not collide by content', () => {
  const home = sandbox()
  const location = resolvePatchFile(home, 'web')
  fs.writeFileSync(location.file, 'a\n')
  const first = backupPatch(location, 'a\n', new Date('2026-11-18T08:30:00Z'))
  fs.writeFileSync(location.file, 'b\n')
  const second = backupPatch(location, 'b\n', new Date('2026-11-18T08:30:00Z'))
  assert.equal(first.file, second.file, 'the name is the stamp, and the later write wins')
  assert.equal(fs.readFileSync(second.file, 'utf8'), 'b\n')
})

test('a write replaces the file and leaves no temporary behind', () => {
  const home = sandbox()
  const location = resolvePatchFile(home, 'web')
  fs.writeFileSync(location.file, 'old\n')
  writePatch(location, 'new\n')
  assert.equal(fs.readFileSync(location.file, 'utf8'), 'new\n')
  const leftovers = fs.readdirSync(path.dirname(location.file)).filter(name => name.includes('.tmp-'))
  assert.deepEqual(leftovers, [])
})

test('backups carry this plugin\'s marker and keep only the newest five', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bak-'))
  fs.mkdirSync(path.join(root, 'profiles', 'web'), { recursive: true })
  const location = resolvePatchFile(root, 'web')
  fs.writeFileSync(location.file, 'x: 1\n')
  // A backup from another writer must survive the pruning.
  const foreign = `${location.file}.bak-2020-01-01_00-00-00`
  fs.writeFileSync(foreign, 'someone else\n')

  for (let i = 0; i < 8; i += 1) {
    backupPatch(location, `round ${i}\n`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)))
  }

  const names = fs.readdirSync(path.dirname(location.file))
  const mine = names.filter(name => name.includes(BACKUP_MARKER))
  assert.equal(mine.length, BACKUP_KEEP, 'only five of our backups remain')
  assert.ok(names.includes(path.basename(foreign)), 'another writer\'s backup is untouched')
  // The survivors are the newest rounds (3..7).
  const stamps = mine.map(name => name.slice(name.indexOf(BACKUP_MARKER) + BACKUP_MARKER.length)).sort()
  assert.deepEqual(stamps[0].slice(-2), '03', 'the oldest three were pruned')
  assert.deepEqual(stamps.at(-1)!.slice(-2), '07')
})
