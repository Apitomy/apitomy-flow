import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PropertiesPanel } from './PropertiesPanel.tsx';
import { toReactFlowEdges, toReactFlowNodes } from '../../utils/conversion.ts';

// PatternFly's CommonJS CSS requires cannot run in the project's Node-only Vitest environment.
vi.mock('@patternfly/react-core', () => ({}));
vi.mock('@patternfly/react-icons', () => ({}));

const [startNode] = toReactFlowNodes([{ id: 'begin', name: 'Begin here', type: 'start',
    config: { inputs: [{ name: 'orderId', type: 'string' }] } }]);
const [edge] = toReactFlowEdges([{ id: 'e1', source: 'a', target: 'b', condition: '${ok}', priority: 0,
    isDefault: false }]);

describe('read-only properties panel', () => {
    it('shows node values inside a disabled fieldset', () => {
        const markup = renderToStaticMarkup(<PropertiesPanel selectedNode={startNode} readOnly
            onNodeChange={() => {}} onNodeIdChange={() => {}} onEdgeChange={() => {}} />);
        expect(markup).toMatch(/<fieldset[^>]*disabled/);
        expect(markup).toContain('value="begin"');
        expect(markup).toContain('value="Begin here"');
        expect(markup).toContain('value="orderId"');
    });

    it('shows edge values inside a disabled fieldset', () => {
        const markup = renderToStaticMarkup(<PropertiesPanel selectedEdge={edge} readOnly
            onNodeChange={() => {}} onNodeIdChange={() => {}} onEdgeChange={() => {}} />);
        expect(markup).toMatch(/<fieldset[^>]*disabled/);
        expect(markup).toContain('${ok}');
    });

    it('stays editable by default', () => {
        const markup = renderToStaticMarkup(<PropertiesPanel selectedNode={startNode}
            onNodeChange={() => {}} onNodeIdChange={() => {}} onEdgeChange={() => {}} />);
        expect(markup).not.toContain('<fieldset');
    });
});
