/**
 * One scan: what each provider's endpoint says versus what its entries keep.
 *
 * This is the orchestration seam — the only place that knows both the file and
 * the network. Everything it calls is a pure function over data, so the whole
 * comparison is testable without a profile, a network, or a clock.
 *
 * @module src/scan
 */

import { normalizeMenu, readEndpointModels, type EndpointModel } from './endpoint.js'
import { currentFields, parsePatch, readModels, readProviders, planPatches, type FieldPatch, type PatchScope } from './patch.js'
import { probeModels } from './probe.js'
import type { Document } from 'yaml'

/** Where a row came from: your config, or only the endpoint's listing. */
export type ModelOrigin = 'config' | 'endpoint'

/** One model as the scan reports it, for the settings page. */
export interface ScannedModel {
  id: string
  /** What the entry declares now. */
  current: { input?: string[], reasoningEfforts?: readonly string[] }
  /** What the endpoint says, when it named this model. */
  endpoint: { input?: string[], reasoningEfforts?: string[] } | null
  /** Whether the endpoint named this model at all. */
  listed: boolean
  /**
   * Whether this model is one the profile keeps (`config`) or one the endpoint
   * serves that the profile does not list (`endpoint`).
   *
   * Both are shown, because seeing the whole listing is how a user spots a
   * model the route could serve but their config never mentioned. Only
   * `config` rows carry patches: writing an `endpoint` row would mean adding
   * the model to the profile, and a model the user removed is removed on
   * purpose — a plugin must not offer to undo that from a checkbox next to a
   * capability fix.
   */
  origin: ModelOrigin
  /**
   * When the scan ran a liveness probe (scope.prune), what the route answered:
   * `verdict` `ok` keeps the model, anything else is a removal candidate with
   * the reason shown beside the row. Absent when no probe ran. The reason is
   * a stable key the page translates; `detail` carries raw technical text.
   */
  prune?: { verdict: string, reason: { key: string, detail?: string }, ms?: number }

  /** The patches this model would receive under the given scope. */
  patches: FieldPatch[]
  /** Why a field the endpoint published is not being patched, when it is not. */
  withheld: Array<{ key: string, detail?: string }>
}

/** One provider's slice of a scan. */
export interface ScannedProvider {
  id: string
  baseURL?: string
  /** The models this provider keeps, in file order. */
  models: ScannedModel[]
  /** What went wrong reaching this endpoint, when something did. */
  error?: string
}

/** A whole scan, ready to render. */
export interface ScanResult {
  providers: ScannedProvider[]
  /** Models the endpoint serves that no route in scope keeps. */
  unlistedCount: number
}

/**
 * Resolve the API key one route's profile names, if it names one.
 *
 * The profile carries `apiKeyEnv`, a credential *reference*; the value lives
 * in the host's credential store, which only the host half can read. Returning
 * `undefined` is normal and correct for a keyless gateway.
 */
export type CredentialResolver = (profile: unknown) => Promise<string | undefined> | string | undefined

/** What one route needs to list its models. */
export interface ListingRequest {
  url: string
  /** `x-api-key` for the Anthropic shape, `Authorization: Bearer` otherwise. */
  headers: Record<string, string>
}

/**
 * Fetches one listing body; injected so tests need no network.
 *
 * A route that needs a credential cannot be scanned without one, and a plugin
 * that only ever scanned keyless gateways would cover exactly one vendor. The
 * caller resolves the credential because this module must not know where
 * secrets live.
 */
export type ListingFetcher = (request: ListingRequest, signal?: AbortSignal) => Promise<unknown>

/**
 * The listing path for one protocol.
 *
 * OpenAI-shaped routes list at `{baseURL}/models`. An Anthropic Messages route
 * lists at `{root}/v1/models`, where the root is the base without a trailing
 * `/v1` segment — pi-ai normalises that segment, so a gateway documented both
 * ways still answers.
 *
 * @param baseURL - the profile's base URL.
 * @param api - the profile's protocol.
 */
export function listingUrl(baseURL: string, api?: string): string {
  const base = baseURL.replace(/\/+$/, '')
  if (api === 'anthropic-messages') {
    const root = base.endsWith('/v1') ? base.slice(0, -3) : base
    return `${root}/v1/models`
  }
  return base.endsWith('/models') ? base : `${base}/models`
}

/**
 * The headers one route's listing needs.
 *
 * An Anthropic-shaped route authenticates with `x-api-key` and a version
 * header; every other protocol pi-ai speaks takes a bearer token. An absent
 * key sends none, which is correct for a keyless gateway (Ollama, LM Studio)
 * and produces the route's own 401 for one that needs it — reported per
 * provider, never as a plugin failure.
 */
