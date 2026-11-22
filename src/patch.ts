/**
 * Read and rewrite the `llm-pi-ai` provider models inside a dsh profile patch,
 * touching only the fields this plugin owns.
 *
 * ## Why the file, and not `modelOverrides`
 *
 * pi-ai refuses an override beside a models list outright:
 * `sets modelOverrides for "<id>" beside a models list; models already
 * replaces the served catalog, so declare the fields on its entries`. Every
 * route a user added through the web form carries a models list, so its
 * entries are the only writable home for `input` / `reasoningEfforts`.
 *
 * ## Why comment-preserving
 *
 * The profile patch is a hand-written file: it carries the loader's own header
 * comments and whatever a user annotated. A round trip through a plain
 * `parse` → `stringify` would drop all of it. The `yaml` package's Document
 * API edits the node tree in place, so an edit that changes three lines writes
 * exactly three lines.
 *
 * @module src/patch
 */

import { parseDocument, type Document, type YAMLMap } from 'yaml'

/** The loader patch entry that carries pi-ai's provider profiles. */
export const PI_AI_ENTRY_ID = 'llm-pi-ai'

/** The fields this plugin may write onto a model entry, and nothing else. */
export const OWNED_FIELDS = ['input', 'reasoningEfforts'] as const

/** One model entry inside a provider's models list. */
export type ModelEntry = YAMLMap

/** Locate the pi-ai entry in a parsed patch document. */
function piAiEntry(doc: Document): YAMLMap | undefined {
  const root = doc.contents
  if (root === null || root.constructor.name !== 'YAMLSeq') return undefined
  const items = (root as unknown as { items: unknown[] }).items
  for (const item of items) {
    if (item?.constructor?.name !== 'YAMLMap') continue
    const map = item as YAMLMap
    if (map.get('id') === PI_AI_ENTRY_ID) return map
  }
  return undefined
}

/**
 * The provider profiles declared under `llm-pi-ai`.
 *
 * @returns provider id → its profile map, in file order; empty when the patch
 *   carries no pi-ai entry (a profile that never added a provider).
 */
export function readProviders(doc: Document): Map<string, YAMLMap> {
  const out = new Map<string, YAMLMap>()
  const entry = piAiEntry(doc)
  if (entry === undefined) return out
  const config = entry.get('config')
  if (config?.constructor?.name !== 'YAMLMap') return out
  const providers = (config as YAMLMap).get('providers')
  if (providers?.constructor?.name !== 'YAMLMap') return out
  for (const item of (providers as YAMLMap).items as Array<{ key?: { value?: unknown }, value?: unknown }>) {
    const key = item.key?.value
    if (typeof key !== 'string' || (item.value as { constructor?: { name?: string } })?.constructor?.name !== 'YAMLMap') continue
    out.set(key, item.value as YAMLMap)
  }
  return out
}

/** The models a provider's profile keeps, as `id → entry`. */
export function readModels(profile: YAMLMap): Map<string, ModelEntry> {
  const out = new Map<string, ModelEntry>()
  const models = profile.get('models')
  if (models?.constructor?.name !== 'YAMLSeq') return out
  for (const item of (models as unknown as { items: unknown[] }).items) {
    if (item?.constructor?.name !== 'YAMLMap') continue
    const map = item as ModelEntry
    const id = map.get('id')
    if (typeof id === 'string' && id.length > 0) out.set(id, map)
  }
  return out
}

/** What one model entry currently declares, in this plugin's terms. */
export interface CurrentModel {
  input?: string[]
  reasoningEfforts?: readonly string[]
}

/**
 * Read one field's value as plain JavaScript.
 *
 * `YAMLMap.get` answers with the node, not the data: a sequence arrives as a
 * `YAMLSeq` whose `Array.isArray` is false. `toJSON` is what turns a node back
 * into the value it represents, and it is the only reading that works for both
 * a value this plugin wrote and one a user typed by hand.
 */
function plainList(map: ModelEntry | undefined, key: string): string[] | undefined {
  if (map === undefined) return undefined
  const node = map.get(key)
  if (node === undefined || node === null) return undefined
  const value = typeof (node as { toJSON?: unknown }).toJSON === 'function'
    ? (node as { toJSON: () => unknown }).toJSON()
    : node
  if (!Array.isArray(value)) return undefined
  return value.filter((row: unknown): row is string => typeof row === 'string')
}

