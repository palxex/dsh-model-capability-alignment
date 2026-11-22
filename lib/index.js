/**
 * Host half: expose the scan / apply pair to the settings page.
 *
 * The plugin owns no provider and serves no model. It is a maintenance surface
 * for one gap in pi-ai's discovery: `readListing` publishes id, name and the
 * two capacities, and nothing else — so `input` and `reasoningEfforts` exist in
 * the config schema, are honoured at runtime, and are never written by anybody.
 * An OpenAI-compatible route is therefore announced text-only no matter what it
 * serves.
 *
 * @module src/index
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { parsePatch, readProviders, readModels } from './patch.js';
import { resolvePatchFile, readPatch } from './store.js';
import { scanDocument } from './scan.js';
import { applyPatchesToProfile } from './apply.js';
export const name = 'pi-ai-modality-patcher';
/**
 * The services the host plugin entry needs.
 *
 * Mirrored on the service class below: a class handed to `ctx.plugin` is
 * resolved against ITS static `inject`, not this module's.
 */
export const inject = ['credentials'];
/**
 * Default listing timeout: a scan touches every configured provider, and a
 * gateway that is simply not running must not hold the page for its own TCP
 * timeout.
 */
const LISTING_TIMEOUT_MS = 15_000;
/** Fetch one listing body with a deadline. */
const fetchListing = async (request, signal) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LISTING_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        const response = await fetch(request.url, { signal: controller.signal, headers: request.headers });
        if (!response.ok)
            throw new Error(`HTTP ${response.status} from ${request.url}${response.status === 401 ? ' (this route needs a credential)' : ''}`);
        return await response.json();
    }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
    }
};
/**
 * The profile this host actually runs.
 *
 * `profileContext` is the authority: the launcher provides it with the name,
 * the profile directory and the exact patch path it composed. The environment
 * is only a fallback — a Desktop launch sets no `DSH_PROFILE` at all, and a
 * hardcoded `'web'` there made every Windows install read the wrong file (the
 * dropdown showed no routes because it was looking at a profile that does not
 * exist on that machine).
 */
function readProfileContext(host) {
    const context = host.get('profileContext');
    if (context === undefined || context === null)
        return undefined;
    const pick = (value) => typeof value === 'string' && value.length > 0 ? value : undefined;
    return {
        name: pick(context.name),
        dir: pick(context.dir),
        patchPath: pick(context.patchPath),
        home: pick(context.home),
    };
}
/**
 * Resolve the patch file to edit from the launcher's context.
 *
 * Pure so the precedence is testable without a live host: the exact composed
 * path wins, then the reported profile directory, then the constructed
 * `home/profiles/<name>` layout. `undefined` from `context` means the host
 * runs without it and the caller's own fallback applies.
 */
export function resolvePatchLocation(context, fallback, exists = existsSync) {
    if (context?.patchPath !== undefined) {
        return { file: context.patchPath, exists: exists(context.patchPath) };
    }
    if (context?.dir !== undefined) {
        const file = join(context.dir, 'cordis.patch.yml');
        return { file, exists: exists(file) };
    }
    return fallback();
}
/** The profile name, preferring the launcher's own context over the environment. */
function activeProfile(host) {
    const named = readProfileContext(host)?.name;
    if (named !== undefined)
        return named;
    const raw = process.env.DSH_PROFILE;
    return typeof raw === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(raw) ? raw : 'web';
}
/** Summarise one provider's declarations for the page's provider picker. */
function summarise(scan) {
    return scan.providers.map(provider => ({
        id: provider.id,
        ...provider.baseURL === undefined ? {} : { baseURL: provider.baseURL },
        modelCount: provider.models.length,
        declaredCount: provider.models.filter(model => model.current.input !== undefined || model.current.reasoningEfforts !== undefined).length,
    }));
}
/** The exact field writes a request names, when it names any. */
function readFieldList(value) {
    if (!Array.isArray(value))
        return undefined;
    const out = [];
    for (const row of value) {
        if (typeof row !== 'object' || row === null)
            continue;
        const item = row;
        if (typeof item.model !== 'string' || item.model.length === 0)
            continue;
        if (item.field !== 'input' && item.field !== 'reasoningEfforts')
            continue;
        if (!Array.isArray(item.value) || !item.value.every(v => typeof v === 'string'))
            continue;
        out.push({
            provider: '',
            model: item.model,
            field: item.field,
            value: item.value,
            ...item.adopt === true ? { adopt: true } : {},
            ...item.remove === true ? { remove: true } : {},
        });
    }
    return out.length === 0 ? undefined : out;
}
/**
 * The row order a request names, per provider route.
 *
 * Shape-checked rather than trusted: the wire is a boundary, and orderly
 * output is only worth having if a malformed order is dropped instead of
 * reordering a file into something nobody asked for. Only ids are taken
 * from it; which entry each names still comes from the document.
 *
 * @param value - the request field, as the gateway decoded it.
 * @returns provider id to model id list, or `undefined` when absent.
 */
