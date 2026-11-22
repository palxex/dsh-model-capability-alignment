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
    id: string;
    /** `["text"]` / `["text","image"]`, when the endpoint said anything. */
    input?: string[];
    /** The model's own level menu, when the endpoint published one. */
    reasoningEfforts?: string[];
}
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
export declare function normaliseModalities(value: unknown): string[] | undefined;
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
export declare function readEndpointModels(body: unknown): EndpointModel[];
/**
 * The effort names pi-ai's own schema accepts.
 *
 * A gateway that publishes a different vocabulary (`light`, `extra_high`) is
 * describing *its* levels, not pi-ai's; writing those into `reasoningEfforts`
 * would make the entry invalid, so such a menu is reported but not patched.
 */
export declare const PI_AI_THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
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
export declare function normalizeMenu(efforts: readonly string[]): (typeof PI_AI_THINKING_LEVELS)[number][] | undefined;
export declare function sameVocabulary(efforts: readonly string[]): boolean;
