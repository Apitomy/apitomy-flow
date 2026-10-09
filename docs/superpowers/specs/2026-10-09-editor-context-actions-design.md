# Editor Context Actions — Design

Date: 2026-10-09
Status: Approved (brainstorming)

## Context

This is sub-project #4 of the AI-assisted editing feature set (see
`2026-10-08-ai-assisted-editing-design.md`). It gives the host (Apitomy Axiom) entry points on the
`WorkflowEditor` canvas so a user can start AI work where their intent begins, for example "fix this node" or
"add error handling here". Flow never talks to the AI: it reports structured context to the host, and the
host owns every prompt and conversation UI.

## Decisions

| Topic | Decision |
|---|---|
| Prompt UI | None in Flow. Host actions are menu items only; the host opens its own UI. |
| Declaring actions | One function, `spi.contextActions(context)`, called each time a menu opens. |
| Components | `WorkflowEditor` only. `WorkflowViewer` keeps `nodeContextMenuItems` unchanged. |
| Read-only | Host actions are shown; built-in editing items are hidden. |

## §1 API and context

The function is added to `EditorSpi`, next to `actionTypes` and `validate`:

```ts
interface EditorSpi {
    actionTypes?: ActionTypeProvider;
    validate?: WorkflowValidator;
    /** Called each time a context menu opens; returns host items shown below the built-in ones. */
    contextActions?: (context: FlowContext) => ContextAction[];
}

type FlowTarget =
    | { kind: 'canvas'; flowPosition: { x: number; y: number } }
    | { kind: 'node'; nodeId: string }
    | { kind: 'edge'; edgeId: string }
    | { kind: 'selection'; nodeIds: string[]; edgeIds: string[] }
    | { kind: 'problem'; problem: ValidationProblem };

interface FlowContext {
    target: FlowTarget;
    workflow: Workflow;
    contentRevision: string;
    selection: EditorSelection;
    problems: ValidationProblem[];
    readOnly: boolean;
    screenPosition: { x: number; y: number };
}

interface ContextAction {
    id: string;
    label: string;
    icon?: React.ReactNode;
    danger?: boolean;
    disabled?: boolean;
    onSelect: (context: FlowContext) => void;
}
```

Field rules:

- **`workflow`** is a detached copy of the current document.
- **`contentRevision`** is the revision of that document. An agent uses it as the `baseRevision` of any
  change set it produces, so the existing stale check catches edits made in the meantime.
- **`selection`** is the canvas selection when the menu opened, as `{ nodeIds, edgeIds }` sorted by id.
- **`problems`** holds the built-in and host validation problems currently shown in the Problems panel.
- **`screenPosition`** is the click position in viewport (client) coordinates, so the host can anchor its own
  UI there. For keyboard-opened menus it is the centre of the focused element.
- **`flowPosition`** (canvas target only) is the click position in graph coordinates, for example where an
  agent should add a node.
- **One context per opening:** the context is built once when the menu opens, and that same object is passed
  to `onSelect`.

Target selection:

- **Inside a multi-selection:** right-clicking a node or edge that is part of a selection of two or more
  elements gives a `selection` target with the full selection.
- **Single element:** otherwise, right-clicking a node or edge gives a `node` or `edge` target for that
  element. As today, this does not change the selection.
- **Canvas background:** right-clicking the background gives a `canvas` target.
- **Problem row:** opening the menu on a Problems panel row gives a `problem` target.

## §2 Menus, surfaces and behaviour

**Menu component.** The existing `NodeContextMenu` is generalised into a `ContextMenu` component:

- **Order:** built-in items come first, then a divider, then host items. The divider appears only when both
  groups are non-empty.
- **Accessibility:** the menu has `role="menu"` and its items `role="menuitem"`. Arrow Up/Down move focus,
  wrapping at the ends; Home/End jump to the first and last item; Enter or Space selects; Escape or clicking
  outside closes. On close, focus returns to the element that opened the menu. Disabled items are skipped by
  the arrow keys and cannot be selected.
- **Position:** the menu is clamped so it stays inside the editor's bounds.

**Surfaces:**

| Surface | Opened by | Built-in items |
|---|---|---|
| Canvas background | Right-click | None |
| Node | Right-click; ContextMenu key or Shift+F10 when focused | Clone, Delete |
| Edge | Right-click; ContextMenu key or Shift+F10 when focused | Delete |
| Multi-selection | Right-click on a selected element | Delete (all selected) |
| Problems panel row | Right-click; a "⋯" button on the row | None |

The "⋯" button on a Problems panel row is rendered only when `contextActions` is configured. When the host
returns no items for that row, the button is disabled.

**Rules:**

- **Read-only:** built-in items are hidden and host items are shown.
- **Simulation:** while simulating, no menus open on canvas surfaces or Problems panel rows.
- **Interactivity lock:** when the lower-left lock disables canvas interaction, built-in items are hidden and
  host items are still shown.
- **Nothing to show:** if the merged list is empty, Flow does not open a menu and does not prevent the
  browser's default context menu.
- **Fresh items:** `contextActions` is called on every opening; Flow does not cache its result.

**Errors:**

- If `contextActions` throws, Flow logs it with `console.error` and shows only the built-in items.
- If it returns something that is not an array, Flow treats it as an empty list.
- Items without a string `id` and `label` are dropped, with a `console.error`.
- If `onSelect` throws, Flow catches it, logs it with `console.error` and closes the menu.

## Testing

Vitest, on pure helpers (no jsdom):

- `buildFlowContext(state, target, problems, readOnly, screenPosition)`: detached workflow, revision, sorted
  selection.
- `menuTarget(clicked, selection)`: single element, or the selection when clicking inside a multi-selection.
- `resolveMenuItems(builtIns, contextActions, context)`: order and divider, a throwing host, non-array
  results, invalid items.
- The menu keyboard reducer: wrapping, Home/End, skipping disabled items.

Playwright (`ui/browser/context-actions.spec.ts`, with a `?context` mode on the browser test page that logs
the context each action receives):

- Right-clicking a node, an edge, the canvas and a problem row shows host items, and selecting one delivers a
  context with the correct target.
- Right-click inside a multi-selection gives a `selection` target.
- The menu is fully keyboard-operable, including opening on a focused node with Shift+F10.
- A read-only editor shows only host items.
- A throwing `contextActions` still shows Clone and Delete.
- With no items at all, no menu is shown.

## Documentation

Add a "Context actions" section to `docs/user-guide/ai-assisted-editing.md`, with an example that opens a
host prompt anchored at `screenPosition` and builds a change set from `contentRevision`.

## Out of scope

- Any prompt or text entry UI in Flow.
- Context actions in `WorkflowViewer`.
- A toolbar button or keyboard shortcut that opens host actions without a target.
