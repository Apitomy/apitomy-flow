import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PropertiesPanel } from './PropertiesPanel.tsx';
import { parseWorkflow } from '../../utils/workflowIo.ts';
import { toReactFlowNodes } from '../../utils/conversion.ts';

// These imports are only used by the host SPI dropdown, not the built-in input editors under test.
// PatternFly's CommonJS CSS requires cannot run in the project's Node-only Vitest environment.
vi.mock('@patternfly/react-core', () => ({}));
vi.mock('@patternfly/react-icons', () => ({}));

describe('imported literal input rendering', () => {
    it.each(['action', 'human-task'])('renders %s literal inputs without object coercion', type => {
        const result = parseWorkflow(JSON.stringify({
            id: 'w', name: 'Workflow', nodes: [
                { id: 's', type: 'start' },
                { id: 'a', type, config: { actionType: 'noop', inputs: {
                    count: 3, enabled: false, data: { nested: [1, null] },
                } } },
                { id: 'e', type: 'end' },
            ], edges: [{ id: 'sa', source: 's', target: 'a' }, { id: 'ae', source: 'a', target: 'e' }],
        }));
        expect(result.workflow).toBeDefined();
        const selectedNode = toReactFlowNodes(result.workflow!.nodes)[1];
        const markup = renderToStaticMarkup(<PropertiesPanel selectedNode={selectedNode}
            onNodeChange={() => {}} onNodeIdChange={() => {}} onEdgeChange={() => {}} />);
        expect(markup).toContain('value="3"');
        expect(markup).toContain('value="false"');
        expect(markup).toContain('{&quot;nested&quot;:[1,null]}');
        expect(markup).not.toContain('[object Object]');
    });
});
