# Action Type Appearance Design

## Goal

Let a host give Action nodes a distinct icon and/or accent color based on the node's action type (send an
email, post to Slack, call an AI agent, ...). Only the host knows how each action type should look. The
`WorkflowEditor` and `WorkflowViewer` must render the same appearance from the same host-supplied input.

## Decisions

| Topic | Decision |
|---|---|
| Where appearance is defined | On `ActionTypeDescriptor`, the catalog the host already supplies. |
| What is customizable | An optional `icon` and an optional single accent `color`. |
| Persistence | None. Appearance is never written into the workflow document. |
| Viewer input | New optional `actionTypes?: ActionTypeProvider` prop, same type as `spi.actionTypes`. |
| Fallback | No catalog, catalog still loading, or no matching descriptor: the default Action look. |
| Other node types | Out of scope. Start, End, Human Task, Receive Event and Wait are unchanged. |
| `WorkflowDiffViewer` | Out of scope for now; it can adopt the same prop later. |

## API

`ui/src/types/spi.ts`:

```ts
export interface ActionTypeDescriptor {
  value: string;
  label: string;
  description?: string;
  inputs?: ActionTypeField[];
  outputs?: ActionTypeField[];
  /** Icon shown on Action nodes of this type, replacing the default play icon. */
  icon?: ReactNode;
  /**
   * Accent color for Action nodes of this type: any CSS color, including `var(...)`. It sets the node's
   * border and icon color; background and text stay theme-controlled.
   */
  color?: string;
}
```

`ui/src/components/WorkflowViewer.tsx`:

```ts
export interface WorkflowViewerProps {
  // ...existing props
  /** The Action Type catalog, used for Action node icons and colors. Pass the same value as `spi.actionTypes`. */
  actionTypes?: ActionTypeProvider;
}
```

Hosts share one catalog between both components:

```tsx
const actionTypes: ActionTypeDescriptor[] = [
  { value: 'email.send', label: 'Send email', icon: <EnvelopeIcon />, color: '#c9190b' },
  { value: 'slack.post', label: 'Post to Slack', icon: <SlackIcon /> },
];
<WorkflowEditor spi={{ actionTypes }} ... />
<WorkflowViewer actionTypes={actionTypes} ... />
```

## Design

### Lookup (pure)

New `ui/src/utils/actionAppearance.ts`:

```ts
export interface ActionAppearance { icon?: ReactNode; color?: string }

/** Appearance for an action node's `actionType`, or undefined when the catalog has no styled match. */
export function actionAppearanceFor(actionType: unknown, catalog: ActionTypeCatalog): ActionAppearance | undefined;

/** Map of node id to appearance for every action node with a styled descriptor. */
export function actionAppearanceByNodeId(nodes: WorkflowNode[], catalog: ActionTypeCatalog):
    Map<string, ActionAppearance>;
```

The lookup uses whatever descriptors the catalog currently holds and ignores `status`. On a first async
load the list is empty, so nodes use the default look. During a reload the previous list is kept, so nodes
don't flash.

It returns `undefined` when the descriptor is missing or has neither `icon` nor `color`. A blank or
non-string `color` is ignored.

### Data flow

Both components follow the existing pattern used for `unresolvedActionType`: compute per-node values from
the catalog and attach them to React Flow node data.

- `FlowNodeData` (`ui/src/utils/conversion.ts`) gains `actionAppearance?: ActionAppearance`.
- **Editor** (`WorkflowEditor.tsx`, the `nodesWithValidation` memo around line 274): adds
  `actionAppearance` from `actionAppearanceByNodeId(semanticWorkflow.nodes, actionTypeCatalog)`. Nodes without an
  appearance keep their current object identity, as they do today.
- **Viewer** (`WorkflowViewer.tsx`): calls `useActionTypeCatalog(actionTypes)` (the existing hook, so
  async providers, reloads and failures behave exactly as in the Editor) and adds `actionAppearance` in its
  `nodes` memo.

Because the appearance lives in node data, it updates live when the user changes a node's action type in
the Properties panel, and when the host passes a new catalog.

### Rendering

`ActionNode.tsx`:

- Renders `appearance.icon` when present, else `PlayIcon`. The icon sits in a fixed-size wrapper
  (`.flow-node-action-icon`, about 16px) so host icons of any size don't distort the node.
- When `appearance.color` is present, sets an inline custom property on the node root:
  `style={{ '--flow-node-action-accent': color }}`.

`ActionNode.css`:

- `border-color: var(--flow-node-action-accent, var(--flow-node-action-border, #06c))`.
- `.flow-node-action-icon { color: var(--flow-node-action-accent, inherit) }`.

Background, text, the selection ring, the validation badge, the unresolved marker, the parallel hint and
the Viewer's run-state styles are unchanged. Those styles (`WorkflowViewer.css`) use opacity, box-shadow
rings and a failed overlay rather than the border, so they still apply on top of an accented node.

### Properties panel (small extra)

`ActionTypeSelect` shows each descriptor's `icon` before its label in the dropdown options. No color is
applied there.

## Error handling

- Invalid CSS color strings are passed through; the browser ignores them and the default border shows.
- A descriptor `icon` that throws while rendering is the host's bug and is not caught specially.

## Testing

- `actionAppearance.test.ts`: match, no match, descriptor without icon or color, blank color, non-string
  `actionType`, catalog `none`/`loading`, and node-id map over a workflow with mixed node types.
- `npx tsc --noEmit` and `npm run lint`.
- Dev app: give a few demo catalog entries icons and colors. Check the Editor and Viewer side by side in
  light and dark themes, including changing an action type and an async catalog loading.

## Documentation

- `docs/user-guide/visual-editor.md`: describe `icon` and `color` in the SPI section.
- `docs/user-guide/workflow-viewer.md`: document the new `actionTypes` prop and the shared-catalog example above.
