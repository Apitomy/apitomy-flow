import { type Workflow, type WorkflowEdge } from '../types/workflow.ts';
import { type ValidationProblem, type ValidationSeverity } from '../types/validation.ts';

function problem(severity: ValidationSeverity, code: string, message: string, nodeId?: string, edgeId?: string): ValidationProblem {
  return { severity, code, message, nodeId, edgeId };
}

export function validateWorkflow(workflow: Workflow): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  validateStructure(workflow, problems);
  validateConnectivity(workflow, problems);
  validateEdgeConditions(workflow, problems);
  validateSemantics(workflow, problems);
  return problems;
}

function validateStructure(workflow: Workflow, problems: ValidationProblem[]) {
  const { nodes, edges } = workflow;
  const nodeIds = new Set<string>();

  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      problems.push(problem('error', 'DUPLICATE_NODE_ID', `Duplicate node ID: ${node.id}`, node.id));
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      problems.push(problem('error', 'DUPLICATE_EDGE_ID', `Duplicate edge ID: ${edge.id}`, undefined, edge.id));
    }
    edgeIds.add(edge.id);
  }

  const startNodes = nodes.filter(n => n.type === 'start');
  if (startNodes.length === 0) {
    problems.push(problem('error', 'NO_START_NODE', 'No start node found'));
  } else if (startNodes.length > 1) {
    problems.push(problem('error', 'MULTIPLE_START_NODES', `Found ${startNodes.length} start nodes`));
  }

  if (!nodes.some(n => n.type === 'end')) {
    problems.push(problem('error', 'NO_END_NODE', 'No end node found'));
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      problems.push(problem('error', 'INVALID_EDGE_SOURCE', `Edge ${edge.id} references nonexistent source: ${edge.source}`, undefined, edge.id));
    }
    if (!nodeIds.has(edge.target)) {
      problems.push(problem('error', 'INVALID_EDGE_TARGET', `Edge ${edge.id} references nonexistent target: ${edge.target}`, undefined, edge.id));
    }
  }

  for (const start of startNodes) {
    if (edges.some(e => e.target === start.id)) {
      problems.push(problem('error', 'START_HAS_INCOMING', 'Start node must not have incoming edges', start.id));
    }
  }

  for (const end of nodes.filter(n => n.type === 'end')) {
    if (edges.some(e => e.source === end.id)) {
      problems.push(problem('error', 'END_HAS_OUTGOING', 'End node must not have outgoing edges', end.id));
    }
  }

  for (const action of nodes.filter(n => n.type === 'action')) {
    if (!action.config.actionType) {
      problems.push(problem('error', 'MISSING_ACTION_TYPE', 'Action node missing actionType in config', action.id));
    }
  }
}

function validateConnectivity(workflow: Workflow, problems: ValidationProblem[]) {
  const { nodes, edges } = workflow;

  for (const node of nodes) {
    const incoming = edges.filter(e => e.target === node.id);
    const outgoing = edges.filter(e => e.source === node.id);

    if (node.type !== 'start' && incoming.length === 0 && outgoing.length === 0) {
      problems.push(problem('error', 'DISCONNECTED_NODE', 'Node is completely disconnected', node.id));
      continue;
    }

    if (node.type !== 'end' && outgoing.length === 0) {
      problems.push(problem('error', 'NO_OUTGOING_EDGES', 'Non-end node has no outgoing edges', node.id));
    }

    if (node.type !== 'start' && incoming.length === 0) {
      problems.push(problem('warning', 'NO_INCOMING_EDGES', 'Node has no incoming edges — unreachable', node.id));
    }
  }

  const startNode = nodes.find(n => n.type === 'start');
  if (startNode) {
    const reachable = new Set<string>();
    const queue = [startNode.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const edge of edges.filter(e => e.source === current)) {
        queue.push(edge.target);
      }
    }

    for (const node of nodes) {
      if (!reachable.has(node.id) && node.type !== 'start') {
        problems.push(problem('warning', 'UNREACHABLE_NODE', 'Node cannot be reached from start', node.id));
      }
    }

    const canReachEnd = new Set<string>();
    const endNodes = nodes.filter(n => n.type === 'end');
    const reverseQueue = endNodes.map(n => n.id);
    for (const id of reverseQueue) canReachEnd.add(id);
    while (reverseQueue.length > 0) {
      const current = reverseQueue.shift()!;
      for (const edge of edges.filter(e => e.target === current)) {
        if (!canReachEnd.has(edge.source)) {
          canReachEnd.add(edge.source);
          reverseQueue.push(edge.source);
        }
      }
    }

    for (const node of nodes) {
      if (reachable.has(node.id) && !canReachEnd.has(node.id) && node.type !== 'end') {
        problems.push(problem('warning', 'NO_PATH_TO_END', 'Node has no path to any end node', node.id));
      }
    }
  }
}

