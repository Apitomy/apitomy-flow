import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import { WorkflowEditor } from '../components/WorkflowEditor.tsx';
import { WorkflowViewer } from '../components/WorkflowViewer.tsx';
import { cveTriage, triageInstance } from './sampleWorkflows.ts';
import { type Workflow } from '../types/workflow.ts';
import './App.css';

function App() {
  const [tab, setTab] = useState<'editor' | 'viewer'>('editor');
  const [workflow, setWorkflow] = useState<Workflow>(cveTriage);

  return (
    <div className="dev-app">
      <div className="dev-app__tabs">
        <button className={tab === 'editor' ? 'active' : ''} onClick={() => setTab('editor')}>
          Editor
        </button>
        <button className={tab === 'viewer' ? 'active' : ''} onClick={() => setTab('viewer')}>
          Viewer
        </button>
      </div>
      <div className="dev-app__content">
        {tab === 'editor' && (
          <WorkflowEditor workflow={workflow} onChange={setWorkflow} />
        )}
        {tab === 'viewer' && (
          <WorkflowViewer workflow={cveTriage} instance={triageInstance} />
        )}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
