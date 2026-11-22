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
import { parseDocument } from 'yaml';
/** The loader patch entry that carries pi-ai's provider profiles. */
export const PI_AI_ENTRY_ID = 'llm-pi-ai';
/** The fields this plugin may write onto a model entry, and nothing else. */
export const OWNED_FIELDS = ['input', 'reasoningEfforts'];
/** Locate the pi-ai entry in a parsed patch document. */
function piAiEntry(doc) {
    const root = doc.contents;
    if (root === null || root.constructor.name !== 'YAMLSeq')
        return undefined;
    const items = root.items;
    for (const item of items) {
        if (item?.constructor?.name !== 'YAMLMap')
            continue;
        const map = item;
        if (map.get('id') === PI_AI_ENTRY_ID)
            return map;
    }
    return undefined;
}
/**
 * The provider profiles declared under `llm-pi-ai`.
 *
 * @returns provider id → its profile map, in file order; empty when the patch
 *   carries no pi-ai entry (a profile that never added a provider).
 */
export function readProviders(doc) {
    const out = new Map();
    const entry = piAiEntry(doc);
    if (entry === undefined)
        return out;
    const config = entry.get('config');
    if (config?.constructor?.name !== 'YAMLMap')
        return out;
    const providers = config.get('providers');
    if (providers?.constructor?.name !== 'YAMLMap')
        return out;
    for (const item of providers.items) {
        const key = item.key?.value;
        if (typeof key !== 'string' || item.value?.constructor?.name !== 'YAMLMap')
            continue;
        out.set(key, item.value);
    }
    return out;
}
/** The models a provider's profile keeps, as `id → entry`. */
export function readModels(profile) {
    const out = new Map();
    const models = profile.get('models');
    if (models?.constructor?.name !== 'YAMLSeq')
        return out;
    for (const item of models.items) {
        if (item?.constructor?.name !== 'YAMLMap')
            continue;
        const map = item;
        const id = map.get('id');
        if (typeof id === 'string' && id.length > 0)
            out.set(id, map);
    }
    return out;
}
/**
 * Read one field's value as plain JavaScript.
 *
 * `YAMLMap.get` answers with the node, not the data: a sequence arrives as a
 * `YAMLSeq` whose `Array.isArray` is false. `toJSON` is what turns a node back
 * into the value it represents, and it is the only reading that works for both
 * a value this plugin wrote and one a user typed by hand.
 */
function plainList(map, key) {
    if (map === undefined)
        return undefined;
    const node = map.get(key);
    if (node === undefined || node === null)
        return undefined;
    const value = typeof node.toJSON === 'function'
        ? node.toJSON()
        : node;
    if (!Array.isArray(value))
        return undefined;
    return value.filter((row) => typeof row === 'string');
}
/** Read the fields this plugin owns off one entry. */
/** Read pi-ai's effort dict (`{ level: wire }`) as the level list it offers. */
function plainEffortLevels(entry) {
    const node = entry?.get('reasoningEfforts');
    if (node === undefined || node === null)
        return undefined;
    const value = typeof node.toJSON === 'function'
        ? node.toJSON()
        : node;
    // The dict form is what pi-ai accepts; a bare list is what this plugin
    // mistakenly wrote before the schema discovery, so both shapes read back —
    // a stored list is repaired on the next write.
    if (Array.isArray(value))
        return value.filter((row) => typeof row === 'string');
    if (typeof value === 'object' && value !== null)
        return Object.keys(value);
    return undefined;
}
export function currentFields(entry) {
    const input = plainList(entry, 'input');
    const efforts = plainEffortLevels(entry);
    return {
        ...input === undefined ? {} : { input },
        ...efforts === undefined ? {} : { reasoningEfforts: efforts },
    };
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
export function planPatches(providers, scope) {
    const out = [];
    for (const provider of providers) {
        for (const [model, entry] of provider.models) {
            const said = provider.endpoint.get(model);
            if (said === undefined)
                continue;
            const current = currentFields(entry);
            if (scope.input && said.input !== undefined) {
                const decl = current.input;
                const same = decl !== undefined && decl.length === said.input.length && decl.every(v => said.input.includes(v));
                if (!same)
                    out.push({ provider: provider.id, model, field: 'input', value: said.input, ...decl === undefined ? {} : { current: decl } });
            }
            if (scope.reasoningEfforts && said.reasoningEfforts !== undefined) {
                const decl = current.reasoningEfforts;
                const same = decl !== undefined && decl.length === said.reasoningEfforts.length && decl.every(v => said.reasoningEfforts.includes(v));
                if (!same)
                    out.push({ provider: provider.id, model, field: 'reasoningEfforts', value: said.reasoningEfforts, ...decl === undefined ? {} : { current: [...decl] } });
            }
        }
    }
    return out;
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
const EFFORT_WIRE = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
/** Shape a level list into pi-ai's dict form, level -> itself. */
function effortsNode(value) {
    return Object.fromEntries(value.filter(level => EFFORT_WIRE.has(level)).map(level => [level, level]));
}
export function applyPatches(doc, patches) {
    const providers = readProviders(doc);
    let written = 0;
    for (const patch of patches) {
        const profile = providers.get(patch.provider);
        if (profile === undefined)
            continue;
        // A remove patch deletes the entry outright; it names no field.
        if (patch.remove === true) {
            written += removeModel(profile, patch.model) ? 1 : 0;
            continue;
        }
        const models = readModels(profile);
        let entry = models.get(patch.model);
        if (entry === undefined && patch.adopt === true) {
            entry = adoptModel(doc, profile, patch.model);
        }
        if (entry === undefined)
            continue;
        // `reasoningEfforts` goes down as a dict; writing the raw list would fail
        // pi-ai's schema and the whole entry with it — the bug that made filled
        // models look empty in the running host.
        if (patch.field === 'reasoningEfforts')
            entry.set(patch.field, effortsNode(patch.value));
        else
            entry.set(patch.field, [...patch.value]);
        written += 1;
    }
    return written;
}
/**
 * Delete one model entry from a provider's `models` list, in place.
 *
 * The entry must exist (a remove of nothing is skipped, not an error — the
 * plan and the file can drift between preview and apply). The removed node is
 * gone from the sequence; the entry's own content is irrelevant because the
 * backup holds it.
 */
function removeModel(profile, model) {
    const list = profile.get('models');
    if (list?.constructor?.name !== 'YAMLSeq')
        return false;
    const seq = list;
    const index = seq.items.findIndex(item => typeof item.get === 'function' && item.get('id') === model);
    if (index === -1)
        return false;
    seq.items.splice(index, 1);
    return true;
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
function adoptModel(owner, profile, model) {
    const list = profile.get('models');
    if (list?.constructor?.name !== 'YAMLSeq')
        return undefined;
    const seq = list;
    // The node must come from the document being edited: a node minted by
    // another Document belongs to that tree, and appending it here corrupts the
    // render instead of adding a row.
    const entry = owner.createNode({ id: model });
    seq.items.push(entry);
    return entry;
}
/** Parse a patch document for editing. */
export function parsePatch(text) {
    return parseDocument(text);
}
/** Render an edited document back to text. */
export function renderPatch(doc) {
    return doc.toString();
}
