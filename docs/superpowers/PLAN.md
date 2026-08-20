# Apitomy Flow

A lightweight, visual workflow engine for orchestrating long-running project lifecycles. Designed as a standalone library/Quarkus extension that integrates into Apitomy products (starting with Axiom).

## Motivation

Axiom needs workflow support to model project lifecycles — e.g. CVE triage (analyze → triage → mitigate or close) and SDLC for GitHub issues (plan → implement → PR → merge). Existing engines like Kogito/BPMN are too heavyweight. Apitomy Flow provides a streamlined alternative with visual definition and execution, purpose-built for Axiom's needs but generic enough to reuse.

## Architecture

### Two deliverables

1. **apitomy-flow** (engine library) — Graph model, execution engine, state persistence, condition evaluation. Defines a `NodeExecutor` SPI that the host application implements for each node type. Ships as a Quarkus extension or plain JAR. Includes the React visual editor component.

2. **Axiom integration** (in apitomy-axiom) — Implements `NodeExecutor` for each Axiom-specific node type. Integrates the visual editor into the Axiom UI. Wires workflow state to the project model.

### Core Model: State Machine with Conditional Edges

A directed graph (not strictly a DAG — cycles are allowed for re-review/retry loops).

**Workflow Definition** (serializable as JSON):
```
Workflow {
  id: string
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

WorkflowNode {
  id: string
  type: "start" | "end" | "action" | "human-task" | "receive-event"
  name: string
  config: Record<string, any>   // type-specific configuration
  position: { x: number, y: number }  // visual editor coordinates
}

WorkflowEdge {
  id: string
  source: string       // source node id
  target: string       // target node id
  condition?: string   // expression evaluated against workflow context
  priority: number     // for ordering when multiple edges leave a node
  isDefault: boolean   // fallback when no conditions match
  label?: string       // display label for the edge
}
```

**Workflow Instance** (runtime state):
```
WorkflowInstance {
  id: string
  workflowId: string          // reference to the definition
  currentNodeId: string       // which node the instance is at
  status: "running" | "waiting" | "completed" | "failed"
  context: Record<string, any>  // accumulated data from completed nodes
  history: HistoryEntry[]      // path taken through the graph
  createdOn: timestamp
  updatedOn: timestamp
}
```

### Node Types (5)

| Node Type | Purpose | Behavior |
|-----------|---------|----------|
| **Start** | Entry point | One per workflow. Immediately transitions to the next node. |
| **Action** | Automated work | Invokes a `NodeExecutor`. Blocks until executor returns a result. Result merges into context. |
| **Human Task** | Human approval/input | Blocks until a human responds. Has config for title, description, references, output schema (form fields). |
| **Receive Event** | Wait for external event | Blocks until a matching event arrives. Has config for event type filter and optional field matching. |
| **End** | Terminal state | Marks the instance as completed. Has config for outcome metadata (success, failure, reason). |

### Branching: Conditions on Edges

- Each node can have multiple outgoing edges
- Each edge has an optional condition expression evaluated against the workflow context
- Edges are evaluated in priority order — first match wins
- One edge per node can be marked as default (fallback)
- Visually, edges display a small condition badge

### Condition Expression Language

TBD — options:
- Simple property comparison (e.g. `result.status == "not-affected"`)
- JSONPath or JMESPath expressions
- A minimal custom DSL
- SpEL (Spring Expression Language) — though not ideal for Quarkus

### Execution Engine

When a node completes:
1. Retrieve the node's outgoing edges, sorted by priority
2. Evaluate each edge's condition against the workflow context
3. Transition to the first matching edge's target node (or the default edge)
4. Execute the target node (or enter a wait state for Human Task / Receive Event)

The engine must:
- Persist state after each transition (survives server restarts)
- Support long-running waits (days/weeks for human tasks and events)
- Resume from persisted state on application startup
- Track execution history (which nodes were visited, when, with what context)

### Persistence

