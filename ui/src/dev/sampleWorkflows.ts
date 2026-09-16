import { type Workflow } from '../types/workflow.ts';
import { type WorkflowInstance } from '../types/instance.ts';

export interface DemoScenario {
  key: string;
  label: string;
  workflow: Workflow;
  instance: WorkflowInstance;
}

export const cveTriage: Workflow = {
  id: 'cve-triage',
  name: 'CVE Triage',
  description: 'Analyze and triage CVE vulnerabilities',
  version: 1,
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
  activeBranches: [{ branchId: 'root', nodeId: 'triage' }],
  joinArrivals: {},
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

/**
 * A completed run of {@link cveTriage} that took the "Affected" path all the way
 * through to the "Mitigated" End node. Useful for previewing how the viewer
 * renders a finished workflow (including the inbound edge to the End node).
 */
export const completedTriageInstance: WorkflowInstance = {
  id: 'inst-2',
  workflowId: 'cve-triage',
  currentNodeId: 'end-mitigated',
  activeBranches: [],
  joinArrivals: {},
  status: 'completed',
  context: {
    cveId: 'CVE-2024-1234',
    severity: 'high',
    affectedVersions: '1.0.0 - 1.3.2',
    affected: true,
    triageNotes: 'Confirmed exploitable in production; prioritize patch.',
    mitigationPlan: 'Upgrade to 1.3.3 and rotate affected credentials.',
  },
  history: [
    { nodeId: 'start', nodeName: 'Start', enteredOn: '2024-01-01T00:00:00Z', completedOn: '2024-01-01T00:00:00Z' },
    { nodeId: 'analyze', nodeName: 'Analyze CVE', edgeId: 'e1', enteredOn: '2024-01-01T00:00:01Z', completedOn: '2024-01-01T00:00:05Z', output: { severity: 'high', affectedVersions: '1.0.0 - 1.3.2' } },
    { nodeId: 'triage', nodeName: 'Triage Decision', edgeId: 'e2', enteredOn: '2024-01-01T00:00:05Z', completedOn: '2024-01-01T00:02:00Z', output: { affected: true, triageNotes: 'Confirmed exploitable in production; prioritize patch.' } },
    { nodeId: 'mitigate', nodeName: 'Plan Mitigation', edgeId: 'e3', edgeCondition: 'context.affected == true', enteredOn: '2024-01-01T00:02:00Z', completedOn: '2024-01-01T00:02:30Z', output: { mitigationPlan: 'Upgrade to 1.3.3 and rotate affected credentials.' } },
    { nodeId: 'end-mitigated', nodeName: 'Mitigated', edgeId: 'e5', enteredOn: '2024-01-01T00:02:30Z', completedOn: '2024-01-01T00:02:30Z' },
  ],
  createdOn: '2024-01-01T00:00:00Z',
  updatedOn: '2024-01-01T00:02:30Z',
};

/**
 * A run of {@link cveTriage} that loops back through "Analyze CVE" and "Triage
 * Decision" before settling. Both nodes appear multiple times in the history,
 * exercising the viewer's per-node visit selector.
 */
export const loopingTriageInstance: WorkflowInstance = {
  id: 'inst-3',
  workflowId: 'cve-triage',
  currentNodeId: 'triage',
  activeBranches: [{ branchId: 'root', nodeId: 'triage' }],
  joinArrivals: {},
  status: 'waiting',
  context: { cveId: 'CVE-2024-1234', severity: 'high', affectedVersions: '1.0.0 - 1.3.2' },
  history: [
    { nodeId: 'start', nodeName: 'Start', enteredOn: '2024-01-01T00:00:00Z', completedOn: '2024-01-01T00:00:00Z' },
    { nodeId: 'analyze', nodeName: 'Analyze CVE', edgeId: 'e1', enteredOn: '2024-01-01T00:00:01Z', completedOn: '2024-01-01T00:00:05Z', output: { severity: 'medium', affectedVersions: '1.0.0 - 1.2.0' } },
    { nodeId: 'triage', nodeName: 'Triage Decision', edgeId: 'e2', enteredOn: '2024-01-01T00:00:05Z', completedOn: '2024-01-01T00:01:00Z', output: { affected: false, triageNotes: 'Needs a closer look at newer versions.' } },
    { nodeId: 'analyze', nodeName: 'Analyze CVE', edgeId: 'e2', enteredOn: '2024-01-01T00:01:00Z', completedOn: '2024-01-01T00:01:20Z', output: { severity: 'high', affectedVersions: '1.0.0 - 1.3.2' } },
    { nodeId: 'triage', nodeName: 'Triage Decision', edgeId: 'e2', enteredOn: '2024-01-01T00:01:20Z' },
  ],
  createdOn: '2024-01-01T00:00:00Z',
  updatedOn: '2024-01-01T00:01:20Z',
};

export const emptyWorkflow: Workflow = {
  id: 'new',
  name: 'New Workflow',
  nodes: [],
  edges: [],
};

export const parallelForkJoinWorkflow: Workflow = {
  id: 'parallel-fork-join',
  name: 'Parallel CVE Fork/Join',
  description: 'Fetches CVE data, fans out to analysis and notification, then joins for publishing.',
  version: 1,
  nodes: [
    {
      id: 'start', type: 'start', name: 'Start',
      config: { inputs: [{ name: 'cveId', type: 'string', required: true }] },
      position: { x: 60, y: 220 },
    },
    {
      id: 'fetch', type: 'action', name: 'Fetch CVE',
      config: {
        actionType: 'lookup-cve',
        inputs: { 'CVE ID': 'context.cveId' },
        outputs: [
          { name: 'severity', type: 'string', required: true },
          { name: 'description', type: 'string', required: true },
        ],
      },
      position: { x: 260, y: 220 },
    },
    {
      id: 'analyze', type: 'human-task', name: 'Assess Impact',
      config: {
        description: 'Security analyst reviews severity and confirms impact.',
        inputs: {
          'CVE ID': 'context.cveId',
          'Severity': 'context.severity',
        },
        outputs: [
          { name: 'impact', type: 'string', required: true },
        ],
      },
      position: { x: 520, y: 120 },
    },
    {
      id: 'notify', type: 'action', name: 'Notify Team',
      config: {
        actionType: 'send-email',
        inputs: {
          to: "'soc@apitomy.io'",
          subject: "'CVE Alert: ' + context.cveId",
          body: 'context.description',
        },
        outputs: [
          { name: 'messageId', type: 'string', required: true },
        ],
      },
      position: { x: 520, y: 320 },
    },
    {
      id: 'join', type: 'wait', name: 'Join Branches',
      config: { duration: 'PT0S' },
      position: { x: 760, y: 220 },
    },
    {
      id: 'end', type: 'end', name: 'Published',
      config: { outcome: 'published' },
      position: { x: 980, y: 220 },
    },
  ],
  edges: [
    { id: 'pf1', source: 'start', target: 'fetch', priority: 0, isDefault: false },
    { id: 'pf2', source: 'fetch', target: 'analyze', priority: 0, isDefault: false },
    { id: 'pf3', source: 'fetch', target: 'notify', priority: 1, isDefault: false },
    { id: 'pf4', source: 'analyze', target: 'join', priority: 0, isDefault: false },
    { id: 'pf5', source: 'notify', target: 'join', priority: 0, isDefault: false },
    { id: 'pf6', source: 'join', target: 'end', priority: 0, isDefault: false },
  ],
};

export const parallelForkJoinInstance: WorkflowInstance = {
  id: 'inst-parallel-1',
  workflowId: 'parallel-fork-join',
  currentNodeId: null,
  activeBranches: [
    { branchId: 'root.0', nodeId: 'analyze' },
    { branchId: 'root.1', nodeId: 'notify' },
  ],
  joinArrivals: {},
  status: 'waiting',
  context: {
    cveId: 'CVE-2026-1337',
    severity: 'critical',
    description: 'Remote code execution in dependency parser',
  },
  history: [
    { nodeId: 'start', nodeName: 'Start', enteredOn: '2026-09-09T13:00:00Z', completedOn: '2026-09-09T13:00:00Z', branchId: 'root' },
    { nodeId: 'fetch', nodeName: 'Fetch CVE', edgeId: 'pf1', enteredOn: '2026-09-09T13:00:01Z', completedOn: '2026-09-09T13:00:03Z', output: { severity: 'critical', description: 'Remote code execution in dependency parser' }, branchId: 'root' },
    { nodeId: 'analyze', nodeName: 'Assess Impact', edgeId: 'pf2', enteredOn: '2026-09-09T13:00:03Z', branchId: 'root.0' },
    { nodeId: 'notify', nodeName: 'Notify Team', edgeId: 'pf3', enteredOn: '2026-09-09T13:00:03Z', branchId: 'root.1' },
  ],
  createdOn: '2026-09-09T13:00:00Z',
  updatedOn: '2026-09-09T13:00:03Z',
};

export const loopWorkflow: Workflow = {
  id: 'loop-review',
  name: 'Looping Review Cycle',
  description: 'Demonstrates a human review loop before final approval.',
  version: 1,
  nodes: [
    {
      id: 'start', type: 'start', name: 'Start',
      config: { inputs: [{ name: 'ticketId', type: 'string', required: true }] },
      position: { x: 60, y: 220 },
    },
    {
      id: 'draft', type: 'action', name: 'Draft Plan',
      config: {
        actionType: 'create-jira-ticket',
        inputs: {
          project: "'SEC'",
          issueType: "'Task'",
          summary: "'Mitigate ' + context.ticketId",
        },
        outputs: [
          { name: 'issueKey', type: 'string', required: true },
        ],
      },
      position: { x: 260, y: 220 },
    },
    {
      id: 'review', type: 'human-task', name: 'Review Plan',
      config: {
        description: 'Approve the mitigation plan or request changes.',
        inputs: {
          'Issue Key': 'context.issueKey',
          'Current Plan': 'context.revisedPlan',
        },
        outputs: [
          { name: 'approved', type: 'boolean', required: true, contextKey: 'reviewerApproved' },
          { name: 'reviewNotes', type: 'string', required: false },
        ],
      },
      position: { x: 500, y: 220 },
    },
    {
      id: 'revise', type: 'action', name: 'Revise Plan',
      config: {
        actionType: 'http-request',
        inputs: {
          url: "'https://planner.apitomy.io/revise'",
          method: "'POST'",
          body: '{"notes": context.reviewNotes}',
        },
        outputs: [
          { name: 'plan', type: 'string', required: true, contextKey: 'revisedPlan' },
        ],
      },
      position: { x: 740, y: 110 },
    },
    {
      id: 'publish', type: 'action', name: 'Publish Plan',
      config: {
        actionType: 'send-email',
        inputs: {
          to: "'secops@apitomy.io'",
          subject: "'Plan approved: ' + context.issueKey",
          body: 'context.revisedPlan',
        },
        outputs: [
          { name: 'messageId', type: 'string', required: true },
        ],
      },
      position: { x: 740, y: 320 },
    },
    {
      id: 'end', type: 'end', name: 'Closed',
      config: { outcome: 'approved' },
      position: { x: 980, y: 320 },
    },
  ],
  edges: [
    { id: 'lp1', source: 'start', target: 'draft', priority: 0, isDefault: false },
    { id: 'lp2', source: 'draft', target: 'review', priority: 0, isDefault: false },
    { id: 'lp3', source: 'review', target: 'publish', condition: 'context.reviewerApproved == true', priority: 0, isDefault: false, label: 'Approved' },
    { id: 'lp4', source: 'review', target: 'revise', priority: 1, isDefault: true, label: 'Needs revisions' },
    { id: 'lp5', source: 'revise', target: 'review', priority: 0, isDefault: false },
    { id: 'lp6', source: 'publish', target: 'end', priority: 0, isDefault: false },
  ],
};

export const loopWorkflowInstance: WorkflowInstance = {
  id: 'inst-loop-1',
  workflowId: 'loop-review',
  currentNodeId: 'review',
  activeBranches: [{ branchId: 'root', nodeId: 'review' }],
  joinArrivals: {},
  status: 'waiting',
  context: {
    ticketId: 'SEC-42',
    issueKey: 'SEC-42',
    reviewerApproved: false,
    reviewNotes: 'Please tighten rollback steps.',
    revisedPlan: 'Updated rollout with rollback verification checklist.',
  },
  history: [
    { nodeId: 'start', nodeName: 'Start', enteredOn: '2026-09-09T14:10:00Z', completedOn: '2026-09-09T14:10:00Z', branchId: 'root' },
    { nodeId: 'draft', nodeName: 'Draft Plan', edgeId: 'lp1', enteredOn: '2026-09-09T14:10:01Z', completedOn: '2026-09-09T14:10:05Z', output: { issueKey: 'SEC-42' }, branchId: 'root' },
    { nodeId: 'review', nodeName: 'Review Plan', edgeId: 'lp2', enteredOn: '2026-09-09T14:10:05Z', completedOn: '2026-09-09T14:11:00Z', output: { reviewerApproved: false, reviewNotes: 'Please tighten rollback steps.' }, branchId: 'root' },
    { nodeId: 'revise', nodeName: 'Revise Plan', edgeId: 'lp4', enteredOn: '2026-09-09T14:11:00Z', completedOn: '2026-09-09T14:12:30Z', output: { revisedPlan: 'Updated rollout with rollback verification checklist.' }, branchId: 'root' },
    { nodeId: 'review', nodeName: 'Review Plan', edgeId: 'lp5', enteredOn: '2026-09-09T14:12:30Z', branchId: 'root' },
  ],
  createdOn: '2026-09-09T14:10:00Z',
  updatedOn: '2026-09-09T14:12:30Z',
};

export const demoScenarios: DemoScenario[] = [
  {
    key: 'cve-triage',
    label: 'CVE Triage',
    workflow: cveTriage,
    instance: triageInstance,
  },
  {
    key: 'parallel-fork-join',
    label: 'Parallel Fork/Join',
    workflow: parallelForkJoinWorkflow,
    instance: parallelForkJoinInstance,
  },
  {
    key: 'loop-review',
    label: 'Looping Review',
    workflow: loopWorkflow,
    instance: loopWorkflowInstance,
  },
];
