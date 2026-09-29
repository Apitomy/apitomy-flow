import { type ActionTypeDescriptor } from '../types/spi.ts';

/** Below this many action types, the picker shows the full list without filtering as the user types. */
export const ACTION_TYPE_FILTER_THRESHOLD = 8;

/** The result of narrowing an action type list by user-typed filter text. */
export interface ActionTypeFilterResult {
    /** Whether the list was long enough for filter text to narrow the options. */
    filterEnabled: boolean;
    /** The options to display, narrowed by `filterText` only when `filterEnabled` is true. */
    options: ActionTypeDescriptor[];
}

/**
 * Narrows `actionTypes` by `filterText`, matching against each type's label, value or description
 * case-insensitively. Filtering only applies once the list exceeds
 * {@link ACTION_TYPE_FILTER_THRESHOLD}; shorter lists are always returned in full so a stray
 * keystroke can't hide an option the user still wants to click.
 */
export function filterActionTypeOptions(actionTypes: ActionTypeDescriptor[], filterText: string): ActionTypeFilterResult {
    const filterEnabled = actionTypes.length > ACTION_TYPE_FILTER_THRESHOLD;
    if (!filterEnabled || !filterText) {
        return { filterEnabled, options: actionTypes };
    }
    const lower = filterText.toLowerCase();
    return {
        filterEnabled,
        options: actionTypes.filter(at => at.label.toLowerCase().includes(lower)
            || at.value.toLowerCase().includes(lower) || at.description?.toLowerCase().includes(lower)),
    };
}
