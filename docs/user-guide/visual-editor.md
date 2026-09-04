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
| `onValidationChange` | `(problems: ValidationProblem[]) => void` | No | Called when validation results change (e.g. to disable a Save button when errors exist). Receives the merged built-in and host problems |
| `spi` | `EditorSpi` | No | Host extension object. Supplies action-type descriptors (`actionTypes`) and/or a custom `validate` function. See [Host Extension (SPI)](#host-extension-spi) |

## Features

### Node Palette

A toolbar at the top lists all six node types. Drag a node type from the palette onto the canvas to add it.

The toolbar also has a **Tidy up** button that runs auto-layout (see [Auto-Layout](#auto-layout)
below), **Import** / **Export** / **Image** buttons for moving definitions in and out of the editor
(see [Import and Export](#import-and-export) below), and a **Simulate** button that opens interactive
routing simulation (see [Simulation and Condition Testing](#simulation-and-condition-testing) below).

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
- Description, Inputs (label/expression pairs), and Outputs (human task nodes). Each output is a
  form field the assignee fills in to complete the task and supports rich authoring metadata: name,
  type dropdown, required checkbox, label, help/description text, a widget (`text` / `textarea` /
  `select`), a default value, and — for the `select` widget — an editable list of label/value
  options. Only the name is required; the rest are optional and drive the runtime completion form
  the host renders. See [Engine Usage](engine-usage.md#output-field-metadata) for the full field
  reference.
- Duration (ISO 8601 string) (wait nodes)
- Node ID (read-only)

**Edge properties:**

- Label
- Condition (EL expression), with an inline **Test condition** affordance (see
  [Simulation and Condition Testing](#simulation-and-condition-testing))
- Priority
- Default edge checkbox
- Edge ID (read-only)

Click the canvas background to deselect and hide the properties panel.

### Live Validation

The editor runs the TypeScript workflow validator on every change. Validation feedback is displayed in two ways:

**Inline indicators:** Nodes with errors show a red border. Nodes with warnings show an amber border.
Each affected node also shows a small corner badge in the top-right — red for errors, amber for
warnings — carrying the highest-severity problem for that node, with the message available on hover.

**Problems panel:** A collapsible panel at the bottom lists all validation problems grouped by severity (errors first). Click a problem to select and center the affected node or edge on the canvas.

### Auto-Layout

The editor can arrange nodes automatically using a layered graph layout (powered by
[dagre](https://github.com/dagrejs/dagre)), so you never have to position nodes by hand.

- **Tidy up button** — click **Tidy up** in the toolbar at any time to re-flow the whole graph
  left-to-right and fit it to the viewport.
- **Automatic on load** — when a workflow is opened whose nodes have no positions (or whose nodes
  all overlap at the same coordinates), the editor lays it out automatically and emits the computed
  positions through `onChange`. Workflows that already have valid positions are left untouched.

### Import and Export

Workflow definitions are portable artifacts — plain JSON that can be moved between environments,
shared, checked into source control, or seeded as examples. The editor toolbar provides three
affordances for this:

- **Import** — load a workflow definition from a `.json` file into the editor. Import is defensive:
  the file is parsed and run through the built-in validation *before* it is rendered. Malformed JSON
  or a definition that is missing required structure (`id`, `name`, `nodes`, `edges`) is rejected
  with an error banner, and a definition with error-severity validation problems is refused rather
  than loading a broken graph. A successfully imported definition replaces the canvas contents and is
  emitted through `onChange`; nodes without positions are auto-laid-out.
- **Export** — download the current definition as a pretty-printed JSON file, named after the
  workflow's id.
- **Image** — export the current canvas as a PNG image, framed to fit the whole graph. Useful for
  documentation, PR descriptions, and design discussions.

The JSON helpers are also exported for host reuse:

```ts
import { serializeWorkflow, parseWorkflow, downloadWorkflowJson } from '@apitomy/flow-ui';

const json = serializeWorkflow(workflow);        // pretty-printed, portable JSON
const result = parseWorkflow(json);              // { workflow?, problems, error? }
if (result.workflow) {
  // accepted: no fatal error and no error-severity validation problems
}
```

### Simulation and Condition Testing

The **Simulate** button in the toolbar opens an interactive simulation of the workflow's routing
logic against a sample context — without deploying or running a real instance. It answers "which
branch does this input take?" and "does my condition evaluate the way I think?" entirely at
authoring time. The routing and condition semantics match the Java engine exactly (priority-ordered
edge selection, `isDefault` fallback, and Jakarta EL condition evaluation), so the path you see in
the editor is the path a real instance would take.

**Running a simulation:**

1. Click **Simulate** to open the simulation panel on the right.
2. Enter a **sample start context** as JSON.
3. Click **Start**, then **Step** (advance one transition) or **Run** (run to the next block or a
   terminal state). **Reset** clears the run.
4. Where a node would block for real work — `action`, `human-task`, or `receive-event` — the
   simulation pauses so you can supply a **mock output** (JSON). The output is merged into the
   context, exactly as a real node's output would be, and the run continues. `wait` nodes route
   through immediately (no input needed).

**What the canvas shows:**

- **Path taken** — visited nodes stay fully opaque; unvisited nodes dim; the current node is ringed.
  A blocked node is ringed in amber and a failed node in red.
- **Edge outcomes** — the edge that was taken is drawn in green; conditions that evaluated false are
  dimmed/dashed in red; edges skipped after an earlier match are faded; an edge whose condition
  threw an error is highlighted in red.

The panel also shows the run **status**, the **path** (click any step to focus that node), the
evolving **context**, and any **error** — tied to the offending node or edge, with a jump-to link.

**Inline condition testing:** when an edge is selected (outside simulation mode), the properties
panel shows a **Test condition** affordance below the condition field. Paste or edit a sample
context and click **Evaluate** to see the condition's boolean result — or a clear evaluation error —
for that one edge, using the same evaluator as the full simulation.

> Simulation executes routing logic only. It never runs real host node executors or side effects,
> and simulation state is transient — it is never persisted into the saved workflow.

This means a host can construct a `Workflow` without assigning any `position` values and the editor
will produce a sensible layout on first render.

### Host Extension (SPI)

A host application can extend the editor by passing an `EditorSpi` object to the `spi` prop:

```ts
import { type EditorSpi } from '@apitomy/flow-ui';

const spi: EditorSpi = {
  actionTypes: [ /* ... */ ],
  validate: async (workflow) => [ /* ... */ ],
};
```

```ts
interface EditorSpi {
  actionTypes?: ActionTypeProvider;   // action-type descriptors for the properties panel
  validate?: WorkflowValidator;       // host-contributed validation
}
```

Both fields are optional; provide either or both.

#### Action-type descriptors

`actionTypes` supplies the set of action types a host understands, so the properties panel can offer
them as choices and render typed input/output fields. It is either an array of descriptors or a
function returning a `Promise` of them (so the list can be fetched from a backend):

```ts
type ActionTypeProvider = ActionTypeDescriptor[] | (() => Promise<ActionTypeDescriptor[]>);

interface ActionTypeDescriptor {
  value: string;                 // stored in the node's actionType config
  label: string;                 // shown in the dropdown
  description?: string;
  inputs?: ActionTypeField[];
  outputs?: ActionTypeField[];
}

interface ActionTypeField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required?: boolean;
  description?: string;
}
```

#### Host-provided validation

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
