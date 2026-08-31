# Apitomy Flow

**Lightweight visual workflow engine for orchestrating long-running project lifecycles.**

Apitomy Flow is a standalone library designed to integrate into [Apitomy](https://www.apitomy.io/) products. It provides a stateless workflow execution engine (Java) and a visual drag-and-drop editor (React) for defining and monitoring workflows.

## Key Features

- **Directed graph workflows** with 6 node types and conditional edge routing
- **Stateless engine** — takes state in, returns state out; no persistence opinions
- **Human-in-the-loop** tasks and external event correlation
- **Visual editor** with drag-and-drop node placement and real-time validation
- **Read-only viewer** for monitoring workflow instance progress
- **51 validation rules** catch structural and semantic problems at design time

## Two Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Engine** | Java 21, pure library | Workflow execution, validation, event correlation |
| **Visual Editor** | React 19, TypeScript | `WorkflowEditor` and `WorkflowViewer` components |

The engine has no framework dependencies — it works in any Java application. The visual editor is a React component library that consuming applications import and render.

## Getting Started

- [Installation](getting-started/installation.md) — Maven coordinates and npm package
- [Quick Start](getting-started/quick-start.md) — Run your first workflow in minutes

## User Guide

- [Workflow Model](user-guide/workflow-model.md) — nodes, edges, and instances
- [Engine Usage](user-guide/engine-usage.md) — running and resuming workflows with `WorkflowEngine`
- [Node Executors](user-guide/node-executors.md) — implementing action nodes
- [Error Handling](user-guide/error-handling.md) — fail / retry / transition strategies
- [Event Correlation](user-guide/event-correlation.md) — matching external events to waiting instances
- [Validation](user-guide/validation.md) — the validation rules reference
- [Visual Editor](user-guide/visual-editor.md) — the `WorkflowEditor` component
- [Workflow Viewer](user-guide/workflow-viewer.md) — the `WorkflowViewer` component

## Developer Guide

- [Architecture](developer-guide/architecture.md) — engine and UI internals
- [Building](developer-guide/building.md) — build from source and run the dev app
- [Contributing](developer-guide/contributing.md) — contribution workflow

## Links

- [GitHub Repository](https://github.com/Apitomy/apitomy-flow)
- [Apitomy Website](https://www.apitomy.io)
- [Apitomy Axiom](https://github.com/Apitomy/apitomy-axiom) — the first product integrating Flow
