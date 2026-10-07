# Event Correlation

The host finds candidate instances when an external event arrives, then uses the stateless engine to
test correlation and deliver the event to the chosen branch.

## How It Works

1. **Consumer** queries its storage for all instances with `status == WAITING`
2. **Consumer** enumerates `activeBranches` and tests each node with the node-addressed overload
3. **Engine** checks: is this an active parked receiver in a WAITING instance, and does the event match?
4. **Consumer** calls `completeNode(definition, instance, nodeId, result)` for the chosen match

## matchesEvent

```java
boolean matches = engine.matchesEvent(definition, instance, nodeId, eventPayload);
```

Returns `true` if all three conditions are met:

1. The instance is in `WAITING` status
2. The addressed node is an active parked `receive-event` node
3. The event matches the node's criteria (event type, correlation key when configured, then match
   expressions)

Returns `false` in all other cases (wrong status, wrong node type, type mismatch, match expression failure).

The overload without `nodeId` tests the single current node, or **any** parked receiver when there is no
single cursor. A true result does not tell you which branch to complete. Matching is read-only, and
`completeNode` does not re-check correlation: the host decides whether and where to deliver the result.

## Introspection

`getReceiveEventInfo(workflow, instance, nodeId)` returns the event type, match expressions, output
mappings, and parsed lookback for a parked receiver. Index by event type to avoid loading every waiting instance. The overload
without a node ID returns the current or first eligible receiver, not the full set.

```java
ReceiveEventInfo info = engine.getReceiveEventInfo(definition, instance);
// info.eventType()   → "pr-merged"
// info.matchExpressions() → ["event.repository == context.repository", ...]
// info.lookback()    → EventLookback[mode=DURATION, duration=PT10M]
```

## Receive-Event Node Config

```json
{
  "eventType": "pr-merged",
  "match": [
    "event.repository == context.repository",
    "event.pull_request.number == context.prNumber"
  ],
  "lookback": "PT10M"
}
```

### eventType

Required for matching: an exact string match against the event's `type` field. A type mismatch rejects
the event before checking expressions.

### match

Optional Jakarta EL expressions that must all evaluate to boolean `true` (AND semantics). Two root
variables are available:

| Variable | Description |
|----------|-------------|
| `context` | The workflow context (accumulated data from completed nodes) |
| `event` | The incoming event payload |

If `match` is absent or empty, any event of the correct type matches.

### Timeouts

`timeout` is an optional positive ISO 8601 duration. When it is set, the node needs exactly one outgoing
edge marked `"isTimeout": true`; that edge is the path taken when no matching event arrives in time.

```json
{ "id": "recv", "type": "receive-event", "config": { "eventType": "pr-merged", "timeout": "P2D" } }
{ "id": "e-merged",  "source": "recv", "target": "deploy",   "priority": 0, "isDefault": false }
{ "id": "e-expired", "source": "recv", "target": "escalate", "priority": 0, "isDefault": false, "isTimeout": true }
```

Normal edge selection ignores timeout edges, so a node with one normal edge and one timeout edge is not a
parallel fork. The host reads `ReceiveEventInfo.timeout()`, schedules a timer, and calls
`engine.onReceiveEventTimeout(workflow, instance, nodeId)` when it fires. A timeout for a node that is no
longer parked is a no-op. Validation codes: `INVALID_RECEIVE_EVENT_TIMEOUT`, `MISSING_TIMEOUT_EDGE`,
`MULTIPLE_TIMEOUT_EDGES`, `MISSING_EVENT_EDGE`, `INVALID_TIMEOUT_EDGE` (errors) and
`TIMEOUT_EDGE_WITH_CONDITION` (warning). In the editor, set **Timeout** on the node and connect its bottom
*timeout* port. The browser simulator does not fire timers; it always follows the event path.

### lookback

Optional. Controls how far back a host searches stored events when a branch parks on the node, so an
event that arrived *before* the branch parked can still be delivered:

| Value | Meaning |
|-------|---------|
| `run-start` (default) | Events with timestamps at or after the start of the workflow instance |
| `none` | Only events delivered after the node parks |
| ISO-8601 duration, e.g. `PT10M` | Events newer than *now minus duration*, still limited to the instance start |

Durations must be positive and use the `java.time.Duration` form (`PnDTnHnMnS`). Other values are
rejected with `INVALID_LOOKBACK`. Flow does not store events; running the look-back is the host's job.
`ReceiveEventInfo.lookback()` returns the parsed `EventLookback` (a `Mode` of `RUN_START`, `NONE`, or
`DURATION`, plus the `Duration` for the last mode), so hosts do not have to parse the value again.

