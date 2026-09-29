# Workflow Viewer

The `WorkflowViewer` component provides a read-only visualization of a workflow instance's current state.

## Usage

```tsx
import { WorkflowViewer } from '@apitomy/flow-ui';
import type { Workflow, WorkflowInstance } from '@apitomy/flow-ui';

function MyWorkflowViewer() {
  return (
    <WorkflowViewer
      workflow={workflowDefinition}
      instance={workflowInstance}
      theme="light"
    />
  );
}
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `Workflow` | Yes | The workflow definition (graph structure) |
| `instance` | `WorkflowInstance` | Yes | The runtime state to visualize |
| `theme` | `FlowTheme` | No | `'light'` or `'dark'` (default: `'light'`). Controls the color scheme of the viewer and React Flow canvas |
| `nodeContextMenuItems` | `WorkflowViewerNodeMenuItem[] \| ((nodeId: string) => WorkflowViewerNodeMenuItem[])` | No | Host-contributed actions for a node's right-click menu. See [Node Context Menu](#node-context-menu) |

## Features

### Read-Only Canvas

The viewer displays the workflow graph but does not allow editing:

- Nodes are not draggable
- Edges cannot be created or removed
- Nodes can be selected for inspection; selection does not edit the definition
- Pan and zoom are available for navigation

### Current Node Highlight

The node where the instance is currently positioned is highlighted so it is immediately obvious where
the workflow is. While the instance is active (running or waiting), the current node also shows an
animated "marching ants" ring around it.

The current node's color reflects the instance's status:

| Instance status | Current node styling |
|-----------------|----------------------|
| Running / Waiting | Amber border with an animated ring |
| Failed | Red border (ring stops) |
| Cancelled | Muted/grey border (ring stops) |
| Completed | Styled as a normal visited node (no ring) |

### Path Taken

The viewer styles nodes and edges based on the instance's execution history:

| Element | Visited | Not Visited |
|---------|---------|-------------|
| Nodes | Full opacity | Dimmed (40% opacity) |
| Edges | Green, thicker stroke | Dimmed |

Arrival edges for active branches animate with a flowing dash pattern. Terminal instances have no animated
edges, even if their serialized snapshot still retains branch records.

### Node details and repeat visits

Click a node to inspect its **State** or **Definition** in the resizable side panel. The default state
view follows the latest visit as new history arrives; a visit picker lets you inspect earlier loop visits.
Parallel history is grouped by branch. Clicking the canvas clears selection. Host right-click actions
are independent of this built-in inspection.

The viewer responds to new `workflow` and `instance` props. Replace changed objects/arrays rather than
mutating them in place. Supply the definition that belongs to the instance: automatic version pinning is
not implemented (see [current contracts](current-contracts.md)).

### Parallel Branches

For instances that fork, the viewer highlights **every** currently-active node at once rather than a
single cursor. The arrival edge of each active branch is animated, while all previously-traversed edges
keep their static "taken" styling. When you open a node's detail, its visit history is grouped by
branch, and a **Branch** row identifies which branch a given visit belongs to (the `root` branch is not
labeled). At a terminal state — completed, failed, or cancelled — the viewer ignores branch activity and
uses `currentNodeId` if present. A cancelled multi-branch instance may have no single cursor to highlight.

### History-Based Rendering

The viewer reads the instance's `history` array to determine:

- Which nodes have been visited (`history[].nodeId`)
- Which edges have been followed (`history[].edgeId`)
- Which nodes are active (`instance.activeBranches`, gated by status; terminal fallback uses `currentNodeId`)

### Auto-Layout

If the workflow's nodes have no positions (or all overlap at the same coordinates), the viewer
arranges them automatically using the same layered layout as the editor, so a definition built
without explicit `position` values still renders cleanly. Layout is computed from the graph
structure only, so it does not re-run as the instance state changes.

### Node Context Menu

By default, right-clicking a node does nothing (the browser's own context menu is left untouched). A
host can add its own actions to a node's right-click menu with the `nodeContextMenuItems` prop — for
example "View logs" or "Open task in Jira".

Provide either a static array (the same items for every node) or a function that receives the
`nodeId` and returns items tailored to that node. Returning an empty array means no menu is shown for
that node.

```tsx
import { WorkflowViewer } from '@apitomy/flow-ui';
import type { WorkflowViewerNodeMenuItem } from '@apitomy/flow-ui';

<WorkflowViewer
  workflow={workflow}
  instance={instance}
  nodeContextMenuItems={(nodeId) => [
    { id: 'logs', label: 'View logs', onSelect: (id) => openLogs(id) },
    { id: 'cancel', label: 'Cancel task', danger: true, onSelect: (id) => cancelTask(id) },
  ]}
/>
```

Each item has the following shape:

```ts
interface WorkflowViewerNodeMenuItem {
  id: string;                              // stable React key
  label: string;                           // menu text
  icon?: React.ReactNode;                  // optional leading icon
  danger?: boolean;                        // render as a destructive action
  onSelect: (nodeId: string) => void;      // invoked with the right-clicked node's id
}
```

## Styling

The viewer requires the same CSS imports as the editor:

```typescript
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import '@apitomy/flow-ui/style.css';
```

The viewer fills its container — ensure the parent element has explicit dimensions.

See [Workflow Diff Viewer](workflow-diff.md) for definition comparisons and
[browser verification](../developer-guide/documentation-checks.md#browser-verification) for live-update
checks.
