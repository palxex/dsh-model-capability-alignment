/**
 * Read what a provider's listing endpoint says about each model's input
 * modalities and reasoning efforts.
 *
 * pi-ai's discovery (`readListing`) deliberately reads only id / name /
 * contextWindow / maxTokens: it cannot interrogate a gateway for modalities,
 * and an optimistic default would poison a session. So the fields exist in the
 * config schema and are honoured at runtime, but nothing fills them in.
 *
 * This module is the missing reader. It is written against the shapes a
 * gateway actually publishes rather than one vendor's spelling, because the
 * whole point is to bridge a listing an adapter chose not to parse.
 *
 * @module src/endpoint
 */

/** One model as the endpoint describes it, in the terms the patch writes. */
export interface EndpointModel {
  id: string
  /** `["text"]` / `["text","image"]`, when the endpoint said anything. */
  input?: string[]
  /** The model's own level menu, when the endpoint published one. */
  reasoningEfforts?: string[]
}

/** A gateway listing entry: every field is whatever that gateway chose to send. */
type Row = Record<string, unknown>

const isObject = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Normalise a modality list against the two values pi-ai's schema accepts.
 *
 * The order `text, image` is the one the schema documents; a gateway that says
 * `["image","text"]` still describes a model that takes both, so the returned
 * list is canonical rather than a copy of the input order.
 *
 * @returns the recognised modalities, or `undefined` when nothing usable was
 *   declared (an absent field and an empty one both mean "said nothing").
 */
export function normaliseModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const listed = value.filter((row): row is string => typeof row === 'string')
  const out: string[] = []
  if (listed.includes('text')) out.push('text')
  if (listed.includes('image')) out.push('image')
  return out.length === 0 ? undefined : out
}

/**
 * Read the modality list from whichever shape an entry uses.
 *
 * `input` is this plugin's own output spelling and what pi-ai's config schema
 * takes; `input_modalities` is DeepSeek's listing spelling; `modalities.input`
 * is the models.dev / OpenRouter shape. A gateway may also nest the whole thing
 * under `architecture`. All of them mean the same thing.
 */
