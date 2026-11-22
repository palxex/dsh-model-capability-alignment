/**
 * Wrap the compiled client half in the loader shell.
 *
 * The host hands a client bundle one `require` whose seed list is fixed
 * (`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
 * `@deepseek-ai/cordis`, and the two UI packages). Everything else must be
 * inlined, which is why this step concatenates rather than resolves.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(fileURLToPath(new URL('..', import.meta.url)))
const compiledPath = path.join(root, 'lib/client-raw/index.js')
// `tsc --noEmit` writes nothing and exits clean, so a stale intermediate is
// indistinguishable from a fresh one by looking at the file alone. Compare
// mtimes against the sources: wrapping an out-of-date bundle ships code that
// no type check ever saw, and the page then quietly disagrees with src/.
const sources = fs.readdirSync(path.join(root, 'src/client'), { recursive: true })
  .filter(name => /\.(ts|tsx)$/.test(String(name)))
  .map(name => fs.statSync(path.join(root, 'src/client', String(name))).mtimeMs)
let compiledMtime = 0
try { compiledMtime = fs.statSync(compiledPath).mtimeMs } catch { /* reported below */ }
if (compiledMtime === 0) {
  console.error('lib/client-raw/index.js is missing; run `tsc -p tsconfig.client.json` first')
  process.exit(1)
}
if (sources.some(mtime => mtime > compiledMtime)) {
  console.error('lib/client-raw/index.js is older than src/client; run `tsc -p tsconfig.client.json` first')
  process.exit(1)
}
const compiled = fs.readFileSync(compiledPath, 'utf8')
// tsc emits plain ESM with the seed packages as imports; the shell supplies
// them, so each import becomes a destructuring require.
const body = compiled
  // Every import the shell supplies becomes a destructured require; a bare
  // `import x from 'react'` would be a syntax error inside the factory body.
  .replace(/^import react from 'react';?$/m, 'const react = require("react")')
  .replace(/^import react, \{[^}]*\} from 'react';?$/m, 'const react = require("react")')
  .replace(/^import \{[^}]*\} from 'react';?$/m, 'const react = require("react")')
  .replace(/^import type \{[^}]*\} from '[^']*';?$/gm, '')
  .replace(/^import [^;]* from '[^']*';?$/gm, '')
  .replace(/^export const inject = /m, 'const inject = ')
  .replace(/^export function SettingsPage/m, 'function SettingsPage')
  .replace(/^export function apply/m, 'function apply')
// The manifest version baked into the bundle body: the page shows it
// immediately, without waiting for a host round trip. The host's `version`
// Remote is the authority once it answers, so a rebuilt copy keeps both in
// step without a restart.
const manifestVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? 'unknown'
const withVersion = body.replace('0.0.0-build-placeholder', manifestVersion)
if (withVersion === body) console.warn('version placeholder not found in the client bundle')

const out = `window.__ModuleLoader__.load({
  id: "dsh-model-capability-alignment",
  factory: (require) => {
${withVersion.split('\n').map(line => line.length === 0 ? '' : `    ${line}`).join('\n')}
    return { inject, apply, SettingsPage }
  },
})
`
fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
fs.writeFileSync(path.join(root, 'lib/client.js'), out)
console.log('lib/client.js:', out.length, 'bytes')
