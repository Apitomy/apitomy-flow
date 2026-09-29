# Apitomy Flow

**Lightweight visual workflow engine for orchestrating long-running project lifecycles.**

Apitomy Flow is a standalone library designed to integrate into [Apitomy](https://www.apitomy.io/) products.
It provides a stateless workflow execution engine (Java) and a visual drag-and-drop editor (React) for
defining and monitoring workflows.

## Key Features

- **Directed graph workflows** with 6 node types and conditional edge routing
- **Stateless engine** — takes state in, returns state out; no persistence opinions
- **Human-in-the-loop** tasks and external event correlation
- **Visual editor** with drag-and-drop node placement and real-time validation
- **Read-only viewer** for monitoring workflow instance progress
- **Shape and semantic validation** catches definition problems before execution
- **Parallel fork/join and pending actions** support multiple parked branches
- **Routing simulation and definition diff** support authoring and review

## Two Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Engine** | Java 21, pure library | Workflow execution, validation, event correlation |
| **UI** | React 19, TypeScript | `WorkflowEditor`, `WorkflowViewer`, and `WorkflowDiffViewer` |

The engine has no framework dependencies — it works in any Java application. The visual editor is a
React component library that consuming applications import and render.

## Getting Started

These guides describe the source branch, including pending C1–C14 changes, rather than guaranteeing
availability in a published artifact. Start with [current contracts](user-guide/current-contracts.md).

- [Installation](getting-started/installation.md) — Maven coordinates and npm package
- [Quick Start](getting-started/quick-start.md) — Run your first workflow in minutes

## User Guide

- [Workflow Model](user-guide/workflow-model.md) — nodes, edges, and instances
- [Typed Configuration](user-guide/typed-configuration.md) — wire schema and source migration
- [Engine Usage](user-guide/engine-usage.md) — running and resuming workflows with `WorkflowEngine`
- [Node Executors](user-guide/node-executors.md) — implementing action nodes
- [Error Handling](user-guide/error-handling.md) — fail / retry / transition strategies
- [Event Correlation](user-guide/event-correlation.md) — matching external events to waiting instances
- [Validation](user-guide/validation.md) — the validation rules reference
- [Visual Editor](user-guide/visual-editor.md) — the `WorkflowEditor` component
- [Workflow Viewer](user-guide/workflow-viewer.md) — the `WorkflowViewer` component
- [Workflow Diff Viewer](user-guide/workflow-diff.md) — compare definitions by ID
- [Parallel Fork/Join](user-guide/parallel-fork-join.md) — a worked fork/join workflow

## Developer Guide

- [Architecture](developer-guide/architecture.md) — engine and UI internals
- [Engine Errors](developer-guide/engine-errors.md) — structured diagnostics and host SPI
- [Indexed Architecture](developer-guide/indexed-architecture.md) — ownership and benchmark evidence
- [Documentation Checks](developer-guide/documentation-checks.md) — executable examples and browser checks
- [Building](developer-guide/building.md) — build from source and run the dev app
- [Contributing](developer-guide/contributing.md) — contribution workflow

## Links

- [GitHub Repository](https://github.com/Apitomy/apitomy-flow)
- [Apitomy Website](https://www.apitomy.io)
- [Apitomy Axiom](https://github.com/Apitomy/apitomy-axiom) — the first product integrating Flow