function readOrder(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const out = {};
    for (const [route, ids] of Object.entries(value)) {
        if (!Array.isArray(ids))
            continue;
        const clean = ids.filter((id) => typeof id === 'string' && id.length > 0);
        if (clean.length > 0)
            out[route] = clean;
    }
    return Object.keys(out).length === 0 ? undefined : out;
}
/** The route list a request narrows itself to, when it names any. */
function providerList(value) {
    if (!Array.isArray(value))
        return undefined;
    const names = value.filter((row) => typeof row === 'string' && row.length > 0);
    return names.length === 0 ? undefined : names;
}
/**
 * Both halves of a scan request: which fields, and which routes.
 *
 * The body is FLAT — `{ input, reasoningEfforts, providers }` — rather than
 * nesting the scope under its own key. A previous generation of the host read
 * only the flat field pair, and a running host is not restarted to pick up a
 * plugin edit; keeping the shape a superset of what it accepted means an old
 * host still honours the field choice and simply ignores `providers`, instead
 * of refusing the call outright.
 */
function readScanRequest(value) {
    const row = typeof value === 'object' && value !== null ? value : {};
    const scope = readScope(row.scope === undefined ? row : row.scope);
    const providers = providerList(row.providers);
    return { scope, ...providers === undefined ? {} : { providers } };
}
/** Scope from the page, refused unless it names at least one field. */
function readScope(value) {
    const row = typeof value === 'object' && value !== null ? value : {};
    const input = row.input === true;
    const reasoningEfforts = row.reasoningEfforts === true;
    const prune = readPrune(row.prune);
    if (!input && !reasoningEfforts && prune === undefined) {
        throw new Error('select at least one option to run');
    }
    return {
        input,
        reasoningEfforts,
        ...prune === undefined ? {} : { prune },
    };
}
/**
 * The pruning knobs, with the sweep's defaults. A probe-only run (both field
 * boxes unticked, `prune` present) is legal: the caller wants the route swept
 * without writing capability fields.
 */
function readPrune(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const row = value;
    const number = (raw, fallback, floor, ceiling) => {
        const parsed = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
        return Math.min(ceiling, Math.max(floor, Math.round(parsed)));
    };
    return {
        modelTimeoutMs: number(row.modelTimeoutMs, 30_000, 1_000, 600_000),
        concurrency: number(row.concurrency, 4, 1, 16),
        budgetMs: number(row.budgetMs, 600_000, 10_000, 3_600_000),
        ...typeof row.prompt === 'string' && row.prompt.trim().length > 0
            ? { prompt: row.prompt.trim().slice(0, 200) }
            : {},
    };
}
/**
 * The host service behind `ctx.remote.piAiModality`.
 *
 * A `TypertRemoteService` is how a plugin exposes its own operations to the
 * settings page: the gateway turns each `@Remote` method into a call on the
 * wire namespace, so the client needs no channel of its own (a self-made
 * `connection.rpc.handle` channel is retired and answers 405).
 */
