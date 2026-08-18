# Error Handling

The engine delegates error handling to a `WorkflowErrorHandler` provided by the consuming application. This gives the consumer full control over retry, recovery, and failure policies.

## WorkflowErrorHandler Interface

```java
public interface WorkflowErrorHandler {
    ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node,
                                     NodeResult result, Exception error);
    ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node);
}
```

### handleNodeError

Called when an action node fails. Receives the instance, the failing node, and one of:

| Scenario | `result` | `error` |
|----------|----------|---------|
| Executor returned `FAILED` | The failed `NodeResult` (with output) | `null` |
| Executor threw an exception | `null` | The thrown exception |

### handleNoMatchingEdge

Called when no outgoing edge matches after a node completes (no condition returned true and no default edge exists).

## ErrorResolution

```java
public record ErrorResolution(ErrorAction action, String targetNodeId) {}

public enum ErrorAction { FAIL, RETRY, TRANSITION }
```

| Action | Behavior |
|--------|----------|
| `FAIL` | Fail the workflow. Sets status to `FAILED` with a descriptive `failureReason`. |
| `RETRY` | Re-execute the current node immediately. |
| `TRANSITION` | Jump to a specific node (e.g. an error-handling branch). |

Convenience factory methods: `ErrorResolution.fail()`, `ErrorResolution.retry()`, `ErrorResolution.transitionTo("node-id")`.

## Default Behavior

If no error handler is provided, the engine uses a default handler that always returns `FAIL`.

## Example: Retry with Limit

The engine does not enforce retry counts — the error handler decides when to stop. Track retries in the workflow context:

```java
public class RetryErrorHandler implements WorkflowErrorHandler {

    @Override
    public ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node,
                                            NodeResult result, Exception error) {
        int retries = (int) instance.context().getOrDefault("retryCount", 0);
        if (retries < 3) {
            // Note: the engine's per-call safety limit (100 transitions)
            // provides a hard backstop against infinite retries
            return ErrorResolution.retry();
        }
        return ErrorResolution.transitionTo("error-handler-node");
    }

    @Override
    public ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node) {
        return ErrorResolution.fail();
    }
}
```

!!! note
    The `RETRY` action re-executes the node within the same engine call. The engine's per-call transition safety limit (default: 100) prevents infinite retry loops.

## Example: Error Branch

Use `TRANSITION` to route to an error-handling branch in the workflow graph:

```java
return ErrorResolution.transitionTo("error-end");
```

If the target node ID doesn't exist in the workflow, the engine fails the workflow with a descriptive `failureReason`.

## Error Scenarios

| Scenario | Handler Method | Result |
|----------|---------------|--------|
| Executor returns `NodeResult(FAILED, ...)` | `handleNodeError(instance, node, result, null)` | Handler decides |
| Executor throws exception | `handleNodeError(instance, node, null, error)` | Handler decides |
| No outgoing edge matches | `handleNoMatchingEdge(instance, node)` | Handler decides |
| Condition evaluation fails (bad EL) | `handleNodeError(instance, node, null, error)` | Handler decides |
| Error handler itself throws | — | Engine fails the workflow |
| `TRANSITION` to nonexistent node | — | Engine fails the workflow |
