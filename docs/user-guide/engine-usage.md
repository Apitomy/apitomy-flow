# Engine Usage

The `WorkflowEngine` is a stateless, synchronous Java class. All methods take state in and return updated state out — the input instance is never mutated.

## Creating the Engine

```java
WorkflowEngine engine = new WorkflowEngine(
    NodeExecutorProvider.fromList(executor1, executor2),  // NodeExecutorProvider
    List.of(listener1, listener2),                        // WorkflowEventListener implementations
    myErrorHandler                                        // WorkflowErrorHandler (optional, defaults to fail-on-error)
);
```

The `NodeExecutorProvider` is a functional interface — implement it directly for custom executor lookup (e.g. a service registry), or use the `fromList` convenience factory. All dependencies are passed via constructor — no CDI, no service discovery.

## Starting a Workflow

```java
// With auto-generated UUID
WorkflowInstance instance = engine.startWorkflow(definition, initialContext);

// With caller-provided ID
WorkflowInstance instance = engine.startWorkflow(definition, initialContext, "my-id-123");
```

`startWorkflow` does the following:

1. Validates the workflow definition (rejects if any ERROR-level validation problems exist)
2. Validates the initial context against the start node's input schema
3. Creates a new instance in `RUNNING` status
4. Fires `onWorkflowStarted`
5. Enters the start node and evaluates outgoing edges
6. Chains through action nodes until a wait state or end is reached

The returned instance is in `WAITING` (hit a human-task or receive-event), `COMPLETED` (reached an end node), or `FAILED` (error during execution).

## Completing a Waiting Node

```java
NodeResult result = new NodeResult(NodeResultStatus.COMPLETED,
    Map.of("approved", true, "comment", "Looks good"));

WorkflowInstance updated = engine.completeCurrentNode(definition, instance, result);
```

- Throws `IllegalStateException` if the instance is not in `WAITING` status
- Merges the result's output into the workflow context
- Evaluates outgoing edges and chains through action nodes until the next wait or end

## Cancelling a Workflow

```java
WorkflowInstance cancelled = engine.cancelWorkflow(definition, instance);
```

- Sets status to `CANCELLED` and fires `onWorkflowCancelled`
- No-op if the instance is already in a terminal state (`COMPLETED`, `FAILED`, `CANCELLED`)

## Checking Event Correlation

```java
boolean matches = engine.matchesEvent(definition, instance, eventPayload);
```

See [Event Correlation](event-correlation.md) for details.

## Action Chaining

When an action node completes, the engine immediately evaluates edges and transitions to the next node. If the next node is also an action, it executes that too — continuing until it reaches a wait state or end. A single call to `startWorkflow` or `completeCurrentNode` may execute multiple action nodes in sequence.

A safety limit of 100 transitions per call prevents infinite loops from automated cycles. If the limit is reached, the workflow fails with a descriptive `failureReason`.

## Immutability

All engine methods return a new `WorkflowInstance`. The input instance is never mutated:

```java
WorkflowInstance waiting = engine.startWorkflow(definition, context);
WorkflowInstance completed = engine.completeCurrentNode(definition, waiting, result);

// 'waiting' is unchanged
assert waiting.status() == InstanceStatus.WAITING;
assert completed.status() == InstanceStatus.COMPLETED;
```

## Threading

All engine methods are synchronous. When the engine invokes a `NodeExecutor`, it blocks until the executor returns. The consuming application can run engine calls on a background thread if async behavior is desired.