/** Read the fields this plugin owns off one entry. */
/** Read pi-ai's effort dict (`{ level: wire }`) as the level list it offers. */
function plainEffortLevels(entry: ModelEntry | undefined): string[] | undefined {
  const node = entry?.get('reasoningEfforts')
  if (node === undefined || node === null) return undefined
  const value = typeof (node as { toJSON?: unknown }).toJSON === 'function'
    ? (node as { toJSON: () => unknown }).toJSON()
    : node
  // The dict form is what pi-ai accepts; a bare list is what this plugin
  // mistakenly wrote before the schema discovery, so both shapes read back —
  // a stored list is repaired on the next write.
  if (Array.isArray(value)) return value.filter((row): row is string => typeof row === 'string')
  if (typeof value === 'object' && value !== null) return Object.keys(value as Record<string, unknown>)
  return undefined
}

export function currentFields(entry: ModelEntry | undefined): CurrentModel {
  const input = plainList(entry, 'input')
  const efforts = plainEffortLevels(entry)
  return {
    ...input === undefined ? {} : { input },
    ...efforts === undefined ? {} : { reasoningEfforts: efforts },
  }
}

/**
 * One field the plugin would add to one entry.
 *
 * A plan is a proposal, never an edit: the caller shows it, and only an
 * explicit apply turns it into bytes.
 */
export interface FieldPatch {
  provider: string
  model: string
  field: typeof OWNED_FIELDS[number]
  /** The value to write. */
  value: string[]
  /** What the entry declares now, when it declares anything. */
  current?: string[]
  /**
   * Adopt this model into the profile before writing.
   *
   * Set only for a row the endpoint serves that the profile does not list:
   * the checkbox the user ticked is an explicit add, distinct from a
   * capability fix on a model already kept. An adopted entry carries the
   * endpoint's declared fields and nothing else — name, window and ceiling
   * stay unset so discovery keeps answering them from the endpoint, and the
   * user fills those in the model editor where a value belongs.
   */
  adopt?: boolean
  /**
   * Remove this model's entry from the profile's list.
   *
   * Set only for a profile row whose probe failed and which the user ticked:
   * a failed verdict plus an explicit tick is the user saying "this route
   * cannot serve this model, drop it". A remove patch carries no field and
   * no value; applyPatches deletes the whole entry, and the backup taken
   * before the write is what undoes it.
   */
  remove?: boolean
}

/** Which fields the caller wants filled in. */
/** Which fields the caller wants filled in. */
export interface PatchScope {
  input: boolean
  reasoningEfforts: boolean
  /**
   * Liveness pruning, with its own knobs. `prune.enabled === false` (or an
   * absent field, from an older client) keeps the scan capability-only.
   */
  prune?: {
    /** Hard per-model bound, milliseconds. */
    modelTimeoutMs?: number
    /** Requests in flight at once. */
    concurrency?: number
    /** Whole-probe budget, milliseconds. */
    budgetMs?: number
    /**
     * The probe prompt. Its honest answer should be short and distinctive —
     * the reply is checked for the induced word, which is what proves the
     * prompt reached a real model.
     */
    prompt?: string
  }
}

/**
 * Compare what a provider's endpoint says against what its entries declare.
 *
 * ## Only the models the user kept
 *
 * The endpoint is the authority on *capabilities*, never on *membership*: a
 * user who deleted a model from their list does not want it back. So the
 * comparison walks the **config's** entries and looks each one up in the
 * endpoint's answer — never the other way round.
 *
 * ## Only the fields that are missing
 *
 * An entry that already declares a field keeps it. The endpoint may disagree
 * (a gateway renames freely, and a user may have written a deliberate
 * correction), and silently overwriting a hand-written value is exactly the
 * "adopts thirty ids with no modality" mistake in reverse.
 *
 * @param providers - one provider's endpoints and config, already resolved.
 * @param scope - which fields the user asked to fill.
 * @returns the patches to apply, in provider then config order.
 */
export function planPatches(
  providers: ReadonlyArray<{
    id: string
    models: Map<string, ModelEntry>
    endpoint: ReadonlyMap<string, { input?: string[], reasoningEfforts?: string[] }>
  }>,
  scope: PatchScope,
): FieldPatch[] {
  const out: FieldPatch[] = []
  for (const provider of providers) {
    for (const [model, entry] of provider.models) {
      const said = provider.endpoint.get(model)
      if (said === undefined) continue
      const current = currentFields(entry)
      if (scope.input && said.input !== undefined) {
        const decl = current.input
        const same = decl !== undefined && decl.length === said.input.length && decl.every(v => said.input!.includes(v))
        if (!same) out.push({ provider: provider.id, model, field: 'input', value: said.input, ...decl === undefined ? {} : { current: decl } })
      }
      if (scope.reasoningEfforts && said.reasoningEfforts !== undefined) {
        const decl = current.reasoningEfforts
        const same = decl !== undefined && decl.length === said.reasoningEfforts.length && decl.every(v => said.reasoningEfforts!.includes(v))
        if (!same) out.push({ provider: provider.id, model, field: 'reasoningEfforts', value: said.reasoningEfforts, ...decl === undefined ? {} : { current: [...decl] } })
      }
    }
  }
  return out
}

