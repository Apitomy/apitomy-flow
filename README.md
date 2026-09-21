[![Verify Build Workflow](https://github.com/Apitomy/apitomy-flow/actions/workflows/verify.yaml/badge.svg)](https://github.com/Apitomy/apitomy-flow/actions/workflows/verify.yaml?query=branch%3Amain)

# Apitomy Flow

Lightweight visual workflow engine for orchestrating long-running project lifecycles.
Designed as a standalone library that integrates into Apitomy products (starting with
[Axiom](https://github.com/Apitomy/apitomy-axiom)).

These documents describe the source on this branch, including the combined C1–C14 work. They do not
assert that pending changes are available in a published artifact. Consult the
[current-contract guide](docs/user-guide/current-contracts.md) and
[GitHub issues](https://github.com/Apitomy/apitomy-flow/issues) for compatibility and delivery status.

## What It Does

- Defines workflows as directed graphs with conditional edge routing
- Executes workflows through a stateless engine (state in, state out)
- Supports human-in-the-loop tasks and external event correlation
- Supports structured parallel fork/join and asynchronous actions that return `PENDING`
- Provides a visual drag-and-drop editor, routing simulator, instance viewer, and definition diff viewer
- Validates workflow definitions with [structural and semantic checks](docs/user-guide/validation.md)

## Architecture

Two independent components, side by side:

| Component | Path | Technology | Purpose |
|-----------|------|-----------|---------|
| **Engine** | `engine/` | Java 21 / Maven | Stateless workflow execution library |
| **Visual Editor** | `ui/` | React 19 / TypeScript / Vite | Editor and viewer components |

The engine is a pure Java library with no framework dependencies (no Quarkus, CDI, JPA).
All dependencies (node executors, event listeners, error handler) are passed via constructor.
Workflow instance state is a single JSON document — the consuming application handles persistence.

The UI library exports `WorkflowEditor`, `WorkflowViewer`, and `WorkflowDiffViewer`.
It uses [@xyflow/react](https://reactflow.dev/) for the canvas and [PatternFly 6](https://www.patternfly.org/)
for UI chrome.

## Node Types

| Type | Purpose |
|------|---------|
| **Start** | Entry point with input schema. Supports conditional routing based on initial context. |
| **Action** | Automated work. Delegates to a `NodeExecutor` provided by the host application. |
| **Human Task** | Blocks until a human responds. Engine interprets `description`, `inputs` (label-to-expression map), and `outputs` (form schema) from config. |
| **Receive Event** | Blocks until a matching external event arrives. Supports EL-based correlation. |
| **Wait** | Blocks for a configured duration (ISO 8601). The consuming application schedules the wake-up. |
| **End** | Terminal state with outcome metadata. |

## Prerequisites

- Java 21+
- Maven 3.9+
- Node.js 22+

## Build

```bash
./build.sh
```

This builds both the engine (Maven) and the UI (npm + Vite).

To build components individually:

```bash
# Engine only
cd engine && mvn clean install

# UI only
cd ui && npm install && npm run lint && npm test && npm run build
```

## Development

To run the visual editor dev app:

```bash
cd ui
npm install
npm run dev
```

The dev server starts at **http://localhost:5173** with selectable editor, viewer, and diff scenarios.
Viewer scenarios have their own definitions/instances rather than previewing the current editor graph.

## Engine Usage

```java
// Create executors for your action types
NodeExecutor analyzeExecutor = new NodeExecutor() {
    public String actionType() { return "analyze-cve"; }
    public NodeResult execute(NodeExecutionContext context) {
        // do work...
        return new NodeResult(NodeResultStatus.COMPLETED, Map.of("severity", "high"));
    }
};

// Build the engine
WorkflowEngine engine = new WorkflowEngine(
    NodeExecutorProvider.fromList(analyzeExecutor),  // node executor provider
    List.of(myEventListener),                        // event listeners
    myErrorHandler                                   // error handler (optional)
);

// Start a workflow
WorkflowInstance instance = engine.startWorkflow(workflowDefinition, Map.of("cveId", "CVE-2024-1234"));

// Complete a parked human task by node ID (also works with parallel waits)
instance = engine.completeNode(workflowDefinition, instance, "review",
    new NodeResult(NodeResultStatus.COMPLETED, Map.of("affected", true)));

// Check if an event matches a waiting instance
boolean matches = engine.matchesEvent(workflowDefinition, instance, "await-event", eventPayload);

// Cancel a workflow
instance = engine.cancelWorkflow(workflowDefinition, instance);
```

The sketch assumes the named parked nodes exist in your definition. See
[Engine Usage](docs/user-guide/engine-usage.md) for branch enumeration, pending actions, and host duties;
[executable examples](docs/developer-guide/documentation-checks.md) link to runnable fixtures and tests.

## Project Structure

```
engine/                  Java workflow engine library
  src/main/java/io/apitomy/flow/
    model/               Workflow, WorkflowNode, WorkflowEdge, WorkflowInstance, HumanTaskInfo, ReceiveEventInfo
    engine/              WorkflowEngine, ConditionEvaluator, JsonNodeELResolver
    spi/                 NodeExecutor, WorkflowEventListener, WorkflowErrorHandler
    validation/          WorkflowShape preflight and WorkflowValidator
ui/                      React visual editor components
  src/
    components/          Editor, instance/diff viewers, custom nodes/edges, panels
    validation/          Shape normalization and semantic workflow validator
    types/               TypeScript types mirroring the Java model
```

## License

[Apache License 2.0](LICENSE)

## Links

- [GitHub Repository](https://github.com/Apitomy/apitomy-flow)
- [Documentation](docs/index.md)
- [Historical audit and current backlog](BACKLOG.md)
- [Apitomy Website](https://www.apitomy.io)
- [Apitomy Axiom](https://github.com/Apitomy/apitomy-axiom)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.
