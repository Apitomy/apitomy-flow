# Apitomy Flow UI

A reusable React component library for visual workflow editing and instance viewing. Built with
React Flow and PatternFly 6.

This README describes this branch's source; pending C1–C14 changes are not a release announcement.
See [current contracts](../docs/user-guide/current-contracts.md) for delivery and migration guidance.

## Features

- **WorkflowEditor** -- full visual editor with drag-and-drop node palette, property inspector,
  conditional edge editing, undo/redo, right-click context menu, and real-time validation.
- **WorkflowViewer** -- read-only instance viewer showing execution trace with visited/current/
  unvisited node styling, status-aware current-node highlighting (with an animated ring), animated
  edges, and a host-augmentable node right-click menu (`nodeContextMenuItems`).
- **WorkflowDiffViewer** -- read-only, ID-based definition comparison with semantic/cosmetic changes.
- **Simulation** -- routing and mock completion using a documented browser subset of Jakarta EL.
- **Six node types** -- Start, End, Action, Human Task, Receive Event, and Wait.
- **Conditional edges** -- configure EL condition expressions, priority, default-edge flag, and
  labels.
- **Auto-layout** -- automatic dagre-based node layout on load, plus a "Tidy up" button in the
  editor.
- **Validation** -- nested shape preflight, structural integrity, connectivity, conditions, semantics,
  and parallel topology. See the [validation sources and contract](../docs/user-guide/validation.md).
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
import "@patternfly/patternfly/patternfly.css";
import "@xyflow/react/dist/style.css";
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

The example assumes host-owned `myWorkflow` and `setWorkflow`; give the container an explicit height.
The graph is initialized at mount, with live host metadata updates. To replace the entire document, change
the component's React `key`. `onChange` publishes committed edits, not selection or measurement changes.
See [Visual Editor](../docs/user-guide/visual-editor.md) for history, layout, and synchronization details.

## Verification and examples

- [Built-package browser consumer](browser/consumer/main.tsx) imports the actual npm tarball and CSS.
- [Browser checks](browser/README.md) cover rendered editor interactions, viewer/diff updates, and packaging.
- [Typed configuration](../docs/user-guide/typed-configuration.md) covers optional positions and migration.
- [Documentation checks](../docs/developer-guide/documentation-checks.md) lists focused executable examples.

## License

[Apache License 2.0](../LICENSE)
