# Node Executors

The `NodeExecutor` interface is the SPI that the host application implements to handle action nodes. Each executor handles one action type.

## Interface

```java
public interface NodeExecutor {
    String actionType();
    NodeResult execute(NodeExecutionContext context);
}
```

| Method | Description |
|--------|-------------|
| `actionType()` | The action type this executor handles (e.g. `"analyze-cve"`, `"create-pr"`). Matched against the `actionType` field in the action node's config. |
| `execute(context)` | Performs the work. Receives the node, workflow context, and node config. Returns a `NodeResult`. |

## Execution Context

```java
public record NodeExecutionContext(
    WorkflowNode node,                   // the action node being executed
    Map<String, Object> workflowContext, // accumulated context from prior nodes
    Map<String, Object> nodeConfig       // the node's config map (includes actionType)
) {}
```

## Result

```java
public record NodeResult(
    NodeResultStatus status,       // COMPLETED or FAILED
    Map<String, Object> output     // merged into workflow context on success
) {}
```

On `COMPLETED`, the output map is merged into the workflow context. On `FAILED`, the error handler is invoked (see [Error Handling](error-handling.md)).

## Example

```java
public class AnalyzeCveExecutor implements NodeExecutor {

    @Override
    public String actionType() {
        return "analyze-cve";
    }

    @Override
    public NodeResult execute(NodeExecutionContext context) {
        String cveId = (String) context.workflowContext().get("cveId");

        // Perform analysis...
        String severity = analyzeCve(cveId);

        return new NodeResult(NodeResultStatus.COMPLETED,
            Map.of("severity", severity, "analyzed", true));
    }
}
```

## Registration

Executors are passed to the `WorkflowEngine` constructor:

```java
WorkflowEngine engine = new WorkflowEngine(
    List.of(new AnalyzeCveExecutor(), new CreatePrExecutor()),
    List.of(),
    null
);
```

The engine matches executors to action nodes by comparing `NodeExecutor.actionType()` against the node's `config.actionType` field. If no matching executor is found, the workflow fails.

## Action Node Config

Action nodes must include an `actionType` field in their config:

```json
{
  "actionType": "analyze-cve",
  "additionalParam": "value"
}
```

The full config map is passed to the executor as `nodeConfig`, so executors can read any additional parameters they need.
