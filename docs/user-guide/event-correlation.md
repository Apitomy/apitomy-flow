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
3. The event matches the node's criteria (event type + match expressions)

Returns `false` in all other cases (wrong status, wrong node type, type mismatch, match expression failure).

The overload without `nodeId` tests the single current node, or **any** parked receiver when there is no
single cursor. A true result does not tell you which branch to complete. Matching is read-only, and
`completeNode` does not re-check correlation: the host decides whether and where to deliver the result.

## Introspection

`getReceiveEventInfo(workflow, instance, nodeId)` returns the event type, match expressions, and output
mappings for a parked receiver. Index by event type to avoid loading every waiting instance. The overload
without a node ID returns the current or first eligible receiver, not the full set.

```java
ReceiveEventInfo info = engine.getReceiveEventInfo(definition, instance);
// info.eventType()   → "pr-merged"
// info.matchExpressions() → ["event.repository == context.repository", ...]
```

## Receive-Event Node Config

```json
{
  "eventType": "pr-merged",
  "match": [
    "event.repository == context.repository",
    "event.pull_request.number == context.prNumber"
  ]
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
