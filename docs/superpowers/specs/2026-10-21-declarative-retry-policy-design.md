# Declarative Retry and Backoff Policies for Action Nodes — Design

Issue: [#86](https://github.com/Apitomy/apitomy-flow/issues/86)

## Goal

Let workflow authors declare per-node (and per-workflow default) retry policies for action nodes — maximum
attempts and inter-attempt delay (fixed or exponential, optional cap and jitter) — with attempt state that is
durable across asynchronous (`PENDING`) resumes, a clearly defined relationship with the host
`WorkflowErrorHandler`, and full visibility in the authoring UI and both validators.

## Non-goals

- Circuit-breaker, bulkhead, or cross-instance rate limiting.
- Dead-letter queues, global failure routing, or an `onExhausted` routing target.
- An in-engine scheduler or blocking sleeps. The engine stays scheduler-free; hosts own timers.
- Any behavior change for definitions that declare no policy.

## 1. Definition model

### Node-level policy

Action nodes accept an optional `config.retry` object:

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

### Workflow-level default

`Workflow` gains an optional top-level `defaults` object:

```json
"defaults": { "retry": { "maxAttempts": 3, "delay": "PT5S", "backoff": "exponential" } }
```

The effective policy for an action node is its own `config.retry` if present, otherwise `defaults.retry`,
otherwise the legacy policy. A node policy **replaces** the default wholesale — fields are never merged.

### Legacy (no policy)

When no policy applies, behavior is unchanged: retries run immediately and the workflow fails after
`MAX_RETRIES = 10` retries (11 attempts) with the existing message `Exceeded retry limit (10): ...`.

### Parity

Fields are mirrored in:

- Java: `NodeConfig.Action.retry()` returns `Optional<RetryPolicy>`, a nested view record over the wire map
  (same pattern as `CorrelationKey`). `Workflow` gains `defaults` (`WorkflowDefaults` record with
  `Optional<RetryPolicy> retry()`), null-normalized in the compact constructor; a backward-compatible
  constructor without `defaults` is retained.
- TypeScript: `RetryPolicy` interface; `ActionConfig.retry?: RetryPolicy`; `Workflow.defaults?: { retry?:
  RetryPolicy }`.
- `conformance/workflow-v1.schema.json`, and conformance fixtures for valid and invalid policies.

## 2. Durable attempt state

`HistoryEntry` gains two optional fields (`@JsonInclude(NON_NULL)`, with back-compat constructors, mirrored in
TypeScript):

- `attempt` (`Integer`): 1-based number of the attempt currently in progress or most recently made on this
  open entry. Absent means 1.
- `retryAt` (`Instant`): set only while the node is parked waiting for a delayed retry; cleared when the
  retry runs.

Because state lives on the open history entry for the node visit, it survives `PENDING` parking, host
persistence (instance JSON), and process restarts. A later re-entry of the same node (for example a loop)
creates a new history entry, so the count naturally resets per visit.

## 3. Engine behavior

### Relationship with `WorkflowErrorHandler`

The handler remains the authority on *whether* to retry; the policy governs *when* and *how many times*.

1. On any action-node failure (exception, `FAILED` result, output validation failure — synchronous or via
   async `completeNode`), the engine consults the handler via `RecoveryPolicy` as today.
2. The handler receives the attempt number through a new default-method overload on `WorkflowErrorHandler`
   that accepts a `RetryContext(int attempt, Optional<RetryPolicy> policy)`. Its default delegates to the
   existing `handleError(...)`, so existing handlers compile and behave unchanged.
3. `FAIL` and `TRANSITION` are applied exactly as today.
4. `RETRY` is shaped by the effective policy:
   - If `attempt >= maxAttempts` (legacy: retries `> MAX_RETRIES`): fail the workflow with
     `Exceeded retry limit (N): <diagnostic>`.
   - Else compute `delay = policy.delayFor(attempt, random)`:
     - `delay == 0`: increment `attempt` and re-execute inline (current behavior).
     - `delay > 0`: increment `attempt`, set `retryAt = now + delay` on the open history entry, and stop
       advancing the branch. The instance quiesces to `WAITING`.

Non-action nodes and `OUTPUT_MAPPING` retries keep their existing semantics (`awaitsExternalDelivery`);
policies do not apply to them.

### Delay calculation

`RetryPolicy.delayFor(int attempt, RandomGenerator random)` is a pure function. For the delay before attempt
`attempt + 1`:

- fixed: `delay`
- exponential: `delay * multiplier^(attempt - 1)`
- capped at `maxDelay` if set (overflow-safe: saturate to `maxDelay`, or to a large bound when unset)
- jitter: uniform in `[0, capped]`

The engine takes an injectable `RandomGenerator` and `Clock` (defaulting to system) for deterministic tests.

### Host API

- `List<RetryInfo> getPendingRetries(WorkflowInstance instance)` — one entry per node parked for retry:
  `RetryInfo(String nodeId, String branchId, int attempt, Duration delay, Instant retryAt)`. Here `attempt` is
  the number of the attempt that will run next. Modeled on `getWaitInfo`.
- `WorkflowInstance retryNode(Workflow workflow, WorkflowInstance instance, String nodeId)` — called by the
  host when its timer fires. Clears `retryAt` and re-executes the node (re-resolving inputs) via the existing
  `WorkKind.RETRY` path. It is a **no-op** returning the instance unchanged if the node is not currently
  parked for retry (late or duplicate timers), mirroring `onReceiveEventTimeout`.
- The engine does not enforce `retryAt`; calling `retryNode` early is allowed (the host owns time).

### Async resumes

`completeNode` with a failed result flows through `handleFailedCompletion` → `resumeResolution`. That path
now reads `attempt` from the open history entry and applies the same policy logic, so attempt ceilings hold
across `PENDING` parks.

## 4. Validation

Mirrored codes in `WorkflowValidator.java` and `validateWorkflow.ts` (applied to node `config.retry` and to
`defaults.retry`; for defaults the problem has no node id):

| Code | Severity | Condition |
|---|---|---|
| `INVALID_RETRY_POLICY` | error | `retry` is not an object |
| `INVALID_RETRY_MAX_ATTEMPTS` | error | missing, non-integer, or `< 1` |
| `INVALID_RETRY_DELAY` | error | not a valid ISO-8601 duration, or negative |
| `INVALID_RETRY_BACKOFF` | error | not `fixed` or `exponential` |
| `INVALID_RETRY_MULTIPLIER` | error | not a number `> 1`, or given with `fixed` backoff |
| `INVALID_RETRY_MAX_DELAY` | error | invalid duration, `<= 0`, or `< delay` |
| `INVALID_RETRY_JITTER` | error | not a boolean |
| `RETRY_ON_NON_ACTION_NODE` | warning | `retry` declared on a node that is not an action |

## 5. UI

- **PropertiesPanel / `ActionNodeFields`:** a "Retry" section with an enable checkbox ("Override workflow
  default") and fields for max attempts, delay, backoff (select), multiplier (exponential only), max delay,
  and jitter. Blank optional values become `undefined`. Respects the read-only `<fieldset>`.
- **Workflow-level properties:** a "Default retry policy" section with the same fields, editing
  `workflow.defaults.retry`.
- **Viewer:** action nodes with an effective declared policy show a small `↻N` badge (N = `maxAttempts`),
  tooltip summarizing the policy, and whether it comes from the node or the workflow default.
- **Instance view:** a node with an open history entry carrying `retryAt` shows "Retry N/M at <time>"
  through `getNodeStatusBadge`.
- Formatting and effective-policy resolution live in pure utilities (`utils/retryPolicy.ts`) so they can be
  tested with vitest.

## 6. Documentation

- `docs/user-guide/error-handling.md`: replace the "Retry limits and durability" section with the policy
  model, the relationship with the handler, and the host timer contract (`getPendingRetries` / `retryNode`).
- `docs/user-guide/typed-configuration.md`, `workflow-model.md`: `retry` and `defaults` fields.
- `docs/user-guide/current-contracts.md`, `validation.md`: new contracts and codes.
- `docs/developer-guide/engine-errors.md`: attempt numbering.

## 7. Testing

- Java (JUnit 5): `RetryPolicyTest` (fixed, exponential, cap, jitter bounds, overflow); engine tests for inline
  zero-delay retry, parked delayed retry plus `retryNode`, late and duplicate `retryNode` no-op, exhaustion
  message, workflow default vs node override, attempt count preserved across a `PENDING` resume, handler
  receiving the attempt number, legacy behavior unchanged with no policy; serialization round-trip and
  back-compat for `HistoryEntry` and `Workflow`; validator tests for every code.
- TypeScript (vitest): validator tests for every code, `retryPolicy.ts` utility tests, PropertiesPanel tests
  for read-only mode; contract tests updated for new types and schema.
- Conformance: valid and invalid retry fixtures exercised by both validators.
