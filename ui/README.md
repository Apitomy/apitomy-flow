# Apitomy Flow UI

A reusable React component library for visual workflow editing and instance viewing. Built with
React Flow and PatternFly 6.

## Features

- **WorkflowEditor** -- full visual editor with drag-and-drop node palette, property inspector,
  conditional edge editing, undo/redo, right-click context menu, and real-time validation.
- **WorkflowViewer** -- read-only instance viewer showing execution trace with visited/current/
  unvisited node styling, status-aware current-node highlighting (with an animated ring), animated
  edges, and a host-augmentable node right-click menu (`nodeContextMenuItems`).
- **Six node types** -- Start, End, Action, Human Task, Receive Event, and Wait.
- **Conditional edges** -- configure EL condition expressions, priority, default-edge flag, and
  labels.
- **Auto-layout** -- automatic dagre-based node layout on load, plus a "Tidy up" button in the
  editor.
- **Validation** -- four-pass client-side validation (49 rules) covering structural integrity,
  connectivity, edge conditions, and semantic correctness.
- **EditorSpi** -- host extension interface for supplying action-type descriptors (with typed
  inputs/outputs) and/or a custom `validate` function whose problems merge with the built-in ones.
- **Theming** -- light and dark mode via CSS custom properties.

## Installation

```bash
npm install @apitomy/flow-ui
```

## Peer Dependencies

- `react` ^19.0.0
- `react-dom` ^19.0.0
- `@xyflow/react` ^12.0.0
- `@patternfly/react-core` ^6.0.0
- `@patternfly/react-icons` ^6.0.0
- `@patternfly/patternfly` ^6.0.0

## Usage

```tsx
import { WorkflowEditor } from "@apitomy/flow-ui";
import "@apitomy/flow-ui/style.css";

function App() {
    return (
        <WorkflowEditor
            workflow={myWorkflow}
            onChange={(updated) => setWorkflow(updated)}
        />
    );
}
```

## License

[Apache License 2.0](../LICENSE)