export function listingHeaders(api: string | undefined, apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (apiKey === undefined || apiKey.length === 0) return headers
  if (api === 'anthropic-messages') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.authorization = `Bearer ${apiKey}`
  }
  return headers
}

/**
 * Read the effort menu only when it is in pi-ai's own vocabulary.
 *
 * A gateway that publishes `light|high|extra_high` is describing its levels,
 * not pi-ai's; writing those would make the entry invalid. The scan reports
 * that menu so the user can see the endpoint does publish one, but withholds
 * it from the plan and says why.
 */
function effortsForPatch(model: EndpointModel): { value?: string[], withheld?: { key: string, detail?: string } } {
  if (model.reasoningEfforts === undefined) return {}
  // Known gateway menus translate (aliases like `disabled`, and whole ladders
  // like light|balanced|deep mapped by rank); a menu that survives
  // normalization untouched is genuinely foreign and withheld.
  const normalized = normalizeMenu(model.reasoningEfforts)
  if (normalized === undefined) {
    return { withheld: { key: 'withheld-vocabulary', detail: model.reasoningEfforts.join('|') } }
  }
  // Dedupe while keeping the endpoint's order: an alias may collapse onto a
  // level the menu also names directly.
  return { value: [...new Set(normalized)] }
}

/**
 * Scan one patch document against a set of endpoints.
 *
 * @param doc - the parsed patch.
 * @param scope - which fields the user asked to fill.
 * @param fetchListing - injected network seam.
 * @param signal - cancellation for the whole scan.
 */
