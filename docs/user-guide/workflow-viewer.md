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
    />
  );
}
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `Workflow` | Yes | The workflow definition (graph structure) |
| `instance` | `WorkflowInstance` | Yes | The runtime state to visualize |

## Features

### Read-Only Canvas

The viewer displays the workflow graph but does not allow editing:

- Nodes are not draggable
- Edges cannot be created or removed
- Nodes are not selectable
- Pan and zoom are available for navigation

### Current Node Highlight

The node where the instance is currently waiting is highlighted with a glowing amber border, making it immediately obvious where the workflow is paused.

### Path Taken

The viewer styles nodes and edges based on the instance's execution history:

| Element | Visited | Not Visited |
|---------|---------|-------------|
| Nodes | Full opacity | Dimmed (40% opacity) |
| Edges | Green, thicker stroke | Dimmed |

The most recently followed edge is animated with a flowing dash pattern.

### History-Based Rendering

The viewer reads the instance's `history` array to determine:

- Which nodes have been visited (`history[].nodeId`)
- Which edges have been followed (`history[].edgeId`)
- Which node is current (`instance.currentNodeId`)

## Styling

The viewer requires the same CSS imports as the editor:

```typescript
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import '@apitomy/flow-ui/style.css';
```

The viewer fills its container — ensure the parent element has explicit dimensions.
