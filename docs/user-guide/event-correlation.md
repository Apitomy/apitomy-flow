# Event Correlation

When an external event arrives, the consuming application needs to determine which workflow instances are waiting for it and dispatch accordingly. Since the engine is stateless, correlation is a shared responsibility.

## How It Works

1. **Consumer** queries its storage for all instances with `status == WAITING`
2. **Consumer** calls `matchesEvent(definition, instance, event)` for each candidate
3. **Engine** checks: is the instance waiting? Is the current node a receive-event? Does the event match?
4. **Consumer** calls `completeCurrentNode(definition, instance, result)` for matches

## matchesEvent

```java
boolean matches = engine.matchesEvent(definition, instance, eventPayload);
```

Returns `true` if all three conditions are met:

1. The instance is in `WAITING` status
2. The current node is a `receive-event` node
3. The event matches the node's criteria (event type + match expressions)

Returns `false` in all other cases (wrong status, wrong node type, type mismatch, match expression failure).

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

Required. An exact string match against the event's `type` field. If the type doesn't match, the event is rejected without checking match expressions.

### match

Optional. A list of Jakarta EL expressions that must all evaluate to `true` (AND semantics). Two root variables are available:

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

Dot notation navigates nested maps: `event.pull_request.number` resolves through `event.get("pull_request").get("number")`.

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

    if (engine.matchesEvent(definition, instance, event)) {
        // Match found — advance the workflow
        NodeResult result = new NodeResult(NodeResultStatus.COMPLETED, event);
        WorkflowInstance updated = engine.completeCurrentNode(definition, instance, result);
        save(updated);
    }
}
```

The event payload becomes the node result output and is merged into the workflow context.