function validateEdgeConditions(workflow: Workflow, problems: ValidationProblem[]) {
  const edgesBySource = new Map<string, WorkflowEdge[]>();
  for (const edge of workflow.edges) {
    const list = edgesBySource.get(edge.source) || [];
    list.push(edge);
    edgesBySource.set(edge.source, list);
  }

  for (const [sourceId, outgoing] of edgesBySource) {
    if (outgoing.length <= 1) continue;

    const defaults = outgoing.filter(e => e.isDefault);
    if (defaults.length > 1) {
      problems.push(problem('warning', 'MULTIPLE_DEFAULT_EDGES', 'Node has multiple default edges', sourceId));
    }

    const hasConditional = outgoing.some(e => e.condition && e.condition.trim() !== '');
    if (hasConditional && defaults.length === 0) {
      problems.push(problem('warning', 'NO_DEFAULT_EDGE', 'Node has conditional edges but no default fallback', sourceId));
    }

    const allUnconditional = outgoing.every(e => !e.condition || e.condition.trim() === '');
    if (allUnconditional && defaults.length === 0) {
      problems.push(problem('warning', 'UNCONDITIONAL_MULTIPLE_EDGES', 'Node has multiple outgoing edges with no conditions', sourceId));
    }

    const priorityCounts = new Map<number, number>();
    for (const edge of outgoing) {
      priorityCounts.set(edge.priority, (priorityCounts.get(edge.priority) || 0) + 1);
    }
    for (const [priority, count] of priorityCounts) {
      if (count > 1) {
        problems.push(problem('warning', 'DUPLICATE_EDGE_PRIORITY', `Multiple edges from node ${sourceId} share priority ${priority}`, undefined, sourceId));
      }
    }
  }
}

function validateSemantics(workflow: Workflow, problems: ValidationProblem[]) {
  for (const node of workflow.nodes.filter(n => n.type === 'receive-event')) {
    if (!node.config.eventType) {
      problems.push(problem('warning', 'MISSING_EVENT_TYPE', 'Receive-event node has no eventType configured', node.id));
    }
  }

  const receivers = workflow.nodes.filter(n => n.type === 'receive-event' && n.config.eventType);
  for (let i = 0; i < receivers.length; i++) {
    for (let j = i + 1; j < receivers.length; j++) {
      if (receivers[i].config.eventType === receivers[j].config.eventType &&
          JSON.stringify(receivers[i].config.match) === JSON.stringify(receivers[j].config.match)) {
        problems.push(problem('warning', 'DUPLICATE_EVENT_RECEIVER', 'Multiple receive-event nodes match the same events', receivers[j].id));
      }
    }
  }

  const startNode = workflow.nodes.find(n => n.type === 'start');
  if (startNode && !startNode.config.inputs) {
    problems.push(problem('warning', 'MISSING_START_INPUTS', 'Start node has no inputs defined', startNode.id));
  }

  detectAutomatedCycles(workflow, problems);
}

function detectAutomatedCycles(workflow: Workflow, problems: ValidationProblem[]) {
  const actionNodeIds = new Set(workflow.nodes.filter(n => n.type === 'action').map(n => n.id));
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const edge of workflow.edges.filter(e => e.source === nodeId)) {
      if (!actionNodeIds.has(edge.target)) continue;
      if (inStack.has(edge.target)) return true;
      if (!visited.has(edge.target) && dfs(edge.target)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }

  for (const nodeId of actionNodeIds) {
    if (!visited.has(nodeId) && dfs(nodeId)) {
      problems.push(problem('warning', 'AUTOMATED_CYCLE', 'Cycle detected containing only action nodes', nodeId));
      return;
    }
  }
}
