export interface MapDraftPair {
    id: string;
    key: string;
    value: JsonValue | undefined;
}

export interface MapDraft {
    identity: string;
    generation: number;
    map: JsonObject;
    pairs: MapDraftPair[];
}

/** Creates stable row identities for one explicit draft session. */
export function createMapDraft(map: JsonObject | null | undefined, identity: string, generation = 0): MapDraft {
    return { identity, generation, map: map ?? {}, pairs: Object.entries(map ?? {}).map(([key, value], index) => ({
        id: `${identity}:${generation}:${index}`, key, value,
    })) };
}

/** Records a local draft and its serialized acknowledgement without changing row identities. */
export function editMapDraft(draft: MapDraft, pairs: MapDraftPair[]): MapDraft {
    return { ...draft, pairs, map: Object.fromEntries(pairs.map(pair => [pair.key, pair.value])) };
}

function sameValue(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((value, index) => sameValue(value, right[index]));
    }
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    return Object.keys(a).length === Object.keys(b).length
        && Object.keys(a).every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

/** Reconciles cloned echoes with explicit selection/history reset identities. */
export function syncMapDraft(draft: MapDraft, map: JsonObject | null | undefined, identity: string): MapDraft {
    if (draft.identity === identity && sameValue(draft.map, map ?? {})) return draft;
    return createMapDraft(map, identity, draft.generation + 1);
}
import type { JsonObject, JsonValue } from '../types/workflow.ts';