let ModalityPatcherService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _version_decorators;
    let _providers_decorators;
    let _scan_decorators;
    let _apply_decorators;
    return class ModalityPatcherService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _version_decorators = [Remote('version')];
            _providers_decorators = [Remote('providers')];
            _scan_decorators = [Remote('scan')];
            _apply_decorators = [Remote('apply')];
            __esDecorate(this, null, _version_decorators, { kind: "method", name: "version", static: false, private: false, access: { has: obj => "version" in obj, get: obj => obj.version }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _providers_decorators, { kind: "method", name: "providers", static: false, private: false, access: { has: obj => "providers" in obj, get: obj => obj.providers }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _scan_decorators, { kind: "method", name: "scan", static: false, private: false, access: { has: obj => "scan" in obj, get: obj => obj.scan }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _apply_decorators, { kind: "method", name: "apply", static: false, private: false, access: { has: obj => "apply" in obj, get: obj => obj.apply }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        /**
         * Dependencies this service waits for before it constructs.
         *
         * `typert` is the gateway binding `TypertRemoteService` needs; `settings` and
         * `credentials` are what its methods read. Declared here rather than only at
         * module scope because cordis resolves a class plugin against its own static
         * `inject`.
         */
        static inject = ['typert', 'credentials'];
        home = __runInitializers(this, _instanceExtraInitializers);
        host;
        constructor(ctx) {
            super(ctx, 'piAiModalityPatcher', { namespace: 'piAiModality' });
            this.host = ctx;
            this.home = process.env.DSH_HOME;
        }
        /**
         * Resolve the credential a route's profile names.
         *
         * A profile stores `apiKeyEnv`, a *reference*; the value lives in the host's
         * credential store. This mirrors what pi-ai's own adapter does — the store
         * first, then the launch environment, and an absent reference means the
         * route is keyless (Ollama, LM Studio, or an OFM-style local gateway).
         *
         * A missing credential is not an error here: the scan reports the route's
         * own 401 against that provider and carries on with the rest, because one
         * unconfigured route must not deny the others their scan.
         */
        async credentialFor(profile) {
            const ref = profile?.get?.('apiKeyEnv');
            if (typeof ref !== 'string' || ref.length === 0)
                return undefined;
            const credentials = this.host.get('credentials');
            if (credentials?.resolve !== undefined) {
                const hit = await credentials.resolve(ref);
                if (typeof hit?.value === 'string' && hit.value.length > 0)
                    return hit.value;
            }
            const fromEnvironment = process.env[ref];
            return typeof fromEnvironment === 'string' && fromEnvironment.length > 0 ? fromEnvironment : undefined;
        }
        /**
         * The profile patch this plugin edits.
         *
         * The launcher hands the exact composed patch path to the host as
         * `profileContext.patchPath`; using it removes every guess about home
         * layout and profile name (Desktop keeps its own profile, and its home
         * differs from the CLI's). The constructed path stays as a fallback for a
         * host that runs without that context.
         */
        locationOf() {
            const context = readProfileContext(this.host);
            // Three tiers, most authoritative first: the exact composed patch path,
            // the profile directory the launcher reported, then the constructed
            // home/profiles/<name> layout.
            const location = resolvePatchLocation(context, () => resolvePatchFile(this.home ?? context?.home, activeProfile(this.host)));
            if (!location.exists) {
                throw new Error(`no profile patch at ${location.file}; this plugin edits an existing one rather than creating it`);
            }
            return location;
        }
        readDocument() {
            const location = this.locationOf();
            return { location, doc: parsePatch(readPatch(location)) };
        }
        /**
         * This plugin's own version, read from its package manifest.
         *
         * Read per call rather than captured at load: the page shows it so a user
         * can tell which build is live, and a development copy that was rebuilt in
         * place keeps answering the new number without a restart (the module stays
         * loaded; only the manifest changes). A missing or unreadable manifest
         * reports `unknown` instead of failing the page.
         */
        version() {
            try {
                const here = dirname(fileURLToPath(import.meta.url));
                const manifest = JSON.parse(readFileSync(joinPath(here, '..', 'package.json'), 'utf8'));
                return { version: typeof manifest.version === 'string' ? manifest.version : 'unknown' };
            }
            catch {
                return { version: 'unknown' };
            }
        }
        /** Every provider in the active profile, with what it keeps. */
        providers() {
            const { doc } = this.readDocument();
            const out = [];
            for (const [id, profileMap] of readProviders(doc)) {
                const models = readModels(profileMap);
                const baseURL = profileMap.get('baseURL');
                out.push({
                    id,
                    ...typeof baseURL === 'string' ? { baseURL } : {},
                    modelCount: models.size,
                    declaredCount: [...models.values()].filter(entry => entry.get('input') !== undefined || entry.get('reasoningEfforts') !== undefined).length,
                });
            }
            return out;
        }
        /**
         * Compare the profile against every configured endpoint, read-only.
         *
         * Safe to run any time: a scan parses and renders nothing.
         */
        /**
         * @param request - which fields to compare. The gateway matches `args`
         *   against declared parameter names, so the client wraps it as `{ request }`.
         */
        async scan(request) {
            const { scope, providers } = readScanRequest(request);
            const { location, doc } = this.readDocument();
            const result = await scanDocument(doc, scope, fetchListing, profile => this.credentialFor(profile), undefined, providers);
            return { file: location.file, ...result, summary: summarise(result) };
        }
        /**
         * Write the selected models' fields, after a backup.
         *
         * @param request - the scope, and optionally the exact models to write.
         */
        /**
         * @param request - the scope plus the optional model selection, wrapped as
         *   `{ request }` for the same parameter-name matching as {@link scan}.
         */
        async apply(request) {
            const row = typeof request === 'object' && request !== null ? request : {};
            const chosen = readScope(row.scope === undefined ? row : row.scope);
            const providers = providerList(row.providers);
            const location = this.locationOf();
            // An explicit field list is the precise contract: each entry names its
            // model, the field, and the value, and carries `adopt` for a model the
            // profile does not list yet. The scan still runs — it is what discovers
            // the route's endpoints and keeps the result for the caller to render —
            // but the write is bounded by the list alone, never by "everything the
            // scan found".
            const fields = readFieldList(row.fields);
            // The page also names the row order it showed, so the file ends up in that
            // same order instead of wherever appends happened to land.
            const order = readOrder(row.orderIds);
            const result = await applyPatchesToProfile(location, chosen, fetchListing, {
                resolveCredential: profile => this.credentialFor(profile),
                ...providers === undefined ? {} : { providers },
                ...fields === undefined ? {} : { fields },
                ...order === undefined ? {} : { order },
            });
            return { patches: result.patches, backup: result.backup.file, written: result.written };
        }
    };
})();
export { ModalityPatcherService };
/** The default export registers the plugin's host half. */
export function apply(ctx) {
    // No settings namespace is registered: the page is a `settings.section`,
    // which pairs with nothing — it stands in the navigation on its own. The
    // plugin has no user configuration; everything it writes goes into the
    // profile patch under `llm-pi-ai`'s own entry.
    ctx.plugin(ModalityPatcherService);
}
