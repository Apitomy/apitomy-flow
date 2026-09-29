# Node Executors

The host implements the `NodeExecutor` SPI to handle action nodes. Each executor handles one action type.

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

`inputs` contains resolved input expressions and literal values. The executor receives only declared
inputs, not the full workflow context.

## Result

```java
public record NodeResult(
    NodeResultStatus status,       // COMPLETED, FAILED, or PENDING
    Map<String, Object> output     // merged into workflow context on success
) {}
```

On `COMPLETED`, required declared outputs must be present and non-null before merging into context.
On `FAILED`, the error handler is invoked (see [Error Handling](error-handling.md)).

This is a required-presence check, not full value/type validation. `contextKey` aliases apply after that
check. `PENDING` parks the action and can merge partial output; the host completes it later through
`completeNode`. See [pending actions](engine-usage.md#pending-actions) for the complete contract.

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

The provider's functional method is `getExecutor(String actionType)`. `fromList` snapshots registrations
and rejects null entries, blank/null action types, and duplicates. Implement the provider directly for
custom lookup. A missing/throwing provider enters structured recovery and fails by default.

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

- **`inputs`** — map of label to expression string or JSON literal. Strings resolve against context;
  non-string values remain literals. Use an EL quoted string such as `'hello'` for a constant string.
  The executor receives the resolved values as `context.inputs()`.
- **`outputs`** — list of `{name, type, required}` with optional `contextKey`. Missing/null required
  outputs enter error recovery before any output is merged.

Absent declarations produce `MISSING_ACTION_INPUTS` / `MISSING_ACTION_OUTPUTS` warnings. The executor also
receives the full config map as `nodeConfig`.