### correlationKey

Optional explicit correlation key. Hosts can store the evaluated subscription key in an indexed column
and look up waiting runs by the event key instead of evaluating every `match` expression against every
candidate.

```json
{
  "eventType": "order-shipped",
  "correlationKey": {
    "subscriptionKey": "context.orderId",
    "eventKey": "event.data.orderId"
  }
}
```

| Field | Evaluated against | Description |
|-------|-------------------|-------------|
| `subscriptionKey` | `context` | Evaluated when the node is parked; exposed as `ReceiveEventInfo.subscriptionKey()` |
| `eventKey` | `event` | Evaluated against the incoming event; see `WorkflowEngine.evaluateEventKey(...)` |

Both expressions are required when `correlationKey` is present, and both must be valid EL. Each is a
single expression; build composite keys with EL string concatenation, for example
`context.orderId += ':' += context.region`. Evaluated keys are compared as strings.

When a key is configured, `matchesEvent` requires the subscription key to be non-null and equal to the
event key. `match` expressions still apply as an additional filter. Nodes without a `correlationKey`
behave exactly as before, and `subscriptionKey()` / `evaluateEventKey(...)` return `null` for them.

```java
ReceiveEventInfo info = engine.getReceiveEventInfo(definition, instance, nodeId);
String subscriptionKey = info.subscriptionKey();          // store in an indexed column
String eventKey = engine.evaluateEventKey(definition, nodeId, event);  // look up waiting runs
```

## Expression Examples

```
event.repository == context.repository
event.pull_request.number == context.prNumber
event.action == 'closed' && event.pull_request.merged == true
!(event.draft)
```

Dot notation navigates nested maps: `event.pull_request.number` reads the number inside `pull_request`.

EL navigation supports nested Jackson `JsonNode` values as well as maps/lists. The public event parameter
is still `Map<String, Object>`; convert a root `readTree` result to a map or place its fields/trees inside
that map. A root `JsonNode` cannot be passed directly to `matchesEvent`.

## Complete Example

### Setup

An earlier action node stored PR data in the context:

```json
{ "repository": "apitomy/axiom", "prNumber": 42 }
```

The receive-event node config:

```json
{
  "eventType": "pr-merged",
  "match": [
    "event.repository == context.repository",
    "event.pull_request.number == context.prNumber"
  ]
}
```

### Correlation Flow

```java
// An event arrives from GitHub
Map<String, Object> event = Map.of(
    "type", "pr-merged",
    "repository", "apitomy/axiom",
    "pull_request", Map.of("number", 42)
);

// Check all waiting instances
for (WorkflowInstance instance : waitingInstances) {
    Workflow definition = getDefinition(instance.workflowId());

    for (ActiveBranch branch : instance.activeBranches()) {
        if (engine.matchesEvent(definition, instance, branch.nodeId(), event)) {
            NodeResult result = new NodeResult(NodeResultStatus.COMPLETED, event);
            WorkflowInstance updated = engine.completeNode(definition, instance, branch.nodeId(), result);
            save(updated);
            break; // This host policy delivers to the first matching receiver only.
        }
    }
}
```

`getDefinition` and `save` are host operations in this sketch. Load/update under the host's concurrency
policy, persist the returned snapshot, and deduplicate delivery. To fan out to more than one receiver,
re-check each candidate against the latest returned state; one completion may terminate the instance.
The engine does not provide an event bus or exactly-once completion.

## Event output mappings

Without mappings (absent, null, or empty `outputs`), the raw result payload is flat-merged into context.
With mappings, only the declared keys are merged:

```json
{
    "eventType": "pr-merged",
    "match": ["event.repository == context.repository"],
    "outputs": [
        { "contextKey": "mergedPr", "expression": "event.pull_request.number" },
        { "contextKey": "previousPr", "expression": "context.prNumber" }
    ]
}
```

All mappings see the same pre-merge `context` and incoming `event`; a mapping cannot read another
mapping's newly written key. `ReceiveEventInfo.outputMappings()` exposes the declarations. A mapping
exception enters structured `OUTPUT_MAPPING` recovery without merging a partial result; RETRY leaves the
receiver parked for another delivery. Shared [executable fixtures](../developer-guide/documentation-checks.md)
cover mappings and serialized parallel resumes.