export async function scanDocument(
  doc: Document,
  scope: PatchScope,
  fetchListing: ListingFetcher,
  resolveCredential?: CredentialResolver,
  signal?: AbortSignal,
  only?: readonly string[],
): Promise<ScanResult> {
  const all = readProviders(doc)
  // The page scopes a scan to one route: a profile can hold ten gateways, and
  // reading all of them to patch one wastes a round trip to each and reports
  // errors for routes the user never asked about.
  const profiles = only === undefined || only.length === 0
    ? all
    : new Map([...all].filter(([id]) => only.includes(id)))
  const providers: ScannedProvider[] = []
  let unlistedCount = 0
  for (const [id, profile] of profiles) {
    const models = readModels(profile)
    const baseURL = typeof profile.get('baseURL') === 'string' ? profile.get('baseURL') as string : undefined
    const api = typeof profile.get('api') === 'string' ? profile.get('api') as string : undefined
    if (baseURL === undefined) {
      providers.push({ id, models: [...models.keys()].map(model => ({
        id: model, current: currentFields(models.get(model)!), endpoint: null, listed: false, origin: 'config' as const, patches: [], withheld: [],
      })), error: 'the profile declares no baseURL', ...{} })
      continue
    }
    let endpointModels: EndpointModel[]
    let apiKey: string | undefined
    try {
      apiKey = await resolveCredential?.(profile)
      endpointModels = readEndpointModels(await fetchListing({
        url: listingUrl(baseURL, api),
        headers: listingHeaders(api, apiKey),
      }, signal))
    } catch (error) {
      providers.push({ id, baseURL, error: error instanceof Error ? error.message : String(error),
        models: [...models.keys()].map(model => ({
          id: model, current: currentFields(models.get(model)!), endpoint: null, listed: false, origin: 'config' as const, patches: [], withheld: [],
        })), ...{} })
      continue
    }
    const byId = new Map(endpointModels.map(model => [model.id, model]))
    // Only the ids this profile keeps take a patch; ones the endpoint serves
    // but the user dropped stay dropped.
    unlistedCount += endpointModels.filter(model => !models.has(model.id)).length
    const patchable = new Map<string, { input?: string[], reasoningEfforts?: string[] }>()
    const withheld = new Map<string, { key: string, detail?: string }>()
    const scanned: ScannedModel[] = []
    for (const model of endpointModels) {
      if (!models.has(model.id)) continue
      const efforts = effortsForPatch(model)
      if (efforts.withheld !== undefined) withheld.set(model.id, efforts.withheld)
      patchable.set(model.id, {
        ...model.input === undefined ? {} : { input: model.input },
        ...efforts.value === undefined ? {} : { reasoningEfforts: efforts.value },
      })
    }
    // The liveness probe runs only when the page asked for it. Every model the
    // route serves — kept or not — is swept in the shape DSH actually sends, so
    // a prune verdict means "picking this model fails a turn", not "the
    // listing entry is stale".
    let pruneResults: Map<string, { verdict: string, reason: { key: string, detail?: string }, ms?: number }> | undefined
    if (scope.prune !== undefined) {
      // The sweep covers every model the profile lists (config order) plus
      // every id the endpoint advertises — a config entry the listing omits is
      // still a route the user can pick in DSH, so it is probed too.
      const sweep = [...new Set([...models.keys(), ...endpointModels.map(model => model.id)])]
      const answers = await probeModels([...new Set(sweep)], {
        baseURL,
        ...(apiKey === undefined ? {} : { apiKey }),
        modelTimeoutMs: scope.prune.modelTimeoutMs ?? 30_000,
        concurrency: scope.prune.concurrency ?? 4,
        budgetMs: scope.prune.budgetMs ?? 600_000,
        ...(scope.prune.prompt === undefined ? {} : { prompt: scope.prune.prompt }),
        outputCap: 512,
        ...(signal === undefined ? {} : { signal }),
      })
      pruneResults = new Map(
        [...answers].map(([id, row]) => [id, { verdict: row.verdict, reason: row.reason, ms: row.ms }]),
      )
    }

    const patches = planPatches([{ id, models, endpoint: patchable }], scope)
    const byModel = new Map<string, FieldPatch[]>()
    for (const patch of patches) {
      const list = byModel.get(patch.model) ?? []
      list.push(patch)
      byModel.set(patch.model, list)
    }
    // Profile entries the endpoint no longer serves come FIRST: they have no
    // place in the listing, and they are the rows a user most needs to see —
    // a model that vanished upstream is still selectable in DSH and will fail
    // a turn there. They carry the "gone upstream" tag and stay ticked (kept)
    // unless the probe says otherwise; unticking one removes it.
    const served = new Set(endpointModels.map(model => model.id))
    for (const [model, entry] of models) {
      if (served.has(model)) continue
      const prune = pruneResults?.get(model)
      scanned.push({
        id: model,
        current: currentFields(entry),
        endpoint: null,
        listed: false,
        origin: 'config',
        patches: byModel.get(model) ?? [],
        withheld: withheld.has(model) ? [withheld.get(model)!] : [],
        ...(prune === undefined ? {} : { prune: { verdict: prune.verdict, reason: prune.reason, ms: prune.ms } }),
      })
    }
    // Everything the endpoint serves follows its own order, untouched.
    // Whether the profile keeps a model changes nothing about its row or its
    // position — it is the same row as any other, and the only difference the
    // page applies is the default tick. The rows that went before these are
    // the ones the endpoint no longer serves at all.
    for (const said of endpointModels) {
      const kept = models.get(said.id)
      const prune = pruneResults?.get(said.id)
      if (kept !== undefined) {
        scanned.push({
          id: said.id,
          current: currentFields(kept),
          endpoint: {
            ...said.input === undefined ? {} : { input: said.input },
            ...said.reasoningEfforts === undefined ? {} : { reasoningEfforts: said.reasoningEfforts },
          },
          listed: true,
          origin: 'config',
          patches: byModel.get(said.id) ?? [],
          withheld: withheld.has(said.id) ? [withheld.get(said.id)!] : [],
          ...(prune === undefined ? {} : { prune: { verdict: prune.verdict, reason: prune.reason, ms: prune.ms } }),
        })
        continue
      }
      const efforts = effortsForPatch(said)
      const patchable: { input?: string[], reasoningEfforts?: string[] } = {
        ...said.input === undefined ? {} : { input: said.input },
        ...efforts.value === undefined ? {} : { reasoningEfforts: efforts.value },
      }
      // The plan walks the profile's entries, so an off-list model needs a
      // null stand-in: `currentFields` of nothing reads as "declares nothing",
      // which is exactly true here.
      const patches = planPatches([{ id, models: new Map([[said.id, undefined as never]]), endpoint: new Map([[said.id, patchable]]) }], scope)
      scanned.push({
        id: said.id,
        current: {},
        endpoint: {
          ...said.input === undefined ? {} : { input: said.input },
          ...said.reasoningEfforts === undefined ? {} : { reasoningEfforts: said.reasoningEfforts },
        },
        listed: true,
        origin: 'endpoint',
        patches: patches.map(patch => ({ ...patch, adopt: true })),
        withheld: efforts.withheld === undefined ? [] : [efforts.withheld],
        ...(prune === undefined ? {} : { prune: { verdict: prune.verdict, reason: prune.reason, ms: prune.ms } }),
      })
    }
    providers.push({ id, baseURL, models: scanned })
  }
  return { providers, unlistedCount }
}

/** Re-export so a caller can parse once and scan the same document. */
export { parsePatch }
