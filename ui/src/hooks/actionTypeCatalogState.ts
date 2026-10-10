import type { ActionTypeDescriptor, ActionTypeProvider } from '../types/spi.ts';

/** Whether a catalog is configured and, if so, whether its first list has arrived. */
export type CatalogStatus = 'none' | 'loading' | 'ready';

/** The Action Type catalog as the editor currently knows it. */
export interface ActionTypeCatalog {
    actionTypes: ActionTypeDescriptor[];
    status: CatalogStatus;
}

/** Reducer state: the catalog plus the generation of the provider it belongs to. */
export interface CatalogState extends ActionTypeCatalog {
    generation: number;
}

/** Inputs to {@link catalogReducer}; `generation` identifies the provider instance an event belongs to. */
export type CatalogEvent =
    | { type: 'provider'; generation: number; provider: ActionTypeProvider | undefined }
    | { type: 'loaded'; generation: number; actionTypes: ActionTypeDescriptor[] }
    | { type: 'failed'; generation: number };

/** State before any provider has been seen. */
export const initialCatalogState: CatalogState = { actionTypes: [], status: 'none', generation: 0 };

/**
 * Applies a catalog event. A swapped function provider keeps the previous list visible (no loading flash),
 * results from replaced providers are ignored, and a failed load keeps the last list.
 *
 * @param state the current state
 * @param event the event
 * @returns the next state (the same object when the event is ignored)
 */
export function catalogReducer(state: CatalogState, event: CatalogEvent): CatalogState {
    if (event.type === 'provider') {
        const { provider, generation } = event;
        if (provider === undefined) return { actionTypes: [], status: 'none', generation };
        if (Array.isArray(provider)) return { actionTypes: provider, status: 'ready', generation };
        return state.status === 'ready'
            ? { actionTypes: state.actionTypes, status: 'ready', generation }
            : { actionTypes: [], status: 'loading', generation };
    }
    if (event.generation !== state.generation) return state;
    if (event.type === 'loaded') {
        return { actionTypes: Array.isArray(event.actionTypes) ? event.actionTypes : [], status: 'ready',
            generation: state.generation };
    }
    return { actionTypes: state.actionTypes, status: 'ready', generation: state.generation };
}
