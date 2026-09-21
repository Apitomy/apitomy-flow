# Validation

The engine provides a `WorkflowValidator` that checks workflow definitions for structural and
semantic problems before execution. TypeScript implements corresponding browser checks with intentional
expression/duration differences. Neither a manual rule count nor schema validity proves executability.

## Authoritative sources

Inspect these paths at the same revision as the artifacts you run:

- Java: `engine/src/main/java/io/apitomy/flow/validation/WorkflowShape.java`, `WorkflowValidator.java`,
  and `engine/src/main/java/io/apitomy/flow/engine/ParallelRegions.java`.
- Browser: `ui/src/validation/workflowShape.ts`, `validateWorkflow.ts`, and
  `ui/src/simulation/parallelRegions.ts`.
- Executable shared expectations: `conformance/validation.json`, `config-invalid-v1.json`,
  `parallel-topology.json`, and `expressions.json`.

The [repository](https://github.com/Apitomy/apitomy-flow) is the source authority; select the relevant
branch/tag when browsing it. [Documentation checks](../developer-guide/documentation-checks.md) execute
the fixtures. We intentionally do not maintain a numeric total: codes can be reused by shape/semantic
checks, some have multiple severities, and full-EL/browser boundaries are not identical.

## Usage

### Java

```java
WorkflowValidator validator = new WorkflowValidator();
List<ValidationProblem> problems = validator.validate(workflow);

boolean hasErrors = validator.hasErrors(problems);
```

### TypeScript

```typescript
import { parseWorkflow } from '@apitomy/flow-ui';

const { workflow, problems, error } = parseWorkflow(jsonText);
const hasErrors = problems.some(p => p.severity === 'error');
if (workflow && !error && !hasErrors) {
    // Accepted and normalized for browser use; Java start still validates before execution.
}
```

`jsonText` is the JSON string supplied by your host. `parseWorkflow` is a package-root export;
`validateWorkflow` is currently internal. For a mounted editor, receive merged built-in/host results
through `onValidationChange`. The `WorkflowValidator` TypeScript export is an SPI function **type**, not
the Java class or a callable built-in validator.

## Severity Levels

| Severity | Meaning |
|----------|---------|
| **ERROR** | Definition rejected at this validation boundary; fix before importing/starting |
| **WARNING** | Advisory; may still fail at runtime or require Java validation |

`startWorkflow` automatically validates the definition and rejects workflows with ERROR-level
problems.

## Validation Rules

The tables below summarize diagnostic families; the sources above define exact conditions and severity.

### Shape preflight (ERROR)

Preflight runs before semantic traversal. It checks workflow/node/edge objects, node kinds, IDs and edge
endpoints, finite positions, built-in config field types, declaration lists/entries, metadata/options,
and receive-event match/mapping structures. Null optional config fields retain their documented defaults.
Browser import also checks outer JSON types that Java's record/Jackson binding handles before validation.
If preflight finds errors, semantic checks do not run on the malformed data.

Examples include `INVALID_WORKFLOW`, `INVALID_NODE`, `INVALID_EDGE`, `INVALID_NODE_TYPE`,
`INVALID_NODE_POSITION`, `INVALID_INPUTS_TYPE`, `INVALID_OUTPUTS_TYPE`, `INVALID_INPUT_DEFINITION`,
`INVALID_OUTPUT_DEFINITION`, `INVALID_TASK_DESCRIPTION`, and `INVALID_MATCH_TYPE`. Browser outer-field
checks additionally include `INVALID_NODES`, `INVALID_EDGES`, `INVALID_NODE_CONFIG`, `INVALID_NODE_NAME`,
`INVALID_WORKFLOW_DESCRIPTION`, `INVALID_WORKFLOW_VERSION`, and edge field-type diagnostics.
Some codes in later tables can therefore be errors for malformed types and warnings for missing values.

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
| `MISSING_EDGE_SOURCE` | Edge has no source node ID (null or blank); checked in both runtimes |
| `MISSING_EDGE_TARGET` | Edge has no target node ID (null or blank); checked in both runtimes |
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
| `INVALID_CONDITION` | Edge condition is not syntactically valid EL |
| `DUPLICATE_EDGE_PRIORITY` | Multiple edges from the same node share the same priority |

### Semantic (WARNING)

| Code | Rule |
|------|------|
| `DUPLICATE_EVENT_RECEIVER` | Multiple receive-event nodes match the same events |
| `MISSING_EVENT_TYPE` | Receive-event node has no `eventType` configured |
| `INVALID_EVENT_TYPE_VALUE` | Receive-event node `eventType` is not a non-blank string |
| `AUTOMATED_CYCLE` | Cycle containing only action nodes (could cause infinite execution) |
| `MISSING_START_INPUTS` | Start node has no inputs defined |
| `INVALID_INPUT_DEFINITION` | Start node input entry is missing a name |
| `DUPLICATE_INPUT_NAME` | Start node has multiple inputs with the same name |
| `MISSING_ACTION_INPUTS` | Action node has no inputs defined |
| `MISSING_ACTION_OUTPUTS` | Action node has no outputs defined |
| `DUPLICATE_OUTPUT_NAME` | Action or human-task node has duplicate output names |
| `EMPTY_ACTION_INPUT_EXPRESSION` | Action node input has an empty or blank EL expression |
| `MISSING_TASK_DESCRIPTION` | Human task node has no description |
| `MISSING_TASK_OUTPUTS` | Human task node has no outputs defined |
| `EMPTY_TASK_INPUT_EXPRESSION` | Human task input has an empty or blank EL expression |
| `MISSING_WAIT_DURATION` | Wait node has no duration configured |
| `UNSUPPORTED_EXPRESSION_DIALECT` | Browser-only: expression uses syntax outside the supported subset; validate with Java |
| `WIDGET_TYPE_MISMATCH` | Human-task output declares a `widget` but its `type` is not `string` (widgets apply to string outputs) |
| `SELECT_MISSING_OPTIONS` | Human-task output uses `widget: select` but declares no options |
| `MALFORMED_OUTPUT_OPTION` | Human-task output has a `select` option with no value |
| `DEFAULT_VALUE_TYPE_MISMATCH` | Human-task output `defaultValue` does not match the declared `type` |

### Receive-event output mappings

| Code | Severity | Rule |
|---|---|---|
| `MISSING_OUTPUT_CONTEXT_KEY` | WARNING / shape ERROR | Missing/blank target key, or malformed key/entry type |
| `MISSING_OUTPUT_EXPRESSION` | WARNING / shape ERROR | Missing/blank expression, or malformed expression type |
| `INVALID_OUTPUT_EXPRESSION` | ERROR | Invalid expression syntax (browser subset or Java EL respectively) |
| `DUPLICATE_OUTPUT_NAME` | WARNING | Repeated target context key |
| `UNSUPPORTED_EXPRESSION_DIALECT` | WARNING | Browser cannot validate this syntax; consult Java |

### Parallel Structure (ERROR)

| Code | Description |
| --- | --- |
| `MIXED_FORK_EDGES` | Node mixes unconditional (fork) edges with conditional/default edges; make all outgoing edges unconditional to fork, or add conditions/a default for exclusive choice |
| `FORK_WITHOUT_JOIN` | Parallel branches from a fork do not re-converge at a single join |
| `PARALLEL_BRANCH_REACHES_END` | A parallel branch can reach an end node without first joining |
| `UNBALANCED_PARALLEL` | Each branch must reach its join through one distinct incoming edge |
| `CROSSING_PARALLEL_REGIONS` | An edge crosses a region boundary, including outside entry |
| `PARALLEL_REGION_CYCLE` | A branch re-enters its fork before joining |

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

Java uses uppercase enum constants; JSON and TypeScript severities are lowercase `error` / `warning`.

## Rule Coverage

Both validators check structure and semantics; shared JSON conformance fixtures pin selected problem
codes, severities and affected node/edge IDs. The Java validator remains authoritative for full EL.

Diagnostic multiplicity can differ: Java reports cyclic action strongly connected components; the
browser stops after its first detected automated cycle. Duration checks also differ for signed and
case-insensitive forms. Do not require the complete problem lists to be identical across runtimes.

The browser uses one subset parser for edge conditions and event-output mappings. Malformed supported
syntax produces `INVALID_CONDITION` (warning) or `INVALID_OUTPUT_EXPRESSION` (error). Valid common
ternaries are supported. Recognized engine-only syntax instead produces the browser-only warning
`UNSUPPORTED_EXPRESSION_DIALECT`, preserving the expression and allowing import. This warning does not
certify validity: malformed full-EL constructs may also require Java to diagnose them.

See [Simulation and Condition Testing](visual-editor.md#simulation-and-condition-testing) for the subset
and simulation limits. The repository's `conformance/README.md` describes the executable contract and
intentional differences, including numeric and duration limits.
