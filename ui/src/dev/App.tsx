import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import { WorkflowEditor } from '../components/WorkflowEditor.tsx';
import { WorkflowViewer } from '../components/WorkflowViewer.tsx';
import { cveTriage, triageInstance } from './sampleWorkflows.ts';
import { type Workflow } from '../types/workflow.ts';
import { type FlowTheme } from '../components/WorkflowEditor.tsx';
import { type EditorSpi } from '../types/spi.ts';
import './App.css';

const spi: EditorSpi = {
  actionTypes: [
    {
      value: 'send-email',
      label: 'Send Email',
      description: 'Send an email notification via the configured SMTP gateway',
      inputs: [
        { name: 'to', type: 'string', required: true, description: 'Recipient email address' },
        { name: 'subject', type: 'string', required: true },
        { name: 'body', type: 'string', required: true },
        { name: 'cc', type: 'string', required: false },
      ],
      outputs: [
        { name: 'messageId', type: 'string', required: true },
        { name: 'timestamp', type: 'string', required: true },
      ],
    },
    {
      value: 'http-request',
      label: 'HTTP Request',
      description: 'Make an outbound HTTP request to an external service',
      inputs: [
        { name: 'url', type: 'string', required: true },
        { name: 'method', type: 'string', required: true, description: 'GET, POST, PUT, DELETE' },
        { name: 'headers', type: 'object', required: false },
        { name: 'body', type: 'object', required: false },
      ],
      outputs: [
        { name: 'statusCode', type: 'number', required: true },
        { name: 'responseBody', type: 'object', required: true },
        { name: 'responseHeaders', type: 'object', required: true },
      ],
    },
    {
      value: 'lookup-cve',
      label: 'Lookup CVE',
      description: 'Query the NVD database for CVE details and severity scores',
      inputs: [
        { name: 'cveId', type: 'string', required: true, description: 'CVE identifier (e.g. CVE-2024-1234)' },
      ],
      outputs: [
        { name: 'severity', type: 'string', required: true },
        { name: 'cvssScore', type: 'number', required: true },
        { name: 'description', type: 'string', required: true },
        { name: 'affectedProducts', type: 'object', required: true },
      ],
    },
    {
      value: 'create-jira-ticket',
      label: 'Create Jira Ticket',
      description: 'Create a new issue in the configured Jira project',
      inputs: [
        { name: 'project', type: 'string', required: true },
        { name: 'issueType', type: 'string', required: true },
        { name: 'summary', type: 'string', required: true },
        { name: 'description', type: 'string', required: false },
        { name: 'priority', type: 'string', required: false },
      ],
      outputs: [
        { name: 'issueKey', type: 'string', required: true },
        { name: 'issueUrl', type: 'string', required: true },
      ],
    },
  ],
};

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
          <WorkflowEditor workflow={workflow} onChange={setWorkflow} theme={theme} spi={spi} />
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
