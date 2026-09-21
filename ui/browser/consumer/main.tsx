import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowEditor, WorkflowViewer, WorkflowDiffViewer,
    type Workflow, type WorkflowInstance, type WorkflowEditorProps } from '@apitomy/flow-ui';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import '@apitomy/flow-ui/style.css';

const original: Workflow = {
    id: 'consumer', name: 'Consumer', nodes: [
        { id: 's', type: 'start', name: 'Consumer start', config: {}, position: { x: 0, y: 0 } },
        { id: 'e', type: 'end', name: 'Consumer end', config: {}, position: { x: 250, y: 0 } },
    ], edges: [{ id: 'se', source: 's', target: 'e', priority: 0, isDefault: false }],
};
const instance: WorkflowInstance = {
    id: 'i', workflowId: 'consumer', currentNodeId: 's', activeBranches: [{ branchId: 'root', nodeId: 's' }],
    joinArrivals: {}, status: 'running', context: {}, history: [], createdOn: '', updatedOn: '',
};

function Consumer() {
    const [workflow, setWorkflow] = useState(original);
    const onChange: WorkflowEditorProps['onChange'] = setWorkflow;
    return <>
        <h1>Packed ESM consumer</h1>
        <div style={{ height: 500 }} data-testid="consumer-editor"><WorkflowEditor workflow={workflow} onChange={onChange} /></div>
        <div style={{ height: 400 }} data-testid="consumer-viewer"><WorkflowViewer workflow={workflow} instance={instance} /></div>
        <div style={{ height: 400 }} data-testid="consumer-diff"><WorkflowDiffViewer baseWorkflow={original} compareWorkflow={workflow} /></div>
        <output>{JSON.stringify(workflow)}</output>
    </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Consumer /></StrictMode>);