- Workflow definitions stored as JSON (single column, like Axiom's dashboard widgets)
- Workflow instances stored as rows with JSON context/history columns
- Uses the host application's existing database (PostgreSQL via Panache/Hibernate)
- The engine provides JPA entities; the host app includes them in its persistence unit

### Visual Editor (React)

- Drag-and-drop node placement on a canvas
- Connect nodes with edges (click source → click target)
- Configure nodes via a properties panel
- Add conditions to edges via the properties panel
- Read-only visualization mode showing the current node highlighted and path taken
- Library: evaluate React Flow (reactflow.dev) as the canvas library

### SPI: NodeExecutor

```java
public interface NodeExecutor {
    String nodeType();  // e.g. "action", "human-task", "receive-event"
    CompletableFuture<NodeResult> execute(NodeExecutionContext context);
}

public interface NodeExecutionContext {
    WorkflowNode node();
    Map<String, Object> workflowContext();
    Map<String, Object> nodeConfig();
}

public record NodeResult(
    Status status,   // COMPLETED, FAILED
    Map<String, Object> output  // merged into workflow context
) {}
```

The host application provides `NodeExecutor` implementations for each node type. The engine discovers them via CDI.

## Axiom Integration Plan

### Node Type Implementations

| Flow Node Type | Axiom Implementation |
|----------------|---------------------|
| **Action** | Creates an Axiom task with the configured action type on the project. Completes when the task completes. Task output becomes node output. |
| **Human Task** | Creates an Axiom inbox item with the configured humanContext and outputSchema. Completes when the user responds. Response becomes node output. |
| **Receive Event** | Registers an event listener. Completes when a matching Axiom event arrives for the project. Event payload becomes node output. |

### UI Integration

- Project detail page gets a "Workflow" tab showing the read-only visualization of the current workflow state
- Workflow definitions are managed in a new Settings section (alongside Action Types, Scheduled Jobs, etc.)
- Workflow definition editor uses the visual drag-and-drop editor
- A project can have one workflow assigned (optional). When assigned, the workflow starts on project creation.

### Relationship to Lifecycle Hooks (#197)

Lifecycle hooks (issue #197) trigger individual action types on project events. Workflows are a more structured alternative — when a project has a workflow, the workflow controls the sequence of actions rather than individual hooks. Both can coexist: hooks for simple one-shot triggers, workflows for multi-step lifecycles.

## Design Decisions Still Needed

- [ ] Condition expression language
- [ ] How to handle node execution failures (retry? error edges? fail the workflow?)
- [ ] Versioning: what happens to running instances when a workflow definition is updated?
- [ ] Can a workflow be restarted or reset to a specific node?
- [ ] Should the visual editor be a shared npm package or built into Axiom's UI directly?
- [ ] React Flow vs. other canvas libraries for the visual editor
- [ ] Should workflow definitions be shareable/exportable (JSON import/export)?

## Example Workflows

### CVE Triage
```
Start → Action(analyze-cve) → Human Task(triage: affected?)
  → [affected] Action(plan-mitigation) → Human Task(approve plan)
    → [approved] Action(implement-fix) → Action(verify-fix) → End(mitigated)
    → [rejected] → Action(analyze-cve)  // loop back
  → [not-affected] Action(close-tracker) → End(not-affected)
```

### GitHub Issue SDLC
```
Start → Action(analyze-and-plan) → Human Task(approve plan)
  → [approved] Action(implement) → Action(create-pr) → Receive Event(pr-merged) → End(completed)
  → [rejected] → Action(analyze-and-plan)  // loop back
  → [wont-fix] End(wont-fix)
```

## Influenced By

- **AWS Step Functions** — state machine model, Choice state, callback pattern for human tasks
- **BPMN 2.0** — user task concept, gateway branching, event catch
- **n8n** — visual editor UX, conditions on edges rather than gateway nodes
- **Temporal** — durable execution, long-running wait states

Deliberately avoided full BPMN complexity (parallel gateways, sub-processes, compensation, complex event correlation).
