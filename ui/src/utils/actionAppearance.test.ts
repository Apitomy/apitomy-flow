import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { ActionTypeCatalog } from '../hooks/actionTypeCatalogState.ts';
import type { ActionTypeDescriptor } from '../types/spi.ts';
import type { WorkflowNode } from '../types/workflow.ts';
import { actionAppearanceByNodeId, actionAppearanceFor } from './actionAppearance.ts';

const icon = createElement('svg', { 'data-testid': 'mail' });
const email: ActionTypeDescriptor = { value: 'email', label: 'Email', icon, color: '#c9190b' };
const slack: ActionTypeDescriptor = { value: 'slack', label: 'Slack', color: 'var(--brand)' };
const plain: ActionTypeDescriptor = { value: 'plain', label: 'Plain' };
const blank: ActionTypeDescriptor = { value: 'blank', label: 'Blank', color: '   ' };
const ready: ActionTypeCatalog = { actionTypes: [email, slack, plain, blank], status: 'ready' };

describe('actionAppearanceFor', () => {
    it('returns icon and color for a styled match', () => {
        expect(actionAppearanceFor('email', ready)).toEqual({ icon, color: '#c9190b' });
    });
    it('returns color only when the descriptor has no icon', () => {
        expect(actionAppearanceFor('slack', ready)).toEqual({ color: 'var(--brand)' });
    });
    it('returns undefined for an unknown type', () => {
        expect(actionAppearanceFor('nope', ready)).toBeUndefined();
    });
    it('returns undefined for a descriptor with neither icon nor color', () => {
        expect(actionAppearanceFor('plain', ready)).toBeUndefined();
    });
    it('ignores a blank color', () => {
        expect(actionAppearanceFor('blank', ready)).toBeUndefined();
    });
    it('ignores a non-string color', () => {
        const odd = { value: 'odd', label: 'Odd', color: 42 } as unknown as ActionTypeDescriptor;
        expect(actionAppearanceFor('odd', { actionTypes: [odd], status: 'ready' })).toBeUndefined();
    });
    it('returns undefined for non-string action types', () => {
        expect(actionAppearanceFor(7, ready)).toBeUndefined();
        expect(actionAppearanceFor(null, ready)).toBeUndefined();
        expect(actionAppearanceFor(undefined, ready)).toBeUndefined();
    });
    it('uses whatever descriptors are present regardless of status', () => {
        expect(actionAppearanceFor('email', { actionTypes: [], status: 'loading' })).toBeUndefined();
        expect(actionAppearanceFor('email', { actionTypes: [], status: 'none' })).toBeUndefined();
        expect(actionAppearanceFor('email', { actionTypes: [email], status: 'loading' }))
            .toEqual({ icon, color: '#c9190b' });
    });
});

describe('actionAppearanceByNodeId', () => {
    it('maps only styled action nodes', () => {
        const nodes = [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'a1', type: 'action', name: 'Mail', config: { actionType: 'email' } },
            { id: 'a2', type: 'action', name: 'Plain', config: { actionType: 'plain' } },
            { id: 'a3', type: 'action', name: 'None', config: {} },
            { id: 'a4', type: 'action', name: 'Slack', config: { actionType: 'slack' } },
            { id: 'e', type: 'end', name: 'End', config: {} },
        ] as WorkflowNode[];
        const result = actionAppearanceByNodeId(nodes, ready);
        expect([...result.keys()]).toEqual(['a1', 'a4']);
        expect(result.get('a4')).toEqual({ color: 'var(--brand)' });
    });
    it('is empty when the catalog is empty', () => {
        const nodes = [{ id: 'a', type: 'action', name: 'A', config: { actionType: 'email' } }] as WorkflowNode[];
        expect(actionAppearanceByNodeId(nodes, { actionTypes: [], status: 'none' }).size).toBe(0);
    });
});
