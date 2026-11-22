import type { YAMLMap } from 'yaml';
/**
 * Reorder one profile's `models` to follow the endpoint's listing order.
 *
 * The page lists models in the order the route publishes them, but a write
 * that appended new entries left the FILE in a different order than the
 * review that produced it — so the next scan, and anyone reading the profile,
 * saw an order the user never chose.
 *
 * Items are moved, never rebuilt: the same node objects go into a different
 * order, so comments and formatting carried by each node survive.
 * Models the endpoint does not mention keep their own relative order after
 * the ones it does, and a model the endpoint names twice keeps its first
 * position.
 *
 * @param profile - the provider map whose `models` sequence is reordered.
 * @param order - endpoint model ids, in the route's own order.
 * @returns whether the sequence changed.
 */
export declare function reorderModels(profile: YAMLMap, order: readonly string[]): boolean;
