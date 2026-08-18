[![Verify Build Workflow](https://github.com/Apitomy/apitomy-flow/actions/workflows/verify.yaml/badge.svg)](https://github.com/Apitomy/apitomy-flow/actions/workflows/verify.yaml?query=branch%3Amain)

# Apitomy Flow

Lightweight visual workflow engine for orchestrating long-running project lifecycles.
Designed as a standalone library that integrates into Apitomy products (starting with
[Axiom](https://github.com/Apitomy/apitomy-axiom)).

## What It Does

- Defines workflows as directed graphs with conditional edge routing
- Executes workflows through a stateless engine (state in, state out)
- Supports human-in-the-loop tasks and external event correlation
- Provides a visual drag-and-drop editor and read-only instance viewer
- Validates workflow definitions with 24 structural and semantic rules

## Architecture

Two independent components, side by side:

| Component | Path | Technology | Purpose |
|-----------|------|-----------|---------|
| **Engine** | `engine/` | Java 25 / Maven | Stateless workflow execution library |
| **Visual Editor** | `ui/` | React 19 / TypeScript / Vite | Editor and viewer components |

The engine is a pure Java library with no framework dependencies (no Quarkus, CDI, JPA).
All dependencies (node executors, event listeners, error handler) are passed via constructor.
Workflow instance state is a single JSON document — the consuming application handles persistence.

The visual editor is a React component library exporting `WorkflowEditor` and `WorkflowViewer`.
It uses [@xyflow/react](https://reactflow.dev/) for the canvas and [PatternFly 6](https://www.patternfly.org/)
for UI chrome.

## Node Types

| Type | Purpose |
|------|---------|
| **Start** | Entry point with input schema. Supports conditional routing based on initial context. |
| **Action** | Automated work. Delegates to a `NodeExecutor` provided by the host application. |
| **Human Task** | Blocks until a human responds. Config is pass-through for the host app. |
| **Receive Event** | Blocks until a matching external event arrives. Supports EL-based correlation. |
| **End** | Terminal state with outcome metadata. |

## Prerequisites

- Java 25+
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

The dev server starts at **http://localhost:5173** with a sample CVE triage workflow
loaded in both the editor and viewer tabs.

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
    List.of(analyzeExecutor),     // node executors
    List.of(myEventListener),     // event listeners
    myErrorHandler                // error handler (optional)
);

// Start a workflow
WorkflowInstance instance = engine.startWorkflow(workflowDefinition, Map.of("cveId", "CVE-2024-1234"));

// Complete a human task
instance = engine.completeCurrentNode(workflowDefinition, instance,
    new NodeResult(NodeResultStatus.COMPLETED, Map.of("affected", true)));

// Check if an event matches a waiting instance
boolean matches = engine.matchesEvent(workflowDefinition, instance, eventPayload);

// Cancel a workflow
instance = engine.cancelWorkflow(workflowDefinition, instance);
```

## Project Structure

```
engine/                  Java workflow engine library
  src/main/java/io/apitomy/flow/
    model/               Workflow, WorkflowNode, WorkflowEdge, WorkflowInstance
    engine/              WorkflowEngine, ConditionEvaluator
    spi/                 NodeExecutor, WorkflowEventListener, WorkflowErrorHandler
    validation/          WorkflowValidator (24 rules)
ui/                      React visual editor components
  src/
    components/          WorkflowEditor, WorkflowViewer, custom nodes/edges, panels
    validation/          TypeScript workflow validator (23 rules)
    types/               TypeScript types mirroring the Java model
```

## License

[Apache License 2.0](LICENSE)

## Links

- [GitHub Repository](https://github.com/Apitomy/apitomy-flow)
- [Apitomy Website](https://www.apitomy.io)
- [Apitomy Axiom](https://github.com/Apitomy/apitomy-axiom)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.
