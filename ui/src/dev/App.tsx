import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import { WorkflowEditor } from '../components/WorkflowEditor.tsx';
import { WorkflowViewer } from '../components/WorkflowViewer.tsx';
import { cveTriage, triageInstance } from './sampleWorkflows.ts';
import { type Workflow } from '../types/workflow.ts';
import { type FlowTheme } from '../components/WorkflowEditor.tsx';
import './App.css';

function App() {
  const [tab, setTab] = useState<'editor' | 'viewer'>('editor');
  const [workflow, setWorkflow] = useState<Workflow>(cveTriage);
  const [theme, setTheme] = useState<FlowTheme>('light');

  return (
    <div className={`dev-app ${theme === 'dark' ? 'dev-app--dark' : ''}`}>
      <div className="dev-app__tabs">
        <div className="dev-app__tabs-left">
          <button className={tab === 'editor' ? 'active' : ''} onClick={() => setTab('editor')}>
            Editor
          </button>
          <button className={tab === 'viewer' ? 'active' : ''} onClick={() => setTab('viewer')}>
            Viewer
          </button>
        </div>
        <label className="dev-app__theme-toggle">
          <input
            type="checkbox"
            checked={theme === 'dark'}
            onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')}
          />
          Dark mode
        </label>
      </div>
      <div className="dev-app__content">
        {tab === 'editor' && (
          <WorkflowEditor workflow={workflow} onChange={setWorkflow} theme={theme} />
        )}
        {tab === 'viewer' && (
          <WorkflowViewer workflow={cveTriage} instance={triageInstance} theme={theme} />
        )}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
