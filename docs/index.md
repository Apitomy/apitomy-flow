# Apitomy Flow

**Lightweight visual workflow engine for orchestrating long-running project lifecycles.**

Apitomy Flow is a standalone library designed to integrate into [Apitomy](https://www.apitomy.io/) products. It provides a stateless workflow execution engine (Java) and a visual drag-and-drop editor (React) for defining and monitoring workflows.

## Key Features

- **Directed graph workflows** with 5 node types and conditional edge routing
- **Stateless engine** — takes state in, returns state out; no persistence opinions
- **Human-in-the-loop** tasks and external event correlation
- **Visual editor** with drag-and-drop node placement and real-time validation
- **Read-only viewer** for monitoring workflow instance progress
- **24 validation rules** catch structural and semantic problems at design time

## Two Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Engine** | Java 21, pure library | Workflow execution, validation, event correlation |
| **Visual Editor** | React 19, TypeScript | `WorkflowEditor` and `WorkflowViewer` components |

The engine has no framework dependencies — it works in any Java application. The visual editor is a React component library that consuming applications import and render.

## Getting Started

- [Installation](getting-started/installation.md) — Maven coordinates and npm package
- [Quick Start](getting-started/quick-start.md) — Run your first workflow in minutes

## Links

- [GitHub Repository](https://github.com/Apitomy/apitomy-flow)
- [Apitomy Website](https://www.apitomy.io)
- [Apitomy Axiom](https://github.com/Apitomy/apitomy-axiom) — the first product integrating Flow
