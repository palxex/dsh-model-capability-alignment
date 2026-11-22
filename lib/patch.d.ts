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
import { type Document, type YAMLMap } from 'yaml';
/** The loader patch entry that carries pi-ai's provider profiles. */
export declare const PI_AI_ENTRY_ID = "llm-pi-ai";
/** The fields this plugin may write onto a model entry, and nothing else. */
export declare const OWNED_FIELDS: readonly ["input", "reasoningEfforts"];
/** One model entry inside a provider's models list. */
export type ModelEntry = YAMLMap;
/**
 * The provider profiles declared under `llm-pi-ai`.
 *
 * @returns provider id → its profile map, in file order; empty when the patch
 *   carries no pi-ai entry (a profile that never added a provider).
 */
export declare function readProviders(doc: Document): Map<string, YAMLMap>;
/** The models a provider's profile keeps, as `id → entry`. */
export declare function readModels(profile: YAMLMap): Map<string, ModelEntry>;
/** What one model entry currently declares, in this plugin's terms. */
export interface CurrentModel {
    input?: string[];
    reasoningEfforts?: readonly string[];
}
export declare function currentFields(entry: ModelEntry | undefined): CurrentModel;
/**
 * One field the plugin would add to one entry.
 *
 * A plan is a proposal, never an edit: the caller shows it, and only an
 * explicit apply turns it into bytes.
 */
export interface FieldPatch {
    provider: string;
    model: string;
    field: typeof OWNED_FIELDS[number];
    /** The value to write. */
    value: string[];
    /** What the entry declares now, when it declares anything. */
    current?: string[];
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
    adopt?: boolean;
    /**
     * Remove this model's entry from the profile's list.
     *
     * Set only for a profile row whose probe failed and which the user ticked:
     * a failed verdict plus an explicit tick is the user saying "this route
     * cannot serve this model, drop it". A remove patch carries no field and
     * no value; applyPatches deletes the whole entry, and the backup taken
     * before the write is what undoes it.
     */
    remove?: boolean;
}
/** Which fields the caller wants filled in. */
/** Which fields the caller wants filled in. */
export interface PatchScope {
    input: boolean;
    reasoningEfforts: boolean;
    /**
     * Liveness pruning, with its own knobs. `prune.enabled === false` (or an
     * absent field, from an older client) keeps the scan capability-only.
     */
    prune?: {
        /** Hard per-model bound, milliseconds. */
        modelTimeoutMs?: number;
        /** Requests in flight at once. */
        concurrency?: number;
        /** Whole-probe budget, milliseconds. */
        budgetMs?: number;
        /**
         * The probe prompt. Its honest answer should be short and distinctive —
         * the reply is checked for the induced word, which is what proves the
         * prompt reached a real model.
         */
        prompt?: string;
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
export declare function planPatches(providers: ReadonlyArray<{
    id: string;
    models: Map<string, ModelEntry>;
    endpoint: ReadonlyMap<string, {
        input?: string[];
        reasoningEfforts?: string[];
    }>;
}>, scope: PatchScope): FieldPatch[];
export declare function applyPatches(doc: Document, patches: readonly FieldPatch[]): number;
/** Parse a patch document for editing. */
export declare function parsePatch(text: string): Document;
/** Render an edited document back to text. */
export declare function renderPatch(doc: Document): string;
