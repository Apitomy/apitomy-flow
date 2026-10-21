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

The handler decides *whether* to retry (`retry()`, `fail()`, or `transitionTo(...)`). For action nodes, the
effective retry policy decides *how many times* and *when*. The effective policy is the node's own
`config.retry` if present, otherwise the workflow's `defaults.retry`. A node policy replaces the default
wholesale; fields are never merged.

```json
"retry": {
  "maxAttempts": 5,
  "delay": "PT2S",
  "backoff": "exponential",
  "multiplier": 2.0,
  "maxDelay": "PT1M",
  "jitter": true
}
```

| Field | Type | Default | Rules |
|---|---|---|---|
| `maxAttempts` | integer | required | `>= 1`. Counts total attempts including the first. `1` means never retry. |
| `delay` | ISO-8601 duration | `PT0S` | `>= 0`. Base delay before the first retry. `PT0S` means retry inline. |
| `backoff` | `"fixed"` \| `"exponential"` | `"fixed"` | |
| `multiplier` | number | `2.0` | `> 1`. Only valid when `backoff` is `"exponential"`. |
| `maxDelay` | ISO-8601 duration | none | `> 0` and `>= delay`. Caps the computed delay. |
| `jitter` | boolean | `false` | When true, uses "full jitter": uniform random in `[0, computedDelay]`. |

Durations use the unsigned, uppercase `PnDTnHnMnS` form shared by Java and the UI: `PT0.5S` and `P1D` are
valid; `-PT1S`, `pt1s`, and `PT1M-30S` are not.

The delay before attempt `attempt + 1` is computed by `RetryPolicy.delayFor(attempt, random)`:

- fixed: `delay`
- exponential: `delay * multiplier^(attempt - 1)`
- capped at `maxDelay` if set, otherwise at `RetryPolicy.MAX_UNCAPPED_DELAY` (365 days); overflow
  saturates at the cap rather than wrapping
- with `jitter`, a uniform random value in `[0, capped]`

Delays are computed and truncated to millisecond precision. A computed delay under 1 ms, including a
jittered 0, retries inline.

When the handler returns `retry()` and `attempt >= maxAttempts`, the workflow fails with
`Exceeded retry limit (<maxAttempts - 1>): <diagnostic>`. Otherwise a zero delay re-executes the action
inline, and a positive delay parks the node: the instance quiesces to `WAITING` until the host calls
`retryNode`.

The open history entry for the node visit carries `attempt` (1-based; absent means 1) and, while parked
for a delayed retry, `retryAt`. Because this state lives on the instance, counts survive `PENDING` parking,
host persistence, and restarts. A later re-entry of the same node (for example, a loop) opens a new history
entry, so the count resets per visit.

#### Without a policy

When no policy applies, behavior is unchanged. Each local action execution retry loop allows **ten retries
after its initial attempt**, and exhaustion fails with `Exceeded retry limit (10): <diagnostic>`. That
counter is local to one engine call: it is not durable and resets when an async action resumes via
`completeNode`. Recovery entries, externally requested action retries, human input retries, ordinary edge
moves, and unsuccessful edge selections use the shared **100-unit driver budget**. Successful selection
itself adds no charge; a fork charges each child move.

`OUTPUT_MAPPING` retries and retries on non-action nodes keep their existing semantics with or without a
policy: they wait for another host delivery and do not consume policy attempts.

#### Host scheduling contract

The engine never sleeps or schedules. After each call, ask for parked retries and schedule a timer for each:

```java
for (RetryInfo retry : engine.getPendingRetries(instance)) {
    scheduler.schedule(retry.retryAt(), () -> save(engine.retryNode(workflow, load(id), retry.nodeId())));
}
```

`RetryInfo(nodeId, branchId, attempt, retryAt)` reports the attempt that will run next. `retryNode`
clears `retryAt` and re-executes the node, re-resolving inputs. It returns the instance unchanged for late
or duplicate timers (when the node is no longer parked for retry). The engine does not enforce `retryAt`.
`completeNode` throws `IllegalStateException` for a node parked for retry, and `getActionInfo` returns
`null` for it, so a scheduled retry is never mistaken for pending async work.

For deterministic tests, construct the engine with an explicit `Clock` and `RandomGenerator`:
`new WorkflowEngine(provider, listeners, handler, clock, random)`.

#### Attempt-aware handlers

The engine calls `handleError(instance, node, result, error, RetryContext retry)`, whose default delegates
to the four-argument `handleError`, so existing handlers are unaffected. `RetryContext(int attempt,
Optional<RetryPolicy> policy)` reports the failed attempt number and the effective policy. Without a
policy, `attempt` is not durable: within the inline execution loop it is the call-local number
(`retries + 1`), and a failed external completion (`completeNode`) always reports 1.

```java
public class TransientOnlyHandler implements WorkflowErrorHandler {
    @Override
    public ErrorResolution handleError(WorkflowInstance instance, WorkflowNode node, NodeResult result,
                                       WorkflowError error, RetryContext retry) {
        if (error.getCause() instanceof IllegalArgumentException) {
            return ErrorResolution.fail();
        }
        // Without a declared policy, apply a host ceiling to the call-local attempt count.
        if (retry.policy().isEmpty() && retry.attempt() > 3) {
            return ErrorResolution.fail();
        }
        return ErrorResolution.retry();
    }
}
```

For bad config or data, transition to a repair node or fail: a repeated immutable input error will not
repair itself through retries. Do not mutate `instance.context()` to count attempts; it is an owned
snapshot.

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
