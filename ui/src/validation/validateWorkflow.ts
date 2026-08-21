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

  // Workflow identity
  if (!workflow.id || workflow.id.trim() === '') {
    problems.push(problem('error', 'MISSING_WORKFLOW_ID', 'Workflow has no ID'));
  }
  if (!workflow.name || workflow.name.trim() === '') {
    problems.push(problem('error', 'MISSING_WORKFLOW_NAME', 'Workflow has no name'));
  }

  // Empty workflow
  if (nodes.length === 0) {
    problems.push(problem('error', 'EMPTY_WORKFLOW', 'Workflow has no nodes'));
    return;
  }

  // Node ID validation
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node.id || node.id.trim() === '') {
      problems.push(problem('error', 'MISSING_NODE_ID', 'Node has no ID'));
      continue;
    }
    if (!node.name || node.name.trim() === '') {
      problems.push(problem('warning', 'MISSING_NODE_NAME', 'Node has no name', node.id));
    }
    if (nodeIds.has(node.id)) {
      problems.push(problem('error', 'DUPLICATE_NODE_ID', `Duplicate node ID: ${node.id}`, node.id));
    }
    nodeIds.add(node.id);
  }

  // Edge ID validation
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!edge.id || edge.id.trim() === '') {
      problems.push(problem('error', 'MISSING_EDGE_ID', 'Edge has no ID', undefined, undefined));
      continue;
    }
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
    if (edge.source && !nodeIds.has(edge.source)) {
      problems.push(problem('error', 'INVALID_EDGE_SOURCE', `Edge ${edge.id} references nonexistent source: ${edge.source}`, undefined, edge.id));
    }
    if (edge.target && !nodeIds.has(edge.target)) {
      problems.push(problem('error', 'INVALID_EDGE_TARGET', `Edge ${edge.id} references nonexistent target: ${edge.target}`, undefined, edge.id));
    }
  }

  // Self-loop edges
  for (const edge of edges) {
    if (edge.source && edge.source === edge.target) {
      problems.push(problem('warning', 'SELF_LOOP_EDGE', `Edge connects a node to itself: ${edge.source}`, undefined, edge.id));
    }
  }

  // Duplicate edges (same source and target)
  const edgePairs = new Set<string>();
  for (const edge of edges) {
    if (edge.source && edge.target) {
      const pair = `${edge.source}->${edge.target}`;
      if (edgePairs.has(pair)) {
        problems.push(problem('warning', 'DUPLICATE_EDGE', `Duplicate edge from ${edge.source} to ${edge.target}`, undefined, edge.id));
      }
      edgePairs.add(pair);
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

  // Action node config validation
  for (const action of nodes.filter(n => n.type === 'action')) {
    const actionTypeVal = action.config.actionType;
    if (actionTypeVal === undefined || actionTypeVal === null) {
      problems.push(problem('error', 'MISSING_ACTION_TYPE', 'Action node missing actionType in config', action.id));
    } else if (typeof actionTypeVal !== 'string' || actionTypeVal.trim() === '') {
      problems.push(problem('error', 'INVALID_ACTION_TYPE_VALUE', 'Action node actionType must be a non-blank string', action.id));
    }

    const inputsVal = action.config.inputs;
    if (inputsVal === undefined || inputsVal === null) {
      problems.push(problem('warning', 'MISSING_ACTION_INPUTS', 'Action node has no inputs defined', action.id));
    } else if (typeof inputsVal !== 'object' || Array.isArray(inputsVal)) {
      problems.push(problem('warning', 'INVALID_INPUTS_TYPE', 'Action node inputs must be a Map', action.id));
    } else {
      const inputs = inputsVal as Record<string, string>;
      for (const [name, expr] of Object.entries(inputs)) {
        if (!expr || expr.trim() === '') {
          problems.push(problem('warning', 'EMPTY_ACTION_INPUT_EXPRESSION',
            `Action node input "${name}" has no EL expression`, action.id));
        }
      }
    }

    const outputsVal = action.config.outputs;
    if (outputsVal === undefined || outputsVal === null) {
      problems.push(problem('warning', 'MISSING_ACTION_OUTPUTS', 'Action node has no outputs defined', action.id));
    } else if (!Array.isArray(outputsVal)) {
      problems.push(problem('warning', 'INVALID_OUTPUTS_TYPE', 'Action node outputs must be a List', action.id));
    } else {
      validateOutputNames(outputsVal, action.id, problems);
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
    // Default edge with condition (check all edges, even single)
    for (const edge of outgoing) {
      if (edge.isDefault && edge.condition && edge.condition.trim() !== '') {
        problems.push(problem('warning', 'DEFAULT_EDGE_WITH_CONDITION',
          'Default edge has a condition that will never be evaluated', undefined, edge.id));
      }
    }

    // Single conditional edge with no fallback
    if (outgoing.length === 1) {
      const only = outgoing[0];
      if (!only.isDefault && only.condition && only.condition.trim() !== '') {
        problems.push(problem('warning', 'SINGLE_CONDITIONAL_EDGE',
          'Node has a single outgoing edge with a condition but no fallback', sourceId));
      }
      continue;
    }

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
        problems.push(problem('warning', 'DUPLICATE_EDGE_PRIORITY', `Multiple edges from node ${sourceId} share priority ${priority}`, sourceId));
      }
    }
  }

  // Invalid EL conditions
  for (const edge of workflow.edges) {
    if (edge.condition && edge.condition.trim() !== '') {
      if (!isValidCondition(edge.condition)) {
        problems.push(problem('warning', 'INVALID_CONDITION',
          `Edge condition is not valid EL: ${edge.condition}`, undefined, edge.id));
      }
    }
  }
}

