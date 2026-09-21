# Error Handling

The host supplies a `WorkflowErrorHandler` to choose failure, retry, or recovery transitions. The default
handler fails. The combined branch adds structured diagnostics while retaining legacy methods and wire
fields; see [current contracts](current-contracts.md) for delivery status.

## Structured and legacy callbacks

`handleError(instance, node, result, WorkflowError error)` is an additive default method. Override it to
inspect `phase()`, `nodeId()`, `edgeId()`, `expression()`, `field()`, message, and cause. IDs/fields that do
not apply are null. Existing handlers can continue implementing:

```java
ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node,
                                NodeResult result, Exception error);
ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node);
```

The default adapter preserves legacy dispatch. Explicit FAILED results supply the result and a null
exception. Executor exceptions preserve their original identity; newly diagnosed input/output/result
failures supply `WorkflowError`. Edge-condition exceptions carry the expression via
`ConditionEvaluationException` rather than being reduced to “no matching edge.” Missing-edge selection
still invokes `handleNoMatchingEdge`. Override structured handling for a uniform view across phases.

| Phase | Examples |
|---|---|
| `INPUT_RESOLUTION` | Action/human-task input expression threw before work or parking |
| `EXECUTOR_LOOKUP`, `EXECUTION` | Missing/throwing provider, thrown executor, explicit failed result |
| `RESULT_VALIDATION`, `OUTPUT_VALIDATION` | Null result/status, malformed output keys, missing required action output |
| `OUTPUT_MAPPING` | Receive-event mapping failed before merging |
| `EDGE_CONDITION`, `EDGE_SELECTION` | Condition exception or no matching edge |
| `ERROR_HANDLER` | Handler threw or returned an invalid resolution |

## Recovery decisions

| Decision | Behavior |
|---|---|
| `ErrorResolution.fail()` | Set FAILED, preserve a diagnostic `failureReason`, notify `onWorkflowFailed` |
| `ErrorResolution.retry()` | Retry at the failed boundary; see the phase-specific behavior below |
| `ErrorResolution.transitionTo("repair")` | Enter an existing non-START node through normal execution/parking behavior |

Recovery affects the failed branch; unanswered parked siblings remain parked. Invalid output is not
merged. A malformed handler fails once without recursive handler invocation, retaining the handler cause
and original error. Failure of one branch fails the instance.

### What RETRY repeats

| Failure boundary | RETRY behavior | Guard |
|---|---|---|
| Action input resolution, provider lookup, execution, result/required-output validation during execution | Repeat the action attempt from input resolution; executor side effects may repeat if execution is reached | Local action retry loop |
| Rejected external ACTION completion (result/required-output failure or FAILED result) | Queue action re-execution, resolving inputs again; do not merely await another completion | External retry consumes a driver unit; action re-execution has its own local retry loop |
| Non-action external completion or external output-mapping failure | Leave the instance parked for another host delivery; do not merge rejected output | No immediate retry loop |
| Human-task input failure on entry | Repeat input resolution before parking; this is not an external completion retry | Shared driver budget |
| `EDGE_CONDITION` or `EDGE_SELECTION` | Re-evaluate outgoing routing, without re-executing the completed action or awaiting another delivery | Unsuccessful selection consumes a shared driver unit |

### Retry limits and durability

Each local action execution retry loop allows **ten retries after its initial attempt**. This is not a
total allowance across every action in an engine call. Recovery entries, externally requested action
retries, human input retries, ordinary edge moves, and unsuccessful edge selections use the shared
**100-unit driver budget**. Successful selection itself adds no charge; a fork charges each child move.
These guards bound in-process loops; they do not schedule backoff or persist an attempt policy. A repeated
immutable input error will not repair itself through immediate retries.

For transient action failures a handler can return `retry()` under its own host policy; for bad config or
data, transition to a repair node or fail. Do not mutate `instance.context()` to increment a retry counter:
it is an owned snapshot. Persist durable attempt counts and scheduling in the host. Declarative retry and
backoff remain proposed in [#86](https://github.com/Apitomy/apitomy-flow/issues/86).

## Errors outside recovery

- Invalid definitions fail start with `WorkflowValidationException`; required start input checks throw
  before execution. Inspect validation problems rather than treating this as an executor retry.
- Completing a non-WAITING instance or a node that is not parked throws `IllegalStateException`.
- Read-only action/human info calls throw `WorkflowError` on input-resolution failure: no state can change.
- `resolveExpression` throws `ConditionEvaluationException`; event matching returns false on evaluation
  failure. Correlation does not complete the node.
- Host JVM `Error`s propagate. Listener `Exception`s are logged/swallowed, and later listeners still run.

## Host integration

`failureReason` remains a string for wire compatibility, not a stable machine-readable format.
`onWorkflowFailed` receives the structured error. Error recovery does not roll back external side effects;
use idempotency and durable host transactions/outboxes. Listeners are synchronous observations without
exactly-once delivery, replay, veto, or persistence guarantees.

See [Engine errors and host extension contracts](../developer-guide/engine-errors.md) for registration
validation, nullability, callback ordering, legacy adapter details, and migration guidance. The
[executable examples](../developer-guide/documentation-checks.md) exercise these paths.