function modalitiesOf(row: Row): string[] | undefined {
  for (const candidate of [
    row.input,
    row.input_modalities,
    isObject(row.modalities) ? row.modalities.input : undefined,
    isObject(row.architecture) ? row.architecture.input_modalities : undefined,
  ]) {
    const found = normaliseModalities(candidate)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Read the effort menu from whichever shape an entry uses.
 *
 * Only the *level names* are carried across. A gateway rarely uses pi-ai's own
 * `low|medium|high|…` vocabulary — TRAE says `light|high|extra_high`, Qoder
 * says `none|low|medium|xhigh` — so the names are kept verbatim and the caller
 * decides whether they are safe to write (see {@link sameVocabulary}).
 */
function effortsOf(row: Row): string[] | undefined {
  // Generic spellings first, so the reader works for any gateway that follows
  // one of the shapes pi-ai's own ecosystem uses.
  for (const candidate of [row.reasoning_efforts, row.reasoningEfforts, row.efforts]) {
    if (Array.isArray(candidate) && candidate.length > 0 && candidate.every(v => typeof v === 'string')) {
      return [...candidate as string[]]
    }
  }
  // Then any field whose name says "effort" and whose value is a string list.
  // A vendor that namespaces its field (`x_<vendor>_efforts`) still gets read,
  // and inventing a list of vendor names to try is what would make this plugin
  // work for one publisher and silently miss the next.
  for (const [key, value] of Object.entries(row)) {
    if (!/efforts?$/i.test(key)) continue
    if (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string')) {
      return [...value as string[]]
    }
  }
  const options = row.reasoning_options
  if (Array.isArray(options)) {
    const names: string[] = []
    for (const option of options) {
      if (!isObject(option)) continue
      if (Array.isArray(option.values)) {
        for (const value of option.values) if (typeof value === 'string') names.push(value)
      }
    }
    if (names.length > 0) return names
  }
  return undefined
}

/**
 * Turn one listing body into endpoint models, keyed by id.
 *
 * Accepts the two shapes pi-ai's own reader accepts — a `data` array and an
 * enriched `models` map keyed by the endpoint-facing id — because a gateway
 * this plugin is pointed at may serve either.
 *
 * @param body - the parsed JSON listing.
 * @returns one row per distinct id, in listing order; a malformed row is
 *   skipped rather than failing the whole read.
 */
export function readEndpointModels(body: unknown): EndpointModel[] {
  if (!isObject(body)) return []
  const rows: Array<{ key?: string, raw: Row }> = []
  if (Array.isArray(body.data)) {
    for (const raw of body.data) if (isObject(raw)) rows.push({ raw })
  } else if (isObject(body.models)) {
    for (const [key, raw] of Object.entries(body.models)) if (isObject(raw)) rows.push({ key, raw })
  }
  const seen = new Set<string>()
  const out: EndpointModel[] = []
  for (const { key, raw } of rows) {
    // pi-ai's reading order: a `models` map's key is the id the endpoint
    // answers to, and its nested `id` is only a fallback for an empty key —
    // a gateway may put a canonical identity there instead of the alias it
    // accepts on requests. A `data` row has no key, so its own id is used.
    const id = key !== undefined && key.length > 0
      ? key
      : typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : undefined
    if (id === undefined || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    const input = modalitiesOf(raw)
    const reasoningEfforts = effortsOf(raw)
    out.push({
      id,
      ...input === undefined ? {} : { input },
      ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
    })
  }
  return out
}

/**
 * The effort names pi-ai's own schema accepts.
 *
 * A gateway that publishes a different vocabulary (`light`, `extra_high`) is
 * describing *its* levels, not pi-ai's; writing those into `reasoningEfforts`
 * would make the entry invalid, so such a menu is reported but not patched.
 */
export const PI_AI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * Gateway spellings that mean one of pi-ai's levels, mapped to it.
 *
 * Routes do not all speak pi-ai's vocabulary: a menu that says `disabled`
 * is offering "thinking off" under another name. Writing such a name into
 * `reasoningEfforts` would fail the schema and drop the whole entry, but
 * refusing the whole menu wastes real information — `disabled|high` is
 * exactly pi-ai's `off|high`. Known aliases translate; anything genuinely
 * foreign is still reported, not guessed.
 */
const LEVEL_ALIASES: Record<string, (typeof PI_AI_THINKING_LEVELS)[number]> = {
  // "thinking off" under other names — pi-ai's own off-level spellings.
  disabled: 'off',
  none: 'off',
  'off-none': 'off',
  minimal: 'minimal',
  nano: 'minimal',
  brief: 'low',
  standard: 'medium',
  deep: 'high',
  ultra: 'xhigh',
  mega: 'max',
}

/**
 * A gateway that owns its effort ladder publishes that ladder's names as the
 * menu (`light|balanced|deep` on the OFM free lane, each rung a token budget),
 * and translates whatever pi-ai sends onto it — every pi-ai level resolves.
 * Writing the ladder's own names into `reasoningEfforts` would fail pi-ai's
 * schema, so the menu maps onto the levels of the same rank instead: the
 * lightest rung to `minimal`, the middle to `medium`, the unbounded top to
 * `max`. The entry then offers three real rungs in pi-ai's vocabulary, and
 * dispatch sends pi-ai levels that the gateway maps right back.
 */
const LADDER_MAPS: Record<string, Record<string, (typeof PI_AI_THINKING_LEVELS)[number]>> = {
  'light|balanced|deep': { light: 'minimal', balanced: 'medium', deep: 'max' },
}

/**
 * Is this menu written in pi-ai's own level vocabulary?
 *
 * @param efforts - the endpoint's level names.
 * @returns true when every name is one pi-ai's schema accepts.
 */
/**
 * Translate one endpoint menu into pi-ai's vocabulary.
 *
 * First a whole-menu map (a ladder publishes its rungs together, and rank is
 * only meaningful in context), then single-name aliases, then the name itself
 * when it is already pi-ai's. `undefined` means genuinely unknown.
 */
export function normalizeMenu(efforts: readonly string[]): (typeof PI_AI_THINKING_LEVELS)[number][] | undefined {
  const menu = efforts.join('|')
  const ladder = LADDER_MAPS[menu.toLowerCase()]
  if (ladder !== undefined) return efforts.map(name => ladder[name.toLowerCase()])
  const direct = efforts.map(name => {
    const own = (PI_AI_THINKING_LEVELS as readonly string[]).includes(name)
      ? name as (typeof PI_AI_THINKING_LEVELS)[number]
      : undefined
    return own ?? LEVEL_ALIASES[name.toLowerCase()]
  })
  return direct.every(level => level !== undefined) ? direct : undefined
}

export function sameVocabulary(efforts: readonly string[]): boolean {
  return efforts.every(name => (PI_AI_THINKING_LEVELS as readonly string[]).includes(name))
}
