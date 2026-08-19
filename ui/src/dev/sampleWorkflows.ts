import { type Workflow } from '../types/workflow.ts';
import { type WorkflowInstance } from '../types/instance.ts';

export const cveTriage: Workflow = {
  id: 'cve-triage',
  name: 'CVE Triage',
  description: 'Analyze and triage CVE vulnerabilities',
  nodes: [
    {
      id: 'start', type: 'start', name: 'Start',
      config: { inputs: [{ name: 'cveId', type: 'string', required: true }] },
      position: { x: 50, y: 200 },
    },
    {
      id: 'analyze', type: 'action', name: 'Analyze CVE',
      config: {
        actionType: 'analyze-cve',
        inputs: { 'CVE ID': 'context.cveId' },
        outputs: [
          { name: 'severity', type: 'string', required: true },
          { name: 'affectedVersions', type: 'string', required: false },
        ],
      },
      position: { x: 250, y: 200 },
    },
    {
      id: 'triage', type: 'human-task', name: 'Triage Decision',
      config: {
        description: 'Review the CVE analysis and determine if this vulnerability affects our systems.',
        inputs: {
          'CVE ID': 'context.cveId',
          'Severity': 'context.severity',
          'Affected Versions': 'context.affectedVersions',
        },
        outputs: [
          { name: 'affected', type: 'boolean', required: true },
          { name: 'triageNotes', type: 'string', required: false },
        ],
      },
      position: { x: 500, y: 200 },
    },
    {
      id: 'mitigate', type: 'action', name: 'Plan Mitigation',
      config: {
        actionType: 'plan-mitigation',
        inputs: {
          'CVE ID': 'context.cveId',
          'Severity': 'context.severity',
          'Triage Notes': 'context.triageNotes',
        },
        outputs: [
          { name: 'mitigationPlan', type: 'string', required: true },
        ],
      },
      position: { x: 750, y: 100 },
    },
    {
      id: 'close', type: 'action', name: 'Close Tracker',
      config: {
        actionType: 'close-tracker',
        inputs: {
          'CVE ID': 'context.cveId',
          'Triage Notes': 'context.triageNotes',
        },
        outputs: [
          { name: 'closedAt', type: 'string', required: true },
        ],
      },
      position: { x: 750, y: 300 },
    },
    {
      id: 'end-mitigated', type: 'end', name: 'Mitigated',
      config: { outcome: 'mitigated' },
      position: { x: 1000, y: 100 },
    },
    {
      id: 'end-not-affected', type: 'end', name: 'Not Affected',
      config: { outcome: 'not-affected' },
      position: { x: 1000, y: 300 },
    },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'analyze', priority: 0, isDefault: false },
    { id: 'e2', source: 'analyze', target: 'triage', priority: 0, isDefault: false },
    { id: 'e3', source: 'triage', target: 'mitigate', condition: "context.affected == true", priority: 1, isDefault: false, label: 'Affected' },
    { id: 'e4', source: 'triage', target: 'close', priority: 2, isDefault: true, label: 'Not Affected' },
    { id: 'e5', source: 'mitigate', target: 'end-mitigated', priority: 0, isDefault: false },
    { id: 'e6', source: 'close', target: 'end-not-affected', priority: 0, isDefault: false },
  ],
};

export const triageInstance: WorkflowInstance = {
  id: 'inst-1',
  workflowId: 'cve-triage',
  currentNodeId: 'triage',
  status: 'waiting',
  context: { cveId: 'CVE-2024-1234', severity: 'high', affectedVersions: '1.0.0 - 1.3.2' },
  history: [
    { nodeId: 'start', nodeName: 'Start', enteredOn: '2024-01-01T00:00:00Z', completedOn: '2024-01-01T00:00:00Z' },
    { nodeId: 'analyze', nodeName: 'Analyze CVE', edgeId: 'e1', enteredOn: '2024-01-01T00:00:01Z', completedOn: '2024-01-01T00:00:05Z', output: { severity: 'high', affectedVersions: '1.0.0 - 1.3.2' } },
    { nodeId: 'triage', nodeName: 'Triage Decision', edgeId: 'e2', enteredOn: '2024-01-01T00:00:05Z' },
  ],
  createdOn: '2024-01-01T00:00:00Z',
  updatedOn: '2024-01-01T00:00:05Z',
};

export const emptyWorkflow: Workflow = {
  id: 'new',
  name: 'New Workflow',
  nodes: [],
  edges: [],
};
