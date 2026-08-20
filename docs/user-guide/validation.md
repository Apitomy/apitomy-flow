# Validation

The engine provides a `WorkflowValidator` that checks workflow definitions for structural and
semantic problems before execution. The same rules are implemented in TypeScript for real-time
validation in the visual editor.

## Usage

### Java

```java
WorkflowValidator validator = new WorkflowValidator();
List<ValidationProblem> problems = validator.validate(workflow);

boolean hasErrors = validator.hasErrors(problems);
```

### TypeScript

```typescript
import { validateWorkflow } from '@apitomy/flow-ui';

const problems = validateWorkflow(workflow);
const hasErrors = problems.some(p => p.severity === 'error');
```

## Severity Levels

| Severity | Meaning |
|----------|---------|
| **ERROR** | The workflow cannot execute. Must be fixed. |
| **WARNING** | The workflow can execute but the definition is likely wrong. |

`startWorkflow` automatically validates the definition and rejects workflows with ERROR-level
problems.

## Validation Rules

### Structural (ERROR)

| Code | Rule |
|------|------|
| `EMPTY_WORKFLOW` | Workflow has no nodes at all |
| `MISSING_WORKFLOW_ID` | Workflow has no ID (null or blank) |
| `MISSING_WORKFLOW_NAME` | Workflow has no name (null or blank) |
| `MISSING_NODE_ID` | Node has no ID (null or blank) |
| `MISSING_EDGE_ID` | Edge has no ID (null or blank) |
| `NO_START_NODE` | Exactly one start node is required |
| `MULTIPLE_START_NODES` | More than one start node found |
| `NO_END_NODE` | At least one end node is required |
| `INVALID_EDGE_SOURCE` | Edge references a source node ID that doesn't exist |
| `INVALID_EDGE_TARGET` | Edge references a target node ID that doesn't exist |
| `DUPLICATE_NODE_ID` | Two or more nodes share the same ID |
| `DUPLICATE_EDGE_ID` | Two or more edges share the same ID |
| `START_HAS_INCOMING` | Start node must not have incoming edges |
| `END_HAS_OUTGOING` | End node must not have outgoing edges |
| `MISSING_ACTION_TYPE` | Action node has no `actionType` in its config |
| `INVALID_ACTION_TYPE_VALUE` | Action node `actionType` is present but not a non-blank string |
| `INVALID_WAIT_DURATION` | Wait node `duration` is present but not a valid ISO 8601 duration |

### Structural (WARNING)

| Code | Rule |
|------|------|
| `MISSING_NODE_NAME` | Node has no name (null or blank) |

### Connectivity (ERROR / WARNING)

| Code | Severity | Rule |
|------|----------|------|
| `DISCONNECTED_NODE` | ERROR | Node has no incoming or outgoing edges (completely isolated) |
| `NO_OUTGOING_EDGES` | ERROR | Non-end node has no outgoing edges (execution would stall) |
| `NO_INCOMING_EDGES` | WARNING | Non-start node has no incoming edges (unreachable) |
| `UNREACHABLE_NODE` | WARNING | Node cannot be reached from the start node |
| `NO_PATH_TO_END` | WARNING | Node has no path to any end node |

### Edge / Condition (WARNING)

| Code | Rule |
|------|------|
| `SELF_LOOP_EDGE` | Edge connects a node to itself |
| `DUPLICATE_EDGE` | Multiple edges share the same source and target |
| `DEFAULT_EDGE_WITH_CONDITION` | Default edge has a condition that will never be evaluated |
| `SINGLE_CONDITIONAL_EDGE` | Node has a single outgoing edge with a condition but no fallback |
| `NO_DEFAULT_EDGE` | Node has multiple conditional edges but no default fallback |
| `MULTIPLE_DEFAULT_EDGES` | Node has more than one default edge |
| `INVALID_CONDITION` | Edge condition is not syntactically valid EL (Java only) |
| `DUPLICATE_EDGE_PRIORITY` | Multiple edges from the same node share the same priority |

### Semantic (WARNING)

| Code | Rule |
|------|------|
| `DUPLICATE_EVENT_RECEIVER` | Multiple receive-event nodes match the same events |
| `MISSING_EVENT_TYPE` | Receive-event node has no `eventType` configured |
| `INVALID_EVENT_TYPE_VALUE` | Receive-event node `eventType` is not a non-blank string |
| `UNCONDITIONAL_MULTIPLE_EDGES` | Node has multiple outgoing edges with no conditions |
| `AUTOMATED_CYCLE` | Cycle containing only action nodes (could cause infinite execution) |
| `MISSING_START_INPUTS` | Start node has no inputs defined |
| `INVALID_INPUT_DEFINITION` | Start node input entry is missing a name |
| `DUPLICATE_INPUT_NAME` | Start node has multiple inputs with the same name |
| `MISSING_ACTION_INPUTS` | Action node has no inputs defined |
| `INVALID_INPUTS_TYPE` | Action node `inputs` is present but not a Map |
| `MISSING_ACTION_OUTPUTS` | Action node has no outputs defined |
| `INVALID_OUTPUTS_TYPE` | Action node `outputs` is present but not a List |
| `DUPLICATE_OUTPUT_NAME` | Action or human-task node has duplicate output names |
| `EMPTY_ACTION_INPUT_EXPRESSION` | Action node input has an empty or blank EL expression |
| `MISSING_TASK_DESCRIPTION` | Human task node has no description |
| `MISSING_TASK_OUTPUTS` | Human task node has no outputs defined |
| `EMPTY_TASK_INPUT_EXPRESSION` | Human task input has an empty or blank EL expression |
| `MISSING_WAIT_DURATION` | Wait node has no duration configured |

## ValidationProblem

```java
public record ValidationProblem(
    ValidationSeverity severity,  // ERROR or WARNING
    String code,                  // machine-readable code (e.g. "NO_START_NODE")
    String message,               // human-readable description
    String nodeId,                // affected node (optional)
    String edgeId                 // affected edge (optional)
) {}
```

## TypeScript Validator Notes

The TypeScript implementation covers all rules except `INVALID_CONDITION`, which requires parsing
Jakarta EL expressions (a Java library). All other rules are structural or semantic checks that
work identically in both languages.
