import { describe, it, expect } from 'vitest';
import {
    buildProposalOverlay, formatCounts, proposalCounts, proposalDetails, splitGhostChanges, validationText,
} from './proposalOverlay.ts';
import { changeStatus } from './changeStatus.ts';
import { toReactFlowEdges, toReactFlowNodes } from '../utils/conversion.ts';
import type { StagedProposal } from './types.ts';
import type { Workflow } from '../types/workflow.ts';

const current: Workflow = { id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', name: 'A', config: {}, position: { x: 200, y: 0 } },
    { id: 'x', type: 'end', name: 'X', config: {}, position: { x: 400, y: 0 } },
], edges: [{ id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false },
    { id: 'ax', source: 'a', target: 'x', priority: 0, isDefault: false }] };
const preview: Workflow = { ...current, nodes: [
    current.nodes[0], { ...current.nodes[1], name: 'A2' },
    { id: 'n', type: 'end', name: 'N', config: {}, position: { x: 400, y: 100 } },
], edges: [current.edges[0], { id: 'an', source: 'a', target: 'n', priority: 0, isDefault: false }] };
const proposal = (stale = false): StagedProposal => ({ preview, stale,
    changeSet: { id: 'c', baseRevision: 'r', author: 'agent:t', summary: 'S', ops: [] } });
const rfNodes = () => toReactFlowNodes(current.nodes);
const rfEdges = () => toReactFlowEdges(current.edges);

describe('buildProposalOverlay', () => {
    it('marks modified and removed elements and adds non-interactive ghosts', () => {
        const overlay = buildProposalOverlay(rfNodes(), rfEdges(), current, proposal(), null);
        const byId = Object.fromEntries(overlay.nodes.map(node => [node.id, node]));
        expect(byId.s.className ?? '').not.toContain('flow-proposal');
        expect(byId.a.className).toContain('flow-proposal--modified');
        expect(byId.x.className).toContain('flow-proposal--removed');
        expect(byId.n).toMatchObject({ draggable: false, deletable: false, connectable: false, selectable: false });
        expect(byId.n.className).toContain('flow-proposal--added');
        expect(overlay.edges.find(edge => edge.id === 'an')?.className).toContain('flow-proposal--added');
        expect(overlay.edges.find(edge => edge.id === 'ax')?.className).toContain('flow-proposal--removed');
    });

    it('adds a stale modifier', () => {
        const overlay = buildProposalOverlay(rfNodes(), rfEdges(), current, proposal(true), null);
        expect(overlay.nodes.find(node => node.id === 'a')?.className).toContain('flow-proposal--stale');
    });

    it('applies the highlight only when no proposal is staged', () => {
        const highlight = { nodeIds: ['a'], edgeIds: ['sa'] };
        const plain = buildProposalOverlay(rfNodes(), rfEdges(), current, null, highlight);
        expect(plain.status).toBeNull();
        expect(plain.nodes.find(node => node.id === 'a')?.className).toContain('flow-applied');
        expect(plain.edges.find(edge => edge.id === 'sa')?.className).toContain('flow-applied');
        const staged = buildProposalOverlay(rfNodes(), rfEdges(), current, proposal(), highlight);
        expect(staged.nodes.find(node => node.id === 'a')?.className).not.toContain('flow-applied');
    });
});

describe('review bar text', () => {
    it('counts and formats changes', () => {
        expect(formatCounts(proposalCounts(changeStatus(current, preview))))
            .toBe('+1 node, +1 edge, ~1 node, −1 node, −1 edge');
        expect(formatCounts(proposalCounts(changeStatus(current, current)))).toBe('No changes');
    });

    it('describes the validation delta', () => {
        const problem = { severity: 'error' as const, code: 'X', message: 'm' };
        expect(validationText({ introduced: [], fixed: [] })).toBe('No validation changes');
        expect(validationText({ introduced: [problem, problem], fixed: [problem] })).toBe('Introduces 2 problems, fixes 1 problem');
        expect(validationText({ introduced: [], fixed: [problem] })).toBe('Fixes 1 problem');
    });
});

describe('proposalDetails', () => {
    it('returns before and after without positions, or null when unchanged', () => {
        expect(proposalDetails(current, preview, 'a')).toEqual({ id: 'a', kind: 'node',
            before: { id: 'a', type: 'action', name: 'A', config: {} }, after: { id: 'a', type: 'action', name: 'A2', config: {} } });
        expect(proposalDetails(current, preview, 'n')?.before).toBeNull();
        expect(proposalDetails(current, preview, 'ax')).toMatchObject({ kind: 'edge', after: null });
        expect(proposalDetails(current, preview, 's')).toBeNull();
    });
});

describe('overlay pass-through and unknown ids', () => {
    it('returns the editor elements unchanged with no proposal and no highlight', () => {
        const nodes = rfNodes();
        const edges = rfEdges();
        const overlay = buildProposalOverlay(nodes, edges, current, null, null);
        expect(overlay.nodes).toBe(nodes);
        expect(overlay.edges).toBe(edges);
        expect(overlay.status).toBeNull();
    });

    it('has no details for an id in neither document', () => {
        expect(proposalDetails(current, preview, 'nope')).toBeNull();
    });
});

describe('splitGhostChanges', () => {
    it('captures dimensions of unknown (ghost) nodes and passes everything else through', () => {
        const changes = [
            { type: 'dimensions' as const, id: 'ghost', dimensions: { width: 160, height: 50 } },
            { type: 'dimensions' as const, id: 's', dimensions: { width: 120, height: 44 } },
            { type: 'dimensions' as const, id: 'pending' },
            { type: 'select' as const, id: 'ghost', selected: true },
        ];
        const result = splitGhostChanges(changes, new Set(['s']));
        expect(result.ghostSizes).toEqual({ ghost: { width: 160, height: 50 } });
        expect(result.rest).toEqual([changes[1], changes[2], changes[3]]);
    });
});
