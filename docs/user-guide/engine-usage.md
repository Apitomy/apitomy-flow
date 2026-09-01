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

The returned instance is in `WAITING` (hit a human-task, receive-event, or wait node), `COMPLETED` (reached an end node), or `FAILED` (error during execution).

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

## Handling Wait States

The engine is stateless and synchronous — when it reaches a node that requires external input (Human Task, Receive Event, or Wait), it sets the instance to `WAITING` and returns. The consuming application is responsible for detecting the wait, handling it, and resuming the workflow. All three wait-state node types follow the same pattern:

1. **Detect** — after `startWorkflow` or `completeCurrentNode` returns, check `instance.status() == WAITING`
2. **Introspect** — call the appropriate `get*Info` method to learn what the instance is waiting for
3. **Handle** — perform the external work (present a task inbox, listen for events, schedule a timer)
4. **Resume** — call `completeCurrentNode(workflow, instance, result)` with the outcome

```java
WorkflowInstance instance = engine.startWorkflow(workflow, inputs);

if (instance.status() == InstanceStatus.WAITING) {
    // Try each introspection method — exactly one will return non-null
    HumanTaskInfo task = engine.getHumanTaskInfo(workflow, instance);
    if (task != null) {
        // Create an inbox item with task.description(), task.inputs(), task.outputs()
        // When the human completes it, call completeCurrentNode with their response
    }

    ReceiveEventInfo event = engine.getReceiveEventInfo(workflow, instance);
    if (event != null) {
        // Index the instance by event.eventType() for efficient matching
        // When a matching event arrives, call completeCurrentNode with the event payload
    }

    WaitInfo wait = engine.getWaitInfo(workflow, instance);
    if (wait != null) {
        // Schedule a timer for wait.duration()
        // When it fires, call completeCurrentNode with an empty result
    }
}
```

The consuming application persists the instance and resumes it later when the external condition is met. The engine does not manage persistence, scheduling, or event subscriptions — those are the application's responsibility.

## Resolving Expressions

```java
Object value = engine.resolveExpression("context.creditScore", instance.context());
```

Evaluates a Jakarta EL expression against a workflow context and returns the resolved value. Useful for rendering human task input values — for example, resolving display labels to their current context values. Supports nested map access and Jackson `JsonNode` navigation.

## Getting Human Task Info

```java
HumanTaskInfo info = engine.getHumanTaskInfo(definition, instance);
```

Returns a `HumanTaskInfo` record when the instance is waiting at a human-task node, `null` otherwise. The record contains:

| Field | Type | Description |
|-------|------|-------------|
| `nodeId` | String | The human-task node ID |
| `nodeName` | String | The human-task node name |
| `description` | String | Instructions for the person completing the task |
| `inputs` | Map<String, Object> | Display labels as keys, resolved context values as values |
| `outputs` | List<OutputDefinition> | The form fields to complete the task (see below) |

Input EL expressions (from the node's config) are evaluated against the instance context automatically — the caller receives fully resolved values.

### Output field metadata

Each `OutputDefinition` describes one form field a person fills in to complete the task. Only `name`
is required; every other attribute is optional and backward-compatible — an output that declares only
`{name, type, required}` behaves exactly as before, and the engine derives sensible defaults for
anything omitted. Hosts (such as Axiom) use this metadata to render the runtime completion form.

| Field | Required | Meaning | Default when omitted |
|-------|----------|---------|----------------------|
| `name` | yes | context key the answer is stored under | — |
| `type` | no | semantic type: `string`/`number`/`boolean`/`object` | `string` |
| `required` | no | must be provided to complete | `false` |
| `label` | no | human-readable field label | `name` |
| `description` | no | help/hint text shown under the field | none |
| `widget` | no | rendering hint: `text`/`textarea`/`select` (string types only) | inferred from `type` |
| `defaultValue` | no | pre-filled value | none |
| `options` | no | `List<OutputOption>` (`label`, `value`) — choices for `widget: select` | none |

**Default widget inference** (when `widget` is omitted): `string` → `text`, `number` → `number`,
`boolean` → `checkbox`, `object` → `textarea`. `widget` only meaningfully applies to `string`-typed
outputs, and `select` requires `options`. The values in `HumanTaskInfo.outputs` are fully resolved —
`label` and `widget` are populated with their defaults so the caller never has to re-derive them.

These attributes are authoring metadata only. As before, the engine does **not** validate submitted
human answers against the declared outputs — hosts remain responsible for validating submissions.

## Getting Receive Event Info

```java
ReceiveEventInfo info = engine.getReceiveEventInfo(definition, instance);
```

Returns a `ReceiveEventInfo` record when the instance is waiting at a receive-event node, `null` otherwise. The record contains:

| Field | Type | Description |
|-------|------|-------------|
| `nodeId` | String | The receive-event node ID |
| `nodeName` | String | The receive-event node name |
| `eventType` | String | The event type this node is waiting for |
| `matchExpressions` | List<String> | Raw EL expressions used for event correlation |

The `eventType` can be used to index waiting instances for efficient event matching — only instances waiting for a given event type need to be checked when an event arrives.

## Getting Wait Info

```java
WaitInfo info = engine.getWaitInfo(definition, instance);
```

Returns a `WaitInfo` record when the instance is waiting at a wait node, `null` otherwise. The record contains:

| Field | Type | Description |
|-------|------|-------------|
| `nodeId` | String | The wait node ID |
| `nodeName` | String | The wait node name |
| `duration` | Duration | The configured wait duration (parsed from ISO 8601) |

The consuming application reads the duration, schedules a timer, and calls `completeCurrentNode` when the timer expires.

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