/**
 * Apply patches to a parsed document in place.
 *
 * An entry the plan names but the document no longer holds is skipped: the
 * plan and the document can drift between the preview and the apply, and a
 * stale plan must not resurrect or invent a model.
 *
 * @param doc - the parsed patch document.
 * @param patches - the plan to apply.
 * @returns how many fields were actually written.
 */
/** pi-ai's `reasoningEfforts` is `{ level: wireSpelling }`, not a list: the key
 * is the selector level, the value what dispatch sends. A level maps to itself
 * unless a gateway needs a rename, which this plugin never invents. */
const EFFORT_WIRE = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/** Shape a level list into pi-ai's dict form, level -> itself. */
function effortsNode(value: readonly string[]): Record<string, string> {
  return Object.fromEntries(value.filter(level => EFFORT_WIRE.has(level)).map(level => [level, level]))
}

export function applyPatches(doc: Document, patches: readonly FieldPatch[]): number {
  const providers = readProviders(doc)
  let written = 0
  for (const patch of patches) {
    const profile = providers.get(patch.provider)
    if (profile === undefined) continue
    // A remove patch deletes the entry outright; it names no field.
    if (patch.remove === true) {
      written += removeModel(profile, patch.model) ? 1 : 0
      continue
    }
    const models = readModels(profile)
    let entry = models.get(patch.model)
    if (entry === undefined && patch.adopt === true) {
      entry = adoptModel(doc, profile, patch.model)
    }
    if (entry === undefined) continue
    // `reasoningEfforts` goes down as a dict; writing the raw list would fail
    // pi-ai's schema and the whole entry with it — the bug that made filled
    // models look empty in the running host.
    if (patch.field === 'reasoningEfforts') entry.set(patch.field, effortsNode(patch.value))
    else entry.set(patch.field, [...patch.value])
    written += 1
  }
  return written
}

/**
 * Delete one model entry from a provider's `models` list, in place.
 *
 * The entry must exist (a remove of nothing is skipped, not an error — the
 * plan and the file can drift between preview and apply). The removed node is
 * gone from the sequence; the entry's own content is irrelevant because the
 * backup holds it.
 */
function removeModel(profile: YAMLMap, model: string): boolean {
  const list = profile.get('models')
  if ((list as unknown as { constructor?: { name?: string } })?.constructor?.name !== 'YAMLSeq') return false
  const seq = list as unknown as { items: Array<{ get?: (key: string) => unknown }> }
  const index = seq.items.findIndex(item => typeof item.get === 'function' && item.get('id') === model)
  if (index === -1) return false
  seq.items.splice(index, 1)
  return true
}

/**
 * Add one model entry to a provider's `models` list, in place.
 *
 * The list is a YAML sequence of maps; a new entry is appended with the id and
 * nothing else, then the caller's fields are set onto it. A model the endpoint
 * serves is the authority on its own capabilities — this plugin never invents
 * a name or a window — so the added entry is minimal by design and the model
 * editor fills the rest.
 *
 * @param profile - the provider profile map to extend.
 * @param model - the id to add.
 * @returns the created entry, or `undefined` when the profile has no models
 *   list to extend (a route that spells no models out is discovery-driven and
 *   a plugin must not mint one).
 */
function adoptModel(owner: Document, profile: YAMLMap, model: string): ModelEntry | undefined {
  const list = profile.get('models')
  if ((list as unknown as { constructor?: { name?: string } })?.constructor?.name !== 'YAMLSeq') return undefined
  const seq = list as unknown as { items: unknown[] }
  // The node must come from the document being edited: a node minted by
  // another Document belongs to that tree, and appending it here corrupts the
  // render instead of adding a row.
  const entry = owner.createNode({ id: model }) as ModelEntry
  seq.items.push(entry)
  return entry
}

/** Parse a patch document for editing. */
export function parsePatch(text: string): Document {
  return parseDocument(text)
}

/** Render an edited document back to text. */
export function renderPatch(doc: Document): string {
  return doc.toString()
}
