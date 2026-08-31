# Visual Editor

The `WorkflowEditor` component provides a drag-and-drop workflow builder with real-time validation.

## Usage

```tsx
import { WorkflowEditor } from '@apitomy/flow-ui';
import type { Workflow, ValidationProblem } from '@apitomy/flow-ui';

function MyWorkflowEditor() {
  const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);

  return (
    <WorkflowEditor
      workflow={workflow}
      onChange={setWorkflow}
      theme="light"
      onValidationChange={(problems) => {
        const hasErrors = problems.some(p => p.severity === 'error');
        setSaveDisabled(hasErrors);
      }}
    />
  );
}
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `Workflow` | Yes | The workflow definition to edit |
| `onChange` | `(workflow: Workflow) => void` | Yes | Called on every change with the updated definition |
| `theme` | `FlowTheme` | No | `'light'` or `'dark'` (default: `'light'`). Controls the color scheme of the editor and React Flow canvas |
| `onValidationChange` | `(problems: ValidationProblem[]) => void` | No | Called when validation results change (e.g. to disable a Save button when errors exist) |

## Features

### Node Palette

A toolbar at the top lists all five node types. Drag a node type from the palette onto the canvas to add it.

### Canvas

The canvas uses [React Flow](https://reactflow.dev/) for rendering and interaction:

- **Drag** nodes to reposition them
- **Connect** nodes by dragging from a source handle to a target handle
- **Select** a node or edge by clicking it
- **Pan** the canvas by dragging the background
- **Zoom** with the scroll wheel or the controls in the bottom-left

### Custom Nodes

Each node type has a distinct visual style:

| Type | Color | Icon | Shape |
|------|-------|------|-------|
| Start | Green | Play | Pill |
| End | Red | Flag | Pill |
| Action | Blue | Gear | Rounded rectangle |
| Human Task | Light blue | User | Rounded rectangle |
| Receive Event | Cyan | Bolt | Rounded rectangle |
| Wait | Teal | Clock | Rounded rectangle |

### Custom Edges

Edges display a small badge at their midpoint showing:

- The edge's **label** (if set)
- The word **"default"** (for default fallback edges, styled with a blue badge)
- The **condition expression** (if set and no label)

### Properties Panel

A panel on the right side shows configuration fields for the selected node or edge:

**Node properties:**

- Name (all node types)
- Action Type (action nodes)
- Event Type (receive-event nodes)
- Description, Inputs (label/expression pairs), Outputs (name, type dropdown, required checkbox per field) (human task nodes)
- Duration (ISO 8601 string) (wait nodes)
- Node ID (read-only)

**Edge properties:**

- Label
- Condition (EL expression)
- Priority
- Default edge checkbox
- Edge ID (read-only)

Click the canvas background to deselect and hide the properties panel.

### Live Validation

The editor runs the TypeScript workflow validator on every change. Validation feedback is displayed in two ways:

**Inline indicators:** Nodes with errors show a red border. Nodes with warnings show an amber border.

**Problems panel:** A collapsible panel at the bottom lists all validation problems grouped by severity (errors first). Click a problem to select and center the affected node or edge on the canvas.

### Host-provided validation

In addition to the editor's built-in validation, a host application can contribute its own
validations through the `validate` function on the editor SPI. Problems it returns are merged
with the built-in problems and drive the same Problems panel, per-node error/warning
highlighting, and `onValidationChange` callback.

The validator may run synchronously or return a `Promise`, so it can perform server-backed
checks. The editor debounces calls while the user types and ignores stale (out-of-order)
results, so only the most recent run is ever shown. If the validator throws or rejects, its
problems are cleared and a warning is logged; built-in validation is never affected.

```ts
import { type EditorSpi, type ValidationProblem } from '@apitomy/flow-ui';

const spi: EditorSpi = {
  validate: async (workflow): Promise<ValidationProblem[]> => {
    const problems: ValidationProblem[] = [];
    // ...host-specific rules, optionally awaiting backend calls...
    return problems;
  },
};
```

Host problems use the same shape as built-in ones (`severity`, `code`, `message`, and optional
`nodeId` / `edgeId`). Namespace your `code` values (for example, prefix them with `HOST_`) to
keep them distinguishable from the built-in codes.

Pass a stable `validate` reference — wrap it in `useCallback` (or define it outside the component)
— so the editor doesn't rebuild its debounced validator and restart the debounce on every render.

## Styling

The editor requires these CSS imports in your application:

```typescript
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import '@apitomy/flow-ui/style.css';
```

The editor fills its container — ensure the parent element has explicit dimensions (e.g. `height: 100%`).
