# Visual Editor

The `WorkflowEditor` component provides a drag-and-drop workflow builder with real-time validation.

## Usage

```tsx
import { WorkflowEditor } from '@apitomy/flow-ui';
import { useState } from 'react';
import type { Workflow } from '@apitomy/flow-ui';

function MyWorkflowEditor({ initialWorkflow }: { initialWorkflow: Workflow }) {
    const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
    return (
        <div style={{ height: 700 }}>
            <WorkflowEditor workflow={workflow} onChange={setWorkflow} theme="light" />
        </div>
    );
}
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `workflow` | `Workflow` | Yes | Mount-time graph and live host metadata; see synchronization below |
| `onChange` | `(workflow: Workflow) => void` | Yes | Publishes committed document revisions, including undo/redo and import |
| `theme` | `FlowTheme` | No | `'light'` or `'dark'` (default: `'light'`). Controls the color scheme of the editor and React Flow canvas |
| `onValidationChange` | `(problems: ValidationProblem[]) => void` | No | Called when validation results change (e.g. to disable a Save button when errors exist). Receives the merged built-in and host problems |
| `spi` | `EditorSpi` | No | Host extension object. Supplies action-type descriptors (`actionTypes`) and/or a custom `validate` function. See [Host Extension (SPI)](#host-extension-spi) |

## Features

### Document ownership and synchronization

The graph is **mount-initialized**, not a controlled value. Parent `id`, `name`, `description`, and
`version` changes apply to the current graph as document edits. Replacing prop nodes/edges does not
replace an in-progress canvas. To open a different document or accept a remote full replacement, remount:

```tsx
<WorkflowEditor key={documentSessionId} workflow={workflow} onChange={setWorkflow} />
```

`documentSessionId` is a host-managed replacement key, not a counter incremented on each local edit.
Remounting resets local history, selection, drafts, and simulation. Stable `onChange` echoes are supported;
the API does not reconcile remote edits or distinguish asynchronous replay of old metadata. Broader host
synchronization is tracked in [#121](https://github.com/Apitomy/apitomy-flow/issues/121).

A positioned mount emits no `onChange`. Fallback layout emits its computed positions once and establishes
the initial history baseline. Selection, measurements, and in-progress drag frames do not publish edits.
Imports commit metadata and graph together and are undoable. Pass new immutable values from the host.

### Undo, drafts, and interaction modes

Node/edge properties, IDs, add/delete/connect/clone, completed drags, tidy, imports, and metadata edits
participate in document history. A typing session in one field coalesces; changing focus/field ends that
group. Discrete controls form separate edits. Node deletion removes incident edges atomically.

Undo/redo restores panel selection and canvas node/edge selection together with the document snapshot;
selection-only actions still create no history entry and emit no document change.

Keyboard undo/delete belongs to the focused editor; text controls retain native shortcuts and IME input.
Simulation blocks document mutations and history commands. Manual canvas lock blocks structural canvas
edits but still allows property edits, import, and history. Inspection remains available.

Input-map rows retain stable identities and unsaved empty/duplicate-key drafts. Empty keys are not saved;
duplicate keys show a warning and serialize the last entry. Untouched JSON literals retain their types;
editing a value field makes it an expression string. Drafts reset on selection, import, or history travel.

### Node Palette

A toolbar at the top lists all six node types. Drag a node type from the palette onto the canvas to add it.

The toolbar also has a **Tidy up** button that runs auto-layout (see [Auto-Layout](#auto-layout)
below), **Import** / **Export** / **Image** buttons for moving definitions in and out of the editor
(see [Import and Export](#import-and-export) below), and a **Simulate** switch that opens interactive
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
- Node ID (editable). Nonblank unique IDs update connected edge endpoints and selection atomically;
  blank/duplicate IDs are not committed. Renaming does not rewrite arbitrary host metadata or expressions.

**Edge properties:**

- Label
- Condition (EL expression), with an inline **Test condition** affordance (see
  [Simulation and Condition Testing](#simulation-and-condition-testing))
- Priority
- Default edge checkbox
- Edge ID (read-only)

Click the canvas background to deselect and hide the properties panel.

### Live Validation

The editor validates semantic document revisions. Selection and layout-only edits reuse the prior semantic
revision; built-in and host validation do not rerun just to move a node. Feedback is displayed in two ways:

**Inline indicators:** Nodes with errors show a red border. Nodes with warnings show an amber border.
Each affected node also shows a small corner badge in the top-right — red for errors, amber for
warnings — carrying the highest-severity problem for that node, with the message available on hover.

**Problems panel:** A collapsible panel groups problems by severity, errors first. Click a problem to
select and center its affected node or edge.

### Fork/Join Hint

The editor tags nodes with a small corner badge showing their role in a parallel region: **Fork** on a
node whose outgoing edges all run in parallel, and **Join** on the node where those branches
re-converge. The hint is derived live from the graph shape as you draw edges, so it appears as soon as
a node gains two or more unconditional outgoing edges and disappears if you add a condition or default
that turns the branch into an exclusive choice.

To author a fork, draw two or more edges out of a node and leave them all unconditional (no condition,
no default). To make the same node an exclusive choice instead, give the edges conditions and mark one
as the default. The editor validates parallel structure live and flags `MIXED_FORK_EDGES`,
`FORK_WITHOUT_JOIN`, and `PARALLEL_BRANCH_REACHES_END` in the Problems panel and on the node.

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

The **Simulate** switch in the toolbar opens an interactive simulation of the workflow's routing
logic against a sample context — without deploying or running a real instance. It answers "which
branch does this input take?" and "does my condition evaluate the way I think?" entirely at
authoring time. Shared Java/TypeScript fixtures verify priority-ordered edge selection, `isDefault`
fallback, structured fork/join routing, and a browser subset of Jakarta EL. Simulation is an authoring
aid; host execution and full Jakarta EL behavior require verification with the Java engine.

**Running a simulation:**

1. Turn on **Simulate** to open the simulation panel on the right.
2. Enter a **sample start context** as JSON.
3. Click **Start**, then **Step** (advance one runnable branch, dispatching all children at a fork) or
   **Run** (repeat advancement until blocked or terminal). A Step can consume several budget units at a
   fork; it is not necessarily one transition-budget unit. **Reset** clears the run.
4. Where a node would block for real work — `action`, `human-task`, or `receive-event` — the
   simulation pauses so you can supply a **mock output** (JSON). The output is merged into the
   context using declared output aliases and receive-event mappings, and the run continues. `wait`
   nodes route through immediately (no input needed); real engine waits pause for external completion.

**Expression support:** the browser supports JSON property/index access, literals, arithmetic,
comparisons, logical operators, `empty`, and lazy ternary expressions (`condition ? yes : no`).
Conditions select an edge only when the result is boolean `true`. Method/function calls, collection
literals, lambdas, assignments, sequences and concatenation require the engine's full Jakarta EL.
The editor retains such expressions and reports `UNSUPPORTED_EXPRESSION_DIALECT`, rather than calling
them malformed. This warning means the browser cannot validate them; Java validation remains authoritative.
Trying to simulate them produces an explicit unsupported-dialect error. Edge conditions and event-output
mappings use the same parser; malformed supported syntax such as `1e` or `1 +` is diagnosed in both.
Unquoted Unicode identifiers such as `context.café` also receive the advisory unsupported warning and
remain importable. Use quoted keys such as `context['café']` for browser evaluation.

**Loop guard:** each advancement allows 100 edge moves across runnable branches. Successful fork selection
has no extra charge; each dispatched child edge consumes one unit. Exactly 100 moves can park all children;
an additional move fails before entering that child, retaining prior branch arrivals, order, context, and
history. Moves before the fork reduce its remaining budget. Resuming a blocked node starts a fresh budget;
repeated Step/Run calls do not. Actions always pause in the simulator, while real synchronous actions can
run uninterrupted, so budget placement can differ from a real run. Shared `conformance/fork-budgets.json`
fixtures exercise exact/excess initial and partial-budget forks through both Step and Run.
Simulation does not exercise event correlation, timers, required-output enforcement or error-handler
retries. Numeric extremes and Java-specific coercions are outside the verified browser contract.

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

Simulation supports parallel workflows. After a fork, the panel lists every active node and animates
each active branch on the canvas. When more than one branch is blocked on input, a picker lets you
choose which blocked node to resume: fill in its mock output, deliver it, and repeat for the next
blocked branch. The execution path is shown grouped per branch.

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

The callback receives a **semantic snapshot**, not necessarily the full current document. A stable
`spi.validate` runs on semantic revisions; selection, dragging, layout-only edits, and layout-only
undo/redo do not invoke it again. Its coordinates remain those captured at the last semantic revision;
the next semantic edit captures current coordinates. Replacing the callback reference can schedule a
new run, but that run still receives the retained semantic snapshot, not refreshed layout coordinates.

Treat the supplied workflow as read-only and keep validation pure: do not mutate the workflow or editor
state. Position-sensitive work must use the full current document received through `onChange`. Keep that
latest document/reference in the host rather than using a saved semantic-validator input as current state.
Selection-only changes do not alter that document and do not emit `onChange`.

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

## Verification

[Browser verification](../developer-guide/documentation-checks.md#browser-verification) exercises actual
ReactFlow interactions, focus-owned shortcuts, delayed imports, async SPI responses, and the built npm
package. These checks cover Chromium; they are not a full accessibility or cross-browser certification.
