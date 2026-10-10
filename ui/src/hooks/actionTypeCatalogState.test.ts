import { describe, it, expect } from 'vitest';
import { catalogReducer, initialCatalogState, type CatalogState } from './actionTypeCatalogState.ts';
import type { ActionTypeDescriptor } from '../types/spi.ts';

const a: ActionTypeDescriptor = { value: 'a', label: 'A' };
const b: ActionTypeDescriptor = { value: 'b', label: 'B' };
const loader = () => Promise.resolve([a]);

describe('catalogReducer', () => {
    it('starts with no catalog', () => {
        expect(initialCatalogState).toEqual({ actionTypes: [], status: 'none', generation: 0 });
    });

    it('handles absent, static and function providers', () => {
        expect(catalogReducer(initialCatalogState, { type: 'provider', generation: 1, provider: undefined }))
            .toEqual({ actionTypes: [], status: 'none', generation: 1 });
        expect(catalogReducer(initialCatalogState, { type: 'provider', generation: 1, provider: [a] }))
            .toEqual({ actionTypes: [a], status: 'ready', generation: 1 });
        expect(catalogReducer(initialCatalogState, { type: 'provider', generation: 1, provider: loader }))
            .toEqual({ actionTypes: [], status: 'loading', generation: 1 });
    });

    it('keeps the previous list visible while a swapped provider loads', () => {
        const ready: CatalogState = { actionTypes: [a], status: 'ready', generation: 1 };
        const swapped = catalogReducer(ready, { type: 'provider', generation: 2, provider: loader });
        expect(swapped).toEqual({ actionTypes: [a], status: 'ready', generation: 2 });
        expect(catalogReducer(swapped, { type: 'loaded', generation: 2, actionTypes: [a, b] }))
            .toEqual({ actionTypes: [a, b], status: 'ready', generation: 2 });
    });

    it('ignores results from replaced providers', () => {
        const loading = catalogReducer(initialCatalogState, { type: 'provider', generation: 2, provider: loader });
        expect(catalogReducer(loading, { type: 'loaded', generation: 1, actionTypes: [b] })).toBe(loading);
        expect(catalogReducer(loading, { type: 'failed', generation: 1 })).toBe(loading);
    });

    it('keeps the last list on failure and becomes ready', () => {
        const loading = catalogReducer(initialCatalogState, { type: 'provider', generation: 1, provider: loader });
        expect(catalogReducer(loading, { type: 'failed', generation: 1 }))
            .toEqual({ actionTypes: [], status: 'ready', generation: 1 });
        const reloading: CatalogState = { actionTypes: [a], status: 'ready', generation: 2 };
        expect(catalogReducer(reloading, { type: 'failed', generation: 2 }))
            .toEqual({ actionTypes: [a], status: 'ready', generation: 2 });
    });

    it('treats a non-array loaded result as empty', () => {
        const loading = catalogReducer(initialCatalogState, { type: 'provider', generation: 1, provider: loader });
        expect(catalogReducer(loading, { type: 'loaded', generation: 1, actionTypes: 'x' as unknown as ActionTypeDescriptor[] }))
            .toEqual({ actionTypes: [], status: 'ready', generation: 1 });
    });
});
