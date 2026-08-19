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
    WorkflowNode node,                // the action node being executed
    Map<String, Object> inputs,      // resolved input values (label → value)
    Map<String, Object> nodeConfig   // the node's config map (includes actionType)
) {}
```

The `inputs` map contains values resolved from the action node's input EL expressions. The executor receives only the declared inputs — it does not have access to the full workflow context.

## Result

```java
public record NodeResult(
    NodeResultStatus status,       // COMPLETED or FAILED
    Map<String, Object> output     // merged into workflow context on success
) {}
```

On `COMPLETED`, the engine validates the output against the node's declared output schema (required fields must be present and non-null), then merges the output map into the workflow context. On `FAILED`, the error handler is invoked (see [Error Handling](error-handling.md)).

## Example

```java
public class AnalyzeCveExecutor implements NodeExecutor {

    @Override
    public String actionType() {
        return "analyze-cve";
    }

    @Override
    public NodeResult execute(NodeExecutionContext context) {
        String cveId = (String) context.inputs().get("CVE ID");

        // Perform analysis...
        String severity = analyzeCve(cveId);

        return new NodeResult(NodeResultStatus.COMPLETED,
            Map.of("severity", severity, "analyzed", true));
    }
}
```

## Registration

Executors are provided to the `WorkflowEngine` via a `NodeExecutorProvider`:

```java
WorkflowEngine engine = new WorkflowEngine(
    NodeExecutorProvider.fromList(new AnalyzeCveExecutor(), new CreatePrExecutor()),
    List.of(),
    null
);
```

The `NodeExecutorProvider` is a functional interface with a single method `getExecutor(String actionType)`. The `fromList` factory creates a provider from a list of executors, keyed by their `actionType()`. You can also implement `NodeExecutorProvider` directly for custom lookup logic (e.g. service registry, dependency injection). If no matching executor is found, the workflow fails.

## Action Node Config

Action nodes must include an `actionType` field and should declare `inputs` and `outputs`:

```json
{
  "actionType": "analyze-cve",
  "inputs": {
    "CVE ID": "context.cveId",
    "Repository": "context.repository"
  },
  "outputs": [
    { "name": "severity", "type": "string", "required": true },
    { "name": "analyzed", "type": "boolean", "required": true }
  ]
}
```

- **`inputs`** — map of label to EL expression. Resolved against the workflow context before execution and passed to the executor as `context.inputs()`.
- **`outputs`** — list of `{name, type, required}`. After execution, the engine validates that required outputs are present and non-null in the result. Missing required outputs are routed through the error handler.

The validator emits `MISSING_ACTION_INPUTS` and `MISSING_ACTION_OUTPUTS` warnings when these are absent. The full config map is also available to the executor as `nodeConfig`.
