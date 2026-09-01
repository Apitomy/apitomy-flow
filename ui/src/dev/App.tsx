import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import Editor from '@monaco-editor/react';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import { FileAltIcon, SearchIcon, ExternalLinkAltIcon } from '@patternfly/react-icons';
import { WorkflowEditor } from '../components/WorkflowEditor.tsx';
import { WorkflowViewer, type WorkflowViewerNodeMenuItem } from '../components/WorkflowViewer.tsx';
import { cveTriage, triageInstance, completedTriageInstance, loopingTriageInstance } from './sampleWorkflows.ts';
import { type Workflow } from '../types/workflow.ts';
import { type FlowTheme } from '../components/WorkflowEditor.tsx';
import { type EditorSpi } from '../types/spi.ts';
import { type ValidationProblem } from '../types/validation.ts';
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
  validate: async (wf): Promise<ValidationProblem[]> => {
    const problems: ValidationProblem[] = [];
    const known = new Set(['send-email', 'http-request', 'lookup-cve', 'create-jira-ticket']);

    // Synchronous host rule: action type must be in the host's catalog.
    for (const node of wf.nodes) {
      if (node.type === 'action') {
        const actionType = node.config.actionType;
        if (typeof actionType === 'string' && actionType.trim() !== '' && !known.has(actionType)) {
          problems.push({
            severity: 'error',
            code: 'HOST_UNKNOWN_ACTION_TYPE',
            message: `Action type "${actionType}" is not in the host catalog`,
            nodeId: node.id,
          });
        }
      }
    }

    // Simulated backend latency to demonstrate the debounced/async path.
    await new Promise((resolve) => setTimeout(resolve, 400));

    if (wf.name && wf.name.length > 40) {
      problems.push({
        severity: 'warning',
        code: 'HOST_NAME_TOO_LONG',
        message: 'Workflow name exceeds the host limit of 40 characters',
      });
    }

    return problems;
  },
};

/**
 * Demonstrates a host contributing its own actions to a viewer node's
 * right-click context menu. Uses the function form so the menu can vary per
 * node (here, "Jump to trace span" only appears for nodes that actually ran).
 */
function nodeContextMenuItems(nodeId: string): WorkflowViewerNodeMenuItem[] {
  const items: WorkflowViewerNodeMenuItem[] = [
    {
      id: 'open-log',
      label: 'Open execution log',
      icon: <FileAltIcon />,
      onSelect: (id) => alert(`Host: open execution log for node "${id}"`),
    },
    {
      id: 'inspect',
      label: 'Inspect node',
      icon: <SearchIcon />,
      onSelect: (id) => alert(`Host: inspect node "${id}"`),
    },
  ];

  const wasVisited = triageInstance.history.some((h) => h.nodeId === nodeId);
  if (wasVisited) {
    items.push({
      id: 'open-trace',
      label: 'Jump to trace span',
      icon: <ExternalLinkAltIcon />,
      danger: true,
      onSelect: (id) => alert(`Host: jump to trace span for node "${id}"`),
    });
  }

  return items;
}

function App() {
  const [tab, setTab] = useState<'editor' | 'viewer' | 'json'>('editor');
  const [workflow, setWorkflow] = useState<Workflow>(cveTriage);
  const [theme, setTheme] = useState<FlowTheme>('light');
  const [instanceKey, setInstanceKey] = useState<'running' | 'completed' | 'looping'>('running');

  const viewerInstance =
    instanceKey === 'completed' ? completedTriageInstance
    : instanceKey === 'looping' ? loopingTriageInstance
    : triageInstance;

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
          <button className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>
            JSON
          </button>
        </div>
        <div className="dev-app__toggles">
          {tab === 'viewer' && (
            <label className="dev-app__theme-toggle">
              Instance
              <select
                value={instanceKey}
                onChange={(e) => setInstanceKey(e.target.value as 'running' | 'completed' | 'looping')}
              >
                <option value="running">Running</option>
                <option value="completed">Completed run</option>
                <option value="looping">Looping run</option>
              </select>
            </label>
          )}
          <label className="dev-app__theme-toggle">
            <input
              type="checkbox"
              checked={theme === 'dark'}
              onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')}
            />
            Dark mode
          </label>
        </div>
      </div>
      <div className="dev-app__content">
        {tab === 'editor' && (
          <WorkflowEditor workflow={workflow} onChange={setWorkflow} theme={theme} spi={spi} />
        )}
        {tab === 'viewer' && (
          <WorkflowViewer
            workflow={cveTriage}
            instance={viewerInstance}
            theme={theme}
            nodeContextMenuItems={nodeContextMenuItems}
          />
        )}
        {tab === 'json' && (
          <Editor
            language="json"
            value={JSON.stringify(workflow, null, 2)}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false }}
          />
        )}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
