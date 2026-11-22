/**
 * The one write path: scan, plan, back up, write, verify.
 *
 * Kept separate from `scan.ts` so the read-only path can never write: a scan
 * is safe to run any time, an apply is the only thing that touches bytes.
 *
 * @module src/apply
 */
import { applyPatches, parsePatch, readProviders, renderPatch } from './patch.js';
import { reorderModels } from './reorder.js';
import { scanDocument } from './scan.js';
import { backupPatch, readPatch, writePatch } from './store.js';
/**
 * Re-parse rendered text to prove the round trip before it replaces a file.
 *
 * A document that does not survive `render` → `parse` unchanged would mean the
 * edit reshaped something no test saw. Refusing here is the difference between
 * a bad apply and a corrupted profile.
 *
 * @param original - the parsed document that was edited.
 * @param rendered - what the edit produced.
 * @throws when the rendered text does not parse back to the same model set.
 */
function verifyRoundTrip(original, rendered) {
    const reRead = parsePatch(rendered);
    const before = JSON.stringify(original.toJSON());
    const after = JSON.stringify(reRead.toJSON());
    if (before === after)
        return;
    throw new Error('the edited document did not round-trip; refusing to write it');
}
/**
 * Carry out one apply.
 *
 * @param location - the profile patch to edit.
 * @param scope - which fields to fill.
 * @param fetchListing - injected network seam.
 * @param filter - keep only these models, when the caller selected a subset.
 * @param signal - cancellation.
 */
export async function applyPatchesToProfile(location, scope, fetchListing, options = {}) {
    const original = readPatch(location);
    const doc = parsePatch(original);
    // The page sends an explicit field list built from what it already showed
    // the user. Deriving the plan again would mean re-reading every listing and
    // re-running the liveness probe — minutes of network work behind a button
    // the user expects to be a quick write — so an explicit list short-circuits
    // the scan entirely. Only a caller with no plan yet pays for one.
    const scan = options.fields === undefined
        ? await scanDocument(doc, scope, fetchListing, options.resolveCredential, options.signal, options.providers)
        : undefined;
    const patches = options.fields === undefined
        ? scan.providers.flatMap(provider => provider.models.flatMap(model => model.patches))
        : options.fields.map(field => {
            // The route comes from the caller when it names one, which it always
            // does when it also composes the field list; otherwise the field keeps
            // whatever provider it carried.
            const provider = options.providers?.[0] ?? field.provider;
            return { ...field, provider };
        });
    if (patches.length === 0)
        throw new Error('nothing to write: every kept model already declares these fields');
    const written = applyPatches(doc, patches);
    // Put the file's model order back to the route's own order. Only the routes
    // this call names are touched: a page that showed a scan sends that scan's
    // order, and a caller with nothing to order sends nothing, so a hand-edited
    // profile keeps its own arrangement instead of being silently reshuffled.
    const profiles = readProviders(doc);
    for (const [routeId, ids] of Object.entries(options.order ?? {})) {
        const profile = profiles.get(routeId);
        if (profile !== undefined)
            reorderModels(profile, ids);
    }
    // A plan that wrote less than it planned named a model no configured route
    // serves: a field with an empty provider (the scan never saw it) lands on no
    // profile, and applyPatches skips it. Silence would read as success while
    // the user's tick did nothing, so a full miss is refused and names them.
    if (written === 0) {
        // Nothing landed: the route does not exist, or the model has no entry and
        // the patch was not marked as an adoption. Name every model that was
        // asked for — a silent no-op on a button press reads as a bug.
        const missing = [...new Set(patches.map(patch => patch.model))];
        throw new Error(`nothing to write: no entry in this profile accepts ${missing.join(', ')}`);
    }
    const rendered = renderPatch(doc);
    verifyRoundTrip(doc, rendered);
    const backup = backupPatch(location, original);
    writePatch(location, rendered);
    return { patches, backup, scan, written };
}
