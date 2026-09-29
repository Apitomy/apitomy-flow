import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';

const nodeTypes = new Set(['start', 'end', 'action', 'human-task', 'receive-event', 'wait']);

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '';
}

/** Checks built-in wire fields before any semantic traversal; unknown host fields are retained verbatim. */
export function normalizeWorkflow(raw: unknown): {
    workflow?: Workflow;
    problems: ValidationProblem[];
    needsLayout?: boolean;
} {
    const problems: ValidationProblem[] = [];
    const check = (valid: boolean, code: string, path: string, expected: string, nodeId?: string, edgeId?: string) => {
        if (!valid) problems.push({ severity: 'error', code, message: `${path} must be ${expected}`, nodeId, edgeId });
    };
    if (!isObject(raw)) {
        check(false, 'INVALID_WORKFLOW', 'Workflow', 'an object');
        return { problems };
    }
    check(typeof raw.id === 'string', 'MISSING_WORKFLOW_ID', 'id', 'a string');
    check(typeof raw.name === 'string', 'MISSING_WORKFLOW_NAME', 'name', 'a string');
    check(raw.description == null || typeof raw.description === 'string', 'INVALID_WORKFLOW_DESCRIPTION', 'description', 'a string');
    check(raw.version == null || (Number.isInteger(raw.version) && Number(raw.version) >= -2147483648
        && Number(raw.version) <= 2147483647), 'INVALID_WORKFLOW_VERSION', 'version', 'a 32-bit integer');
    check(Array.isArray(raw.nodes), 'INVALID_NODES', 'nodes', 'an array');
    check(Array.isArray(raw.edges), 'INVALID_EDGES', 'edges', 'an array');
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return { problems };

    for (const [index, node] of raw.nodes.entries()) {
        const path = `nodes[${index}]`;
        if (!isObject(node)) {
            check(false, 'INVALID_NODE', path, 'an object');
            continue;
        }
        const nodeId = typeof node.id === 'string' ? node.id : undefined;
        const field = (valid: boolean, code: string, suffix: string, expected: string) =>
            check(valid, code, `${path}.${suffix}`, expected, nodeId);
        field(nonBlank(node.id), 'MISSING_NODE_ID', 'id', 'a non-blank string');
        field(typeof node.type === 'string' && nodeTypes.has(node.type), 'INVALID_NODE_TYPE', 'type', 'a supported node kind');
        field(node.name == null || typeof node.name === 'string', 'INVALID_NODE_NAME', 'name', 'a string');
        field(node.config == null || isObject(node.config), 'INVALID_NODE_CONFIG', 'config', 'an object');
        field(node.position == null || (isObject(node.position)
            && typeof node.position.x === 'number' && Number.isFinite(node.position.x)
            && typeof node.position.y === 'number' && Number.isFinite(node.position.y)),
        'INVALID_NODE_POSITION', 'position', 'an object with finite numeric x and y');
        const config = isObject(node.config) ? node.config : {};
        const optionalString = (key: string, code: string) => field(config[key] == null || typeof config[key] === 'string',
            code, `config.${key}`, 'a string');
        if (node.type === 'action') optionalString('actionType', 'INVALID_ACTION_TYPE_VALUE');
        if (node.type === 'human-task') optionalString('description', 'INVALID_TASK_DESCRIPTION');
        if (node.type === 'wait') optionalString('duration', 'INVALID_WAIT_DURATION');
        if (node.type === 'receive-event') {
            optionalString('eventType', 'INVALID_EVENT_TYPE_VALUE');
            field(config.match == null || (Array.isArray(config.match) && config.match.every(item => typeof item === 'string')),
                'INVALID_MATCH_TYPE', 'config.match', 'an array of strings');
        }
        if (node.type === 'action' || node.type === 'human-task') {
            field(config.inputs == null || isObject(config.inputs), 'INVALID_INPUTS_TYPE', 'config.inputs', 'an object');
        }

        const definitions = (key: string, code: string, eventMappings = false) => {
            const value = config[key];
            if (value == null) return;
            field(Array.isArray(value), key === 'inputs' ? 'INVALID_INPUTS_TYPE' : 'INVALID_OUTPUTS_TYPE',
                `config.${key}`, 'an array');
            if (!Array.isArray(value)) return;
            for (const [i, entry] of value.entries()) {
                const entryPath = `config.${key}[${i}]`;
                if (!isObject(entry)) {
                    field(false, eventMappings ? 'MISSING_OUTPUT_CONTEXT_KEY' : code, entryPath, 'an object');
                    continue;
                }
                if (eventMappings) {
                    field(entry.contextKey == null || typeof entry.contextKey === 'string',
                        'MISSING_OUTPUT_CONTEXT_KEY', `${entryPath}.contextKey`, 'a string');
                    field(entry.expression == null || typeof entry.expression === 'string',
                        'MISSING_OUTPUT_EXPRESSION', `${entryPath}.expression`, 'a string');
                    continue;
                }
                field(typeof entry.name === 'string', code, `${entryPath}.name`, 'a string');
                for (const key of ['type', 'description', 'label', 'widget', 'contextKey']) {
                    field(entry[key] == null || typeof entry[key] === 'string', code, `${entryPath}.${key}`, 'a string');
                }
                field(entry.required == null || typeof entry.required === 'boolean', code, `${entryPath}.required`, 'a boolean');
                field(entry.options == null || Array.isArray(entry.options), code, `${entryPath}.options`, 'an array');
                if (Array.isArray(entry.options)) {
                    for (const [j, option] of entry.options.entries()) {
                        field(isObject(option) && (option.label == null || typeof option.label === 'string')
                            && (option.value == null || typeof option.value === 'string'),
                        'MALFORMED_OUTPUT_OPTION', `${entryPath}.options[${j}]`, 'an object with string label/value');
                    }
                }
            }
        };
        if (node.type === 'start') definitions('inputs', 'INVALID_INPUT_DEFINITION');
        if (node.type === 'action' || node.type === 'human-task' || node.type === 'receive-event') {
            definitions('outputs', 'INVALID_OUTPUT_DEFINITION', node.type === 'receive-event');
        }
    }

    for (const [index, edge] of raw.edges.entries()) {
        const path = `edges[${index}]`;
        if (!isObject(edge)) {
            check(false, 'INVALID_EDGE', path, 'an object');
            continue;
        }
        const edgeId = typeof edge.id === 'string' ? edge.id : undefined;
        const field = (valid: boolean, code: string, key: string, expected: string) =>
            check(valid, code, `${path}.${key}`, expected, undefined, edgeId);
        field(nonBlank(edge.id), 'MISSING_EDGE_ID', 'id', 'a non-blank string');
        field(nonBlank(edge.source), 'MISSING_EDGE_SOURCE', 'source', 'a non-blank string');
        field(nonBlank(edge.target), 'MISSING_EDGE_TARGET', 'target', 'a non-blank string');
        field(edge.condition == null || typeof edge.condition === 'string', 'INVALID_EDGE_CONDITION', 'condition', 'a string');
        field(edge.label == null || typeof edge.label === 'string', 'INVALID_EDGE_LABEL', 'label', 'a string');
        field(edge.priority == null || (Number.isInteger(edge.priority) && Number(edge.priority) >= -2147483648
            && Number(edge.priority) <= 2147483647), 'INVALID_EDGE_PRIORITY', 'priority', 'a 32-bit integer');
        field(edge.isDefault == null || typeof edge.isDefault === 'boolean', 'INVALID_EDGE_DEFAULT', 'isDefault', 'a boolean');
    }
    if (problems.length > 0) return { problems };

    // All built-in fields are checked above. Spread rather than reconstruct to retain host extensions.
    const nodes = raw.nodes as Record<string, unknown>[];
    const edges = raw.edges as Record<string, unknown>[];
    const workflow = {
        ...raw,
        nodes: nodes.map(node => ({ ...node, name: node.name ?? '', config: node.config ?? {},
            position: node.position ?? { x: 0, y: 0 } })),
        edges: edges.map(edge => ({ ...edge, priority: edge.priority ?? 0, isDefault: edge.isDefault ?? false })),
    } as Workflow;
    return { workflow, problems, needsLayout: nodes.some(node => node.position == null) };
}
