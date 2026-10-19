import { createElement } from 'react';
import { EnvelopeIcon, GlobeIcon, BugIcon, TicketAltIcon, SearchIcon } from '@patternfly/react-icons';
import { type ActionTypeDescriptor, type WorkflowValidator } from '../types/spi.ts';
import { type ValidationProblem } from '../types/validation.ts';

// Demo host catalog. 'plan-mitigation' is deliberately missing so the CVE Triage scenarios show an
// unresolved Action Type.
export const demoCatalog: ActionTypeDescriptor[] = [
  {
    value: 'send-email',
    icon: createElement(EnvelopeIcon),
    color: '#c9190b',
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
    icon: createElement(GlobeIcon),
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
    icon: createElement(BugIcon),
    color: '#8476d1',
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
    icon: createElement(TicketAltIcon),
    color: '#f0ab00',
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
  {
    value: 'analyze-cve',
    icon: createElement(SearchIcon),
    color: '#009596',
    label: 'Analyze CVE',
    description: 'Analyze a CVE to determine its severity and affected versions',
    inputs: [
      { name: 'CVE ID', type: 'string', required: true, description: 'CVE identifier (e.g. CVE-2024-1234)' },
    ],
    outputs: [
      { name: 'severity', type: 'string', required: true },
      { name: 'affectedVersions', type: 'string', required: false },
    ],
  },
  {
    value: 'close-tracker',
    label: 'Close Tracker',
    description: 'Close the vulnerability tracking issue with the triage notes',
    inputs: [
      { name: 'CVE ID', type: 'string', required: true },
      { name: 'Triage Notes', type: 'string', required: false },
    ],
    outputs: [
      { name: 'closedAt', type: 'string', required: true },
    ],
  },
];

/**
 * Creates the demo host's validator: Action Types must be in the given catalog, plus a name-length rule
 * behind simulated backend latency.
 *
 * @param catalog the host catalog to validate against
 * @returns a host validator for `spi.validate`
 */
export function createHostValidator(catalog: ActionTypeDescriptor[]): WorkflowValidator {
  return async (wf): Promise<ValidationProblem[]> => {
    const problems: ValidationProblem[] = [];
    const known = new Set(catalog.map(descriptor => descriptor.value));

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
  };
}
