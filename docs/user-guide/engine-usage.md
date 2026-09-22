# Engine Usage

The `WorkflowEngine` is a stateless Java class with synchronous calls and support for asynchronous work.
State-changing calls return snapshots without mutating the input; read-only calls return info or values.
Some no-op paths return the same snapshot. See [current branch contracts](current-contracts.md).

## Creating the Engine

```java
WorkflowEngine engine = new WorkflowEngine(
    NodeExecutorProvider.fromList(executor1, executor2),  // NodeExecutorProvider
    List.of(listener1, listener2),                        // WorkflowEventListener implementations
    myErrorHandler                                        // WorkflowErrorHandler (optional, defaults to fail-on-error)
);
```

`NodeExecutorProvider` is a functional interface: implement custom lookup (e.g. a service registry), or
use `fromList`. All dependencies are passed via constructor — no CDI or service discovery.

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

The returned instance is in `WAITING` (all remaining branches parked, including pending actions),
`COMPLETED` (reached an end node), or `FAILED` (unrecovered execution error).

## Completing a Waiting Node

```java
NodeResult result = new NodeResult(NodeResultStatus.COMPLETED,
    Map.of("approved", true, "comment", "Looks good"));

WorkflowInstance updated = engine.completeCurrentNode(definition, instance, result);
```

- Throws `IllegalStateException` if the instance is not `WAITING` or has no single current node
- Merges the result's output into the workflow context
- Evaluates outgoing edges and chains through action nodes until the next wait or end

Use `completeNode(definition, instance, nodeId, result)` when parallel branches may be parked. It rejects
a node that is not an active parked branch. Completed ACTION results must supply non-null required outputs
under their declared names, before alias mapping. Invalid/failed results enter
[error recovery](error-handling.md); they are not successful completions. Human-task output declarations
remain presentation metadata rather than submission validation.

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

Human Task, Receive Event, Wait, and ACTION returning `PENDING` park until the host resumes them.
The driver continues runnable siblings before returning `WAITING`. Use this branch-aware host pattern:

1. **Detect** — after start/completion returns, check `instance.status() == WAITING`
2. **Introspect** — enumerate `activeBranches` and call node-addressed `get*Info` methods
3. **Handle** — perform the external work (present a task inbox, listen for events, schedule a timer)
4. **Resume** — call `completeNode(workflow, latestInstance, nodeId, result)` with the outcome

```java
WorkflowInstance instance = engine.startWorkflow(workflow, inputs);

if (instance.status() == InstanceStatus.WAITING) {
    for (ActiveBranch branch : instance.activeBranches()) {
        String nodeId = branch.nodeId();
        HumanTaskInfo task = engine.getHumanTaskInfo(workflow, instance, nodeId);
        ReceiveEventInfo event = engine.getReceiveEventInfo(workflow, instance, nodeId);
        WaitInfo wait = engine.getWaitInfo(workflow, instance, nodeId);
        ActionInfo action = engine.getActionInfo(workflow, instance, nodeId);
        // For this node, dispatch the applicable task/event/timer/action integration.
        // Store nodeId with the work item; persist state before durable dispatch.
    }
}
```

The host persists the returned instance, schedules timers, manages subscriptions and serializes delivery
against the latest saved state. Use durable dispatch/idempotency for external side effects; callbacks and
completion IDs provide no exactly-once guarantee. See [compatibility](current-contracts.md).

### Pending actions

An executor may dispatch external work and return:

```java
return new NodeResult(NodeResultStatus.PENDING, Map.of("jobId", jobId));
```

Partial output is mapped/merged immediately; the history entry stays open and no `onNodeCompleted` fires.
The host later supplies `COMPLETED` or `FAILED` through `completeNode`. A `PENDING` completion re-parks the
node and may merge further partial output. Required ACTION outputs are checked on the final result itself;
an earlier partial value in context does not satisfy a missing required field in that result.

`getActionInfo(workflow, instance, nodeId)` returns `nodeId`, `nodeName`, `actionType`, resolved `inputs`,
and `expectedOutputs` for an active parked action, or null otherwise. Info reads do not execute the action.
Input resolution failures in action/human info reads throw `WorkflowError` rather than applying recovery.

The overloads without `nodeId` use the single current node, or the first eligible branch in
`activeBranches` order when multiple branches are parked. They do not enumerate all work. The corresponding
`matchesEvent` convenience overload means “any parked receiver matches”; it does not identify the node
to finish.

## Resolving Expressions

```java
Object value = engine.resolveExpression("context.creditScore", instance.context());
```

Evaluates Jakarta EL against workflow context and returns the resolved value. This is useful for resolving
human-task display values. Nested map access and Jackson `JsonNode` navigation are supported.

## Getting Human Task Info

```java
HumanTaskInfo info = engine.getHumanTaskInfo(definition, instance);
```

Returns `HumanTaskInfo` for an eligible parked human-task node, null otherwise. The record contains:

| Field | Type | Description |
|-------|------|-------------|
| `nodeId` | String | The human-task node ID |
| `nodeName` | String | The human-task node name |
| `description` | String | Instructions for the person completing the task |
| `inputs` | Map<String, Object> | Display labels as keys, resolved context values as values |
| `outputs` | List<OutputDefinition> | The form fields to complete the task (see below) |

Input expression strings resolve against instance context; non-string JSON inputs remain literals.

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

Returns `ReceiveEventInfo` for an eligible parked receiver, null otherwise. The record contains:

| Field | Type | Description |
|-------|------|-------------|
| `nodeId` | String | The receive-event node ID |
| `nodeName` | String | The receive-event node name |
| `eventType` | String | The event type this node is waiting for |
| `matchExpressions` | List<String> | Raw EL expressions used for event correlation |
| `outputMappings` | List<EventOutputMapping> | Optional expressions mapping the event into context |

Use `eventType` to index waiting instances and avoid checking unrelated instances when an event arrives.

## Getting Wait Info

```java
WaitInfo info = engine.getWaitInfo(definition, instance);
```

Returns `WaitInfo` for an eligible parked wait node, null otherwise. The record contains:

| Field | Type | Description |
|-------|------|-------------|
| `nodeId` | String | The wait node ID |
| `nodeName` | String | The wait node name |
| `duration` | Duration | The configured wait duration (parsed from ISO 8601) |

The host reads the duration, schedules a timer, and calls `completeNode` for that node when it expires.

## Action Chaining

After action completion, the engine evaluates edges and enters the next node. Another synchronous action
executes immediately; chaining continues until parking or termination. One start/completion call can
therefore execute several actions.

The shared call-local budget of 100 bounds transitions and recovery. Exhaustion fails the workflow with
a diagnostic `failureReason`; see [Error Handling](error-handling.md) for the separate action retry limit.

## Parallel Execution

When execution reaches a fork (a node whose outgoing edges are all unconditional), the engine activates
every branch. `advance` progresses all runnable branches; the instance stays `RUNNING` while any branch
can still make progress and `WAITING` when every remaining branch is parked on a human task, received
event, or wait node.

```java
WorkflowInstance instance = engine.startWorkflow(workflow, context);
// After a fork, more than one branch may be active at once.
List<ActiveBranch> active = instance.activeBranches();
```

Key semantics:

- **AND-join (wait-for-all).** A join node fires once, only after every parallel branch has arrived.
  Arrivals accumulate in `joinArrivals` until the last one lands.
- **Fail-fast.** If any branch fails and is not recovered by an error handler, the whole instance
  transitions to `FAILED`; sibling branches stop.
- **END cancels siblings.** An `end` node reached on any branch terminates the entire instance.
- **`currentNodeId` is `null`** during a multi-branch wait. It is a convenience cursor, not the complete
  execution state; terminal states may retain a final/failing cursor. Use `activeBranches` and status.

Resume a specific parked branch by node id — sibling branches keep waiting:

```java
// Complete one waiting human-task/event/wait branch, addressed by node id:
WorkflowInstance next = engine.completeNode(workflow, instance, "notify-team", result);
```

`completeCurrentNode` remains available and delegates to `completeNode` for the single-branch case.
`getActionInfo`, `getHumanTaskInfo`, `getReceiveEventInfo`, `getWaitInfo`, and `matchesEvent` accept a
`nodeId` so concurrent waiting branches can be inspected independently.

## Immutability

Execution snapshots own acyclic JSON-like payloads: nested maps and lists are recursively read-only,
and Jackson trees are detached on ingress and read. Mutating an original input collection or a tree read
from the snapshot cannot change its JSON state. Already-owned collections may be shared internally.

Opaque Java objects (including non-JSON extension values) remain host-owned references and must stay
immutable. Cyclic object graphs are outside this contract. The same ownership applies to definitions,
history payloads, result values, and typed config adapters; it is not a general-purpose object freezer.

State-changing calls preserve the input snapshot. Terminal cancellation and some parked retry paths can
return the input object itself, so do not rely on fresh identity:

```java
WorkflowInstance waiting = engine.startWorkflow(definition, context);
WorkflowInstance completed = engine.completeCurrentNode(definition, waiting, result);

// 'waiting' is unchanged
assert waiting.status() == InstanceStatus.WAITING;
assert completed.status() == InstanceStatus.COMPLETED;
```

## Threading

Engine calls and executor invocations are synchronous. A `PENDING` executor can arrange asynchronous work
outside the call; the engine starts no worker threads. Parallel branches share context and are driven in
deterministic queue order, not on separate threads. Hosts may call the engine concurrently for different
instances, but callbacks/providers must be safe for that usage. Serialize updates to the same instance to
avoid lost writes. Distinct output aliases avoid accidental last-write-wins collisions between branches.

See [executable examples](../developer-guide/documentation-checks.md) for pending actions, serialized
parallel resumes, input ownership, and error recovery checked against this implementation.