function validateSemantics(workflow: Workflow, problems: ValidationProblem[]) {
  // Event type validation on receive-event nodes
  for (const node of workflow.nodes.filter(n => n.type === 'receive-event')) {
    const eventTypeVal = node.config.eventType;
    if (eventTypeVal === undefined || eventTypeVal === null) {
      problems.push(problem('warning', 'MISSING_EVENT_TYPE', 'Receive-event node has no eventType configured', node.id));
    } else if (typeof eventTypeVal !== 'string' || eventTypeVal.trim() === '') {
      problems.push(problem('warning', 'INVALID_EVENT_TYPE_VALUE', 'Receive-event node eventType must be a non-blank string', node.id));
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

  // Human task node validation
  for (const node of workflow.nodes.filter(n => n.type === 'human-task')) {
    if (!node.config.description) {
      problems.push(problem('warning', 'MISSING_TASK_DESCRIPTION', 'Human task node has no description', node.id));
    }
    if (node.config.inputs && typeof node.config.inputs === 'object' && !Array.isArray(node.config.inputs)) {
      const inputs = node.config.inputs as Record<string, string>;
      for (const [name, expr] of Object.entries(inputs)) {
        if (!expr || expr.trim() === '') {
          problems.push(problem('warning', 'EMPTY_TASK_INPUT_EXPRESSION',
            `Human task input "${name}" has no EL expression`, node.id));
        }
      }
    }
    const outputsVal = node.config.outputs;
    if (outputsVal === undefined || outputsVal === null) {
      problems.push(problem('warning', 'MISSING_TASK_OUTPUTS', 'Human task node has no outputs defined', node.id));
    } else if (Array.isArray(outputsVal)) {
      validateOutputNames(outputsVal, node.id, problems);
    }
  }

  // Wait node duration validation
  for (const node of workflow.nodes.filter(n => n.type === 'wait')) {
    const durationVal = node.config.duration;
    if (durationVal === undefined || durationVal === null) {
      problems.push(problem('warning', 'MISSING_WAIT_DURATION', 'Wait node has no duration configured', node.id));
    } else if (typeof durationVal === 'string') {
      if (!isValidIsoDuration(durationVal)) {
        problems.push(problem('error', 'INVALID_WAIT_DURATION',
          `Wait node duration is not valid ISO 8601: ${durationVal}`, node.id));
      }
    }
  }

  // Start node input validation
  const startNode = workflow.nodes.find(n => n.type === 'start');
  if (startNode) {
    const inputsDef = startNode.config.inputs;
    if (inputsDef === undefined || inputsDef === null) {
      problems.push(problem('warning', 'MISSING_START_INPUTS', 'Start node has no inputs defined', startNode.id));
    } else if (Array.isArray(inputsDef)) {
      const inputNames = new Set<string>();
      for (const input of inputsDef) {
        if (typeof input === 'object' && input !== null) {
          const nameVal = (input as Record<string, unknown>).name;
          if (!nameVal || (typeof nameVal === 'string' && nameVal.trim() === '')) {
            problems.push(problem('warning', 'INVALID_INPUT_DEFINITION',
              'Start node input is missing a name', startNode.id));
          } else {
            const name = String(nameVal);
            if (inputNames.has(name)) {
              problems.push(problem('warning', 'DUPLICATE_INPUT_NAME',
                `Start node has duplicate input name: ${name}`, startNode.id));
            }
            inputNames.add(name);
          }
        }
      }
    }
  }

  detectAutomatedCycles(workflow, problems);
}

function validateOutputNames(outputDefs: unknown[], nodeId: string, problems: ValidationProblem[]) {
  const outputNames = new Set<string>();
  for (const defObj of outputDefs) {
    if (typeof defObj === 'object' && defObj !== null) {
      const nameVal = (defObj as Record<string, unknown>).name;
      if (nameVal !== undefined && nameVal !== null) {
        const name = String(nameVal);
        if (outputNames.has(name)) {
          problems.push(problem('warning', 'DUPLICATE_OUTPUT_NAME',
            `Duplicate output name: ${name}`, nodeId));
        }
        outputNames.add(name);
      }
    }
  }
}

function isValidIsoDuration(value: string): boolean {
  // Match java.time.Duration.parse() which only supports days-and-time (PnDTnHnMnS)
  return /^P(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/.test(value)
    && value !== 'P' && value !== 'PT'
    && !/T$/.test(value);
}

function isValidCondition(expression: string): boolean {
  let parenDepth = 0;
  let bracketDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];

    if (inSingleQuote) {
      if (ch === "'" && expression[i - 1] !== '\\') inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === '"' && expression[i - 1] !== '\\') inDoubleQuote = false;
      continue;
    }

    switch (ch) {
      case "'": inSingleQuote = true; break;
      case '"': inDoubleQuote = true; break;
      case '(': parenDepth++; break;
      case ')': parenDepth--; break;
      case '[': bracketDepth++; break;
      case ']': bracketDepth--; break;
    }

    if (parenDepth < 0 || bracketDepth < 0) return false;
  }

  return !inSingleQuote && !inDoubleQuote && parenDepth === 0 && bracketDepth === 0;
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
