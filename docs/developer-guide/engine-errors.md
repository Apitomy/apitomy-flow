# Engine errors and host extension contracts

The engine is synchronous and stateless. The host persists the instance returned by each call and owns
delivery concurrency, durable scheduling, correlation, and deduplication. Error recovery does not undo
executor side effects. Executors must tolerate retries or use host-managed idempotency.

## Structured diagnostics without a wire migration

`WorkflowErrorHandler.handleError(instance, node, result, error)` receives a `WorkflowError` with:

- `phase()`: input resolution, executor lookup/execution, result/output validation, output mapping,
  edge condition/selection, or error-handler failure;
- `nodeId()`, `edgeId()`, `expression()`, and `field()`, with null for identities that do not apply;
- the original message and `getCause()` when an exception caused the failure.

The callback is an additive default method. Existing handlers continue implementing `handleNodeError`
and `handleNoMatchingEdge`; no replacement SPI is required. The default adapter retains the original
exception object for executor, edge-condition, and event-mapping failures. Explicit `FAILED` results
still reach legacy handlers with their result and a null exception. Newly diagnosed input, missing-output,
and malformed-result failures supply a `WorkflowError` through the existing exception parameter.
Handlers needing all identities can override `handleError` (or extend `DefaultErrorHandler` and override it).

`FAIL` preserves the diagnostic in the existing string `WorkflowInstance.failureReason`; no JSON field
names or result/resolution record shapes change. `onWorkflowFailed` receives the structured error. A
throwing or malformed handler fails once with phase `ERROR_HANDLER`, retaining the handler exception as
cause and the original `WorkflowError` as a suppressed exception; both appear in the failure reason.
Failure text is for operators, not a stable parser format. Expressions, exception messages, and explicit
FAILED output diagnostics can contain host data; apply the host's normal access and retention policies.

## Input policy and recovery

Action inputs are resolved before provider lookup or executor side effects. Human-task inputs are checked
on entry before parking. Evaluation exceptions default to workflow failure, not a substituted null input.
The handler can choose `RETRY` or `TRANSITION` to a repair node. A retry re-resolves inputs; immutable
invalid configuration will fail again, so transition to a repair path is usually the useful choice.

Null literal values, blank expressions, and expressions that legitimately resolve to null remain null.
Non-string input values remain literals. Required start inputs retain their existing pre-execution
validation and throw to the caller. Read-only `getActionInfo`/`getHumanTaskInfo` calls throw `WorkflowError`
if input evaluation fails: they cannot update state or apply recovery. Their ineligible-node null contract
is unchanged. `matchesEvent` retains its false-on-evaluation-error policy, and `resolveExpression` retains
its `ConditionEvaluationException` contract.

Action retries allow ten retries after the initial attempt. Recovery transitions and human input retries
use the shared 100-unit call-local driver budget alongside ordinary moves and unsuccessful edge selections.
Budget failures retain the triggering/last recovery diagnostic when available. Parked sibling branches are
never selected as runnable just because another branch recovers. These limits are not durable retry policy.

On external ACTION completion, `RETRY` re-executes the action. For non-action completion failures and event
output-mapping failures, `RETRY` leaves the instance parked for another delivery. No invalid completion
output is merged. A completed action must supply each required output as non-null before context-key
remapping; pending output may be partial.

## Extension response and registration rules

| Boundary | Contract |
|---|---|
| Provider | Return an executor or null for unavailable. Null and thrown Exceptions enter recoverable `EXECUTOR_LOOKUP` failure. |
| `fromList` registry | Snapshot registrations; reject null list/elements, null/blank action types, and duplicates at the second registration. `actionType()` exceptions propagate at construction. |
| Executor/result | Result and status must be non-null; null output means no values. Output keys must be non-null strings; values may be null. Invalid results enter recovery before merging. |
| Error handler | Return a non-null resolution/action. Only TRANSITION accepts a target, which must be nonblank and identify an existing non-START node. Invalid decisions fail without recursively invoking the handler. |
| Listener registration | Null list means no listeners; otherwise the engine copies registrations in order and rejects null elements. |

`NodeResult` and `ErrorResolution` constructors remain permissive for compatibility; validation happens
at the engine boundary. Output values remain host-defined; this change does not introduce recursive JSON
schema validation or promise deep immutability. Callers/extensions must not mutate supplied data.
Host `Exception`s are handled according to these contracts; JVM `Error`s propagate.

## Ordering and durability

Listeners run synchronously in registration order. One listener's exception is logged/swallowed and does
not prevent later listeners or workflow execution. Registration changes after construction have no effect.
Concurrent host calls may invoke the same listener or executor concurrently; the host controls serialization.

The normal sequence is workflow-started, node-entered, action-completed, edge-followed, next-node-entered,
and eventually workflow-completed/failed. Edge-followed precedes target entry or join-arrival accounting.
Node-completed follows successful output validation/history/context update; pending and failed results
do not emit it. Start entry is notified before its history record; other entries follow their history
record. Recovery entry does not fabricate an edge-followed event. Completion and cancellation callbacks
observe terminal state, but the host still has to persist the returned instance.

Listeners are observational, not persistence hooks with delivery guarantees. They provide no transaction,
rollback, veto, durable ordering, replay, or exactly-once guarantee. Use host-owned transactions/outboxes
and idempotent work dispatch for durable integration; throwing from a callback does not make it durable.

## Compatibility checklist for existing hosts

1. Existing executor/provider/handler implementations continue to compile; structured handling is opt-in.
2. Fix invalid input expressions previously masked as null, or select a repair transition in the handler.
3. Allow non-null exceptions alongside completed results rejected by output validation.
4. Remove duplicate registrations and malformed results/resolutions that previously escaped or were accepted.
5. Treat failureReason as diagnostic text; retain existing JSON readers and persisted instance shapes.
