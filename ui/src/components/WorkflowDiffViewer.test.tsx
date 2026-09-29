import { renderToStaticMarkup } from 'react-dom/server';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { type Workflow } from '../types/workflow.ts';
import { WorkflowDiffViewer } from './WorkflowDiffViewer.tsx';

// PatternFly's CommonJS CSS imports cannot run in Node. Tooltip presentation
// is unrelated to the real viewer's diff/model/layout initialization below.
vi.mock('@patternfly/react-core', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));

describe('WorkflowDiffViewer position fallback', () => {
    it.each([
        { label: 'omitted', position: undefined },
        { label: 'null', position: null },
        { label: 'nonfinite', position: { x: NaN, y: Infinity } },
    ])('renders matching definitions with $label positions', ({ position }) => {
        const workflow = {
            id: 'workflow',
            name: 'Positionless workflow',
            nodes: [
                { id: 'start', type: 'start', name: 'Start', config: {}, ...(position === undefined ? {} : { position }) },
                { id: 'end', type: 'end', name: 'End', config: {}, ...(position === undefined ? {} : { position }) },
            ],
            edges: [{ id: 'edge', source: 'start', target: 'end', priority: 0, isDefault: true }],
        } as Workflow;

        const markup = renderToStaticMarkup(
            <WorkflowDiffViewer baseWorkflow={workflow} compareWorkflow={structuredClone(workflow)} />,
        );

        expect(markup).toContain('workflow-diff-viewer__canvas');
        expect(markup).toContain('Nodes: +0 -0 ~0| cosmetic 0');
    });
});
