import { type Workflow } from '../types/workflow.ts';
import { cveTriage, loopWorkflow, parallelForkJoinWorkflow } from './sampleWorkflows.ts';

export interface WorkflowDiffScenario {
  key: string;
  label: string;
  baseWorkflow: Workflow;
  compareWorkflow: Workflow;
}

const cveTriageSemanticAndCosmeticBase: Workflow = {
  ...cveTriage,
  version: 1,
};

const cveTriageSemanticAndCosmeticCompare: Workflow = {
  ...cveTriage,
  version: 2,
  nodes: cveTriage.nodes.map((node) => {
    if (node.id === 'analyze') {
      return {
        ...node,
        position: { x: 290, y: 170 },
      };
    }

    if (node.id === 'triage') {
      return {
        ...node,
        name: 'Triage Assessment',
        config: {
          ...node.config,
          description: 'Review analysis details and classify product impact before routing.',
        },
      };
    }

    return node;
  }),
  edges: cveTriage.edges.map((edge) => {
    if (edge.id === 'e3') {
      return {
        ...edge,
        condition: 'context.affected == true && context.severity == "high"',
      };
    }

    return edge;
  }),
};

const addRemoveBase: Workflow = {
  ...loopWorkflow,
  version: 1,
};

const addRemoveCompare: Workflow = {
  ...loopWorkflow,
  version: 2,
  nodes: [
    ...loopWorkflow.nodes.filter((node) => node.id !== 'revise'),
    {
      id: 'escalate',
      type: 'action',
      name: 'Escalate Plan',
      config: {
        actionType: 'http-request',
        inputs: {
          url: "'https://planner.apitomy.io/escalate'",
          method: "'POST'",
          body: '{"notes": context.reviewNotes}',
        },
        outputs: [{ name: 'plan', type: 'string', required: true }],
      },
      position: { x: 740, y: 110 },
    },
  ],
  edges: [
    ...loopWorkflow.edges.filter((edge) => edge.id !== 'lp4' && edge.id !== 'lp5'),
    {
      id: 'lp7',
      source: 'review',
      target: 'escalate',
      priority: 1,
      isDefault: true,
      label: 'Needs escalation',
    },
    {
      id: 'lp8',
      source: 'escalate',
      target: 'review',
      priority: 0,
      isDefault: false,
    },
  ],
};

const linearMajorRevisionBase: Workflow = {
  ...cveTriage,
  version: 3,
};

const linearMajorRevisionCompare: Workflow = {
  ...cveTriage,
  version: 4,
  name: 'CVE Triage vNext',
  nodes: [
    ...cveTriage.nodes.filter((node) => node.id !== 'close'),
    {
      id: 'qa-check',
      type: 'human-task',
      name: 'QA Verification',
      config: {
        description: 'Validate remediation quality and rollout risk before closure.',
        inputs: {
          'CVE ID': 'context.cveId',
          'Mitigation Plan': 'context.mitigationPlan',
        },
        outputs: [
          { name: 'qaApproved', type: 'boolean', required: true },
          { name: 'qaNotes', type: 'string', required: false },
        ],
      },
      position: { x: 760, y: 240 },
    },
    {
      id: 'notify-stakeholders',
      type: 'action',
      name: 'Notify Stakeholders',
      config: {
        actionType: 'send-email',
        inputs: {
          to: "'security-ops@apitomy.io'",
          subject: "'CVE triage update: ' + context.cveId",
          body: 'context.qaNotes',
        },
        outputs: [{ name: 'messageId', type: 'string', required: true }],
      },
      position: { x: 980, y: 240 },
    },
  ],
  edges: [
    ...cveTriage.edges.filter((edge) => edge.id !== 'e4' && edge.id !== 'e6'),
    {
      id: 'e4b',
      source: 'triage',
      target: 'qa-check',
      condition: 'context.affected == false || context.severity == "critical"',
      priority: 2,
      isDefault: true,
      label: 'QA required',
    },
    { id: 'e7', source: 'mitigate', target: 'qa-check', priority: 0, isDefault: false },
    { id: 'e8', source: 'qa-check', target: 'notify-stakeholders', priority: 0, isDefault: false },
    { id: 'e9', source: 'notify-stakeholders', target: 'end-mitigated', priority: 0, isDefault: false },
    { id: 'e10', source: 'qa-check', target: 'end-not-affected', condition: 'context.qaApproved == false', priority: 1, isDefault: true, label: 'Rejected' },
  ],
};

const forkJoinMajorRevisionBase: Workflow = {
  ...parallelForkJoinWorkflow,
  version: 1,
};

const forkJoinMajorRevisionCompare: Workflow = {
  ...parallelForkJoinWorkflow,
  version: 2,
  nodes: [
    ...parallelForkJoinWorkflow.nodes
      .filter((node) => node.id !== 'notify')
      .map((node) => {
        if (node.id === 'analyze') {
          return {
            ...node,
            config: {
              ...node.config,
              description: 'Security analyst verifies exploitability and owner assignment.',
              outputs: [
                { name: 'impact', type: 'string', required: true },
                { name: 'owner', type: 'string', required: true },
              ],
            },
          };
        }
        return node;
      }),
    {
      id: 'draft-advisory',
      type: 'action',
      name: 'Draft Advisory',
      config: {
        actionType: 'http-request',
        inputs: {
          url: "'https://advisory.apitomy.io/drafts'",
          method: "'POST'",
          body: '{"cveId": context.cveId, "impact": context.impact}',
        },
        outputs: [{ name: 'advisoryId', type: 'string', required: true }],
      },
      position: { x: 520, y: 320 },
    },
    {
      id: 'legal-review',
      type: 'human-task',
      name: 'Legal Review',
      config: {
        description: 'Confirm wording and disclosure timeline before publication.',
        inputs: {
          'Advisory ID': 'context.advisoryId',
          'Severity': 'context.severity',
        },
        outputs: [{ name: 'legalApproved', type: 'boolean', required: true }],
      },
      position: { x: 700, y: 320 },
    },
  ],
  edges: [
    ...parallelForkJoinWorkflow.edges.filter((edge) => edge.id !== 'pf3' && edge.id !== 'pf5'),
    { id: 'pf3b', source: 'fetch', target: 'draft-advisory', priority: 1, isDefault: false },
    { id: 'pf5b', source: 'draft-advisory', target: 'legal-review', priority: 0, isDefault: false },
    { id: 'pf7', source: 'legal-review', target: 'join', priority: 0, isDefault: false },
  ],
};

export const workflowDiffScenarios: WorkflowDiffScenario[] = [
  {
    key: 'semantic-and-cosmetic',
    label: 'Semantic + Cosmetic',
    baseWorkflow: cveTriageSemanticAndCosmeticBase,
    compareWorkflow: cveTriageSemanticAndCosmeticCompare,
  },
  {
    key: 'add-remove',
    label: 'Add + Remove',
    baseWorkflow: addRemoveBase,
    compareWorkflow: addRemoveCompare,
  },
  {
    key: 'linear-major-revision',
    label: 'Linear Major Revision',
    baseWorkflow: linearMajorRevisionBase,
    compareWorkflow: linearMajorRevisionCompare,
  },
  {
    key: 'fork-join-major-revision',
    label: 'Fork/Join Major Revision',
    baseWorkflow: forkJoinMajorRevisionBase,
    compareWorkflow: forkJoinMajorRevisionCompare,
  },
];
