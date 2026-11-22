/** The node kind a provider's `models` value must be for a reorder to apply. */
const SEQUENCE = 'YAMLSeq';
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
export function reorderModels(profile, order) {
    const list = profile.get('models');
    if (list === null || typeof list !== 'object')
        return false;
    if (list.constructor?.name !== SEQUENCE)
        return false;
    const seq = list;
    const before = seq.items;
    if (before.length === 0)
        return false;
    const idOf = (item) => {
        const id = typeof item.get === 'function' ? item.get('id') : undefined;
        return typeof id === 'string' ? id : undefined;
    };
    // The endpoint's rank, first occurrence winning.
    const rank = new Map();
    for (const id of order)
        if (!rank.has(id))
            rank.set(id, rank.size);
    const next = before
        .map((item, index) => ({ item, index, rank: rank.get(idOf(item) ?? '') }))
        .sort((a, b) => {
        if (a.rank === undefined && b.rank === undefined)
            return a.index - b.index;
        if (a.rank === undefined)
            return 1;
        if (b.rank === undefined)
            return -1;
        return a.rank - b.rank || a.index - b.index;
    })
        .map(row => row.item);
    const changed = next.some((item, index) => item !== before[index]);
    if (changed)
        seq.items = next;
    return changed;
}
