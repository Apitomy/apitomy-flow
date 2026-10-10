import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { ActionTypeProvider } from '../types/spi.ts';
import { catalogReducer, initialCatalogState, type ActionTypeCatalog } from './actionTypeCatalogState.ts';

/**
 * Loads the Action Type catalog for the whole editor. Passing a new provider (array or function) reloads it;
 * a reloading function provider keeps the previous list visible until its result arrives.
 *
 * @param provider `spi.actionTypes`
 * @returns the current catalog (a stable object while its contents are unchanged)
 */
export function useActionTypeCatalog(provider: ActionTypeProvider | undefined): ActionTypeCatalog {
    const [state, dispatch] = useReducer(catalogReducer, initialCatalogState);
    const generation = useRef(0);
    useEffect(() => {
        generation.current += 1;
        const current = generation.current;
        dispatch({ type: 'provider', generation: current, provider });
        if (typeof provider !== 'function') return;
        let active = true;
        Promise.resolve().then(provider).then(
            actionTypes => { if (active) dispatch({ type: 'loaded', generation: current, actionTypes }); },
            () => { if (active) dispatch({ type: 'failed', generation: current }); },
        );
        return () => { active = false; };
    }, [provider]);
    return useMemo(() => ({ actionTypes: state.actionTypes, status: state.status }),
        [state.actionTypes, state.status]);
}
