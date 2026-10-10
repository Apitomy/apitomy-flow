# Editor Context Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Let a host add its own actions to keyboard-accessible context menus on the `WorkflowEditor` canvas
(background, nodes, edges, multi-selections) and on Problems panel rows. Each action receives a `FlowContext`
describing what the user targeted.

**Architecture:**
- **Pure helpers** in `ui/src/contextActions/` decide the menu's behaviour:
  - which target a click maps to, and the context snapshot passed to the host;
  - the merged menu entries (built-in first, then host), with host errors contained;
  - keyboard focus movement and on-screen clamping.
- **A presentational `ContextMenu` component** replaces `NodeContextMenu`.
- **`WorkflowEditor` wires every surface** through one `openMenu` function.

**Tech Stack:** TypeScript, React 19, `@xyflow/react` 12, vitest (no jsdom), Playwright (`ui/browser/`).

**Spec:** `docs/superpowers/specs/2026-10-09-editor-context-actions-design.md` (read it before starting any
task).

## Global Constraints

- **Branch:** work on `feat/context-actions`. Commit messages must not include any AI or Claude attribution.
- **Testing:**
  - No jsdom and no `@testing-library/react`. Testable logic goes in pure functions tested with vitest.
  - Components are exercised by the Playwright suite.
- **Code style:**
  - Keep each file's existing indentation: `WorkflowEditor.tsx`, `ProblemsPanel.tsx` and `types/spi.ts` use
    2 spaces. New files under `ui/src/contextActions/` use 4 spaces.
  - Use explicit `.ts`/`.tsx` import extensions.
  - Add TSDoc to every exported symbol.
- **Host function:** `contextActions` is called on every menu opening and is never cached. It may also be
  called to decide whether a Problems row's "⋯" button is enabled (spec amendment in Task 5).
- **Menu order:** built-in items first, then a divider (only when both groups are non-empty), then host
  items.
- **Built-in items:**
  - node: `Clone`, then `Delete` (danger);
  - edge: `Delete` (danger);
  - selection: `Delete` (danger), which deletes all selected elements;
  - canvas and problem: none.
- **Built-ins hidden:** built-in items are hidden whenever canvas interaction is disabled, that is when the
  editor is read-only, simulating, or locked. Host items stay visible, except during simulation, when no menu
  opens at all.
- **Empty menu:** if the merged list is empty, no menu opens and the browser's default menu is not
  prevented.
- **Errors:**
  - If `contextActions` throws, log it with `console.error` and show only the built-ins.
  - A non-array result counts as an empty list.
  - Items without a string `id` and `label` are dropped, with a `console.error`.
  - If `onSelect` throws, catch it, log it with `console.error` and close the menu.
- **Accessibility:**
  - `role="menu"` and `role="menuitem"`.
  - ArrowUp/ArrowDown wrap; Home/End jump; Enter/Space select; Escape or an outside click closes.
  - Disabled items are skipped and cannot be selected.
  - Focus returns to the opener on close, unless the selected item already moved focus elsewhere.
- **Verification:**
  - From `ui/`: `npx vitest run <file>`, `npx tsc --noEmit`, `npm run lint`, and
    `npm run test:browser -- <spec>`.
  - Before marking a task done, run the full `npx vitest run`. Tasks 3–6 also run the full
    `npm run test:browser`.

## File Map

| File | Responsibility |
|---|---|
| `ui/src/types/spi.ts` | `FlowTarget`, `FlowContext`, `ContextAction`, `EditorSpi.contextActions` |
| `ui/src/contextActions/flowContext.ts` | `MenuSubject`, `menuTarget`, `buildFlowContext` |
| `ui/src/contextActions/menuItems.ts` | `MenuEntry`, `builtInItems`, `resolveMenuItems`, `runMenuEntry` |
| `ui/src/contextActions/menuNavigation.ts` | `moveFocus`, `clampMenuPosition` |
| `ui/src/components/ContextMenu.tsx` / `.css` | Presentational menu (replaces `NodeContextMenu.*`) |
| `ui/src/components/WorkflowEditor.tsx` | `openMenu`, all canvas surfaces, keyboard opening |
| `ui/src/components/panels/ProblemsPanel.tsx` / `.css` | Row right-click and the "⋯" button |
| `ui/src/index.ts` | Type exports |
| `ui/browser/host.tsx`, `ui/browser/context-actions.spec.ts` | `?context` / `?readonly` modes, e2e |
| `docs/user-guide/ai-assisted-editing.md`, spec | Docs |

---

### Task 1: Types and the context snapshot

**Files:**
- Modify: `ui/src/types/spi.ts`, `ui/src/index.ts`
- Create: `ui/src/contextActions/flowContext.ts`, `ui/src/contextActions/flowContext.test.ts`

**Interfaces:**
- Consumes:
  - `EditorState` (`ui/src/hooks/editorState.ts`), with `document` and `contentRevision`
  - `selectionOf(state): EditorSelection` (`ui/src/hooks/editorNotifications.ts`)
- Produces:
  - Types: `FlowTarget`, `FlowContext`, `ContextAction`, `MenuSubject`
  - `menuTarget(subject: MenuSubject, selection: EditorSelection): FlowTarget`
  - `buildFlowContext(state: EditorState, target: FlowTarget, problems: ValidationProblem[], readOnly: boolean,
    screenPosition: { x: number; y: number }): FlowContext`

- [ ] **Step 1: Add the types to `ui/src/types/spi.ts`** (2-space indent)

Add `import type { ReactNode } from 'react';` and
`import type { EditorSelection } from '../hooks/editorNotifications.ts';` at the top. Then append:

```ts
/** What a context menu was opened on. */
export type FlowTarget =
  | { kind: 'canvas'; flowPosition: { x: number; y: number } }
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; edgeId: string }
  | { kind: 'selection'; nodeIds: string[]; edgeIds: string[] }
  | { kind: 'problem'; problem: ValidationProblem };

/** Snapshot handed to `contextActions` and to the chosen action; built once per menu opening. */
export interface FlowContext {
  target: FlowTarget;
  /** Detached copy of the current document. */
  workflow: Workflow;
  /** Revision of `workflow`; use it as the `baseRevision` of change sets produced from this context. */
  contentRevision: string;
  /** Canvas selection when the menu opened, sorted by id. */
  selection: EditorSelection;
  /** Built-in and host problems shown in the Problems panel. */
  problems: ValidationProblem[];
  readOnly: boolean;
  /** Viewport (client) coordinates of the click, or the centre of the focused element for keyboard opens. */
  screenPosition: { x: number; y: number };
}

/** A host-defined context menu item. */
export interface ContextAction {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: (context: FlowContext) => void;
}
```

Then add this member to `EditorSpi`:

```ts
  /**
   * Called each time a context menu opens on the canvas or a Problems panel row. Returns the host items
   * shown below the built-in ones. It may also be called to decide whether a Problems row's actions button
   * is enabled.
   */
  contextActions?: (context: FlowContext) => ContextAction[];
```

In `ui/src/index.ts`, extend the existing `export type { EditorSpi, ... } from './types/spi.ts';` line with
`FlowTarget, FlowContext, ContextAction`.

- [ ] **Step 2: Write the failing tests `ui/src/contextActions/flowContext.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildFlowContext, menuTarget } from './flowContext.ts';
import { createEditorState, editorReducer } from '../hooks/editorState.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow = (): Workflow => ({ id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'e', type: 'end', name: 'E', config: {}, position: { x: 300, y: 0 } },
], edges: [{ id: 'se', source: 's', target: 'e', priority: 0, isDefault: false }] });

describe('menuTarget', () => {
    it('returns the clicked element when it is not part of a multi-selection', () => {
        expect(menuTarget({ kind: 'node', nodeId: 's' }, { nodeIds: ['s'], edgeIds: [] }))
            .toEqual({ kind: 'node', nodeId: 's' });
        expect(menuTarget({ kind: 'edge', edgeId: 'se' }, { nodeIds: ['s', 'e'], edgeIds: [] }))
            .toEqual({ kind: 'edge', edgeId: 'se' });
    });

    it('returns the whole selection when the clicked element is inside a selection of two or more', () => {
        expect(menuTarget({ kind: 'node', nodeId: 'e' }, { nodeIds: ['e', 's'], edgeIds: [] }))
            .toEqual({ kind: 'selection', nodeIds: ['e', 's'], edgeIds: [] });
        expect(menuTarget({ kind: 'edge', edgeId: 'se' }, { nodeIds: ['s'], edgeIds: ['se'] }))
            .toEqual({ kind: 'selection', nodeIds: ['s'], edgeIds: ['se'] });
    });

    it('passes canvas and problem subjects through as copies', () => {
        const canvas = { kind: 'canvas' as const, flowPosition: { x: 1, y: 2 } };
        const result = menuTarget(canvas, { nodeIds: ['s', 'e'], edgeIds: [] });
        expect(result).toEqual(canvas);
        expect(result).not.toBe(canvas);
        const problem = { kind: 'problem' as const, problem: { severity: 'error' as const, code: 'X', message: 'm' } };
        expect(menuTarget(problem, { nodeIds: [], edgeIds: [] })).toEqual(problem);
    });
});

describe('buildFlowContext', () => {
    it('builds a detached snapshot with revision, sorted selection and problems', () => {
        const state = editorReducer(createEditorState(workflow()), { type: 'select', nodeId: 's' });
        const problems = [{ severity: 'warning' as const, code: 'W', message: 'm', nodeId: 's' }];
        const context = buildFlowContext(state, { kind: 'node', nodeId: 's' }, problems, true, { x: 10, y: 20 });
        expect(context).toEqual({ target: { kind: 'node', nodeId: 's' }, workflow: state.document,
            contentRevision: state.contentRevision, selection: { nodeIds: ['s'], edgeIds: [] }, problems,
            readOnly: true, screenPosition: { x: 10, y: 20 } });
        context.workflow.nodes.length = 0;
        context.problems.length = 0;
        expect(state.document.nodes).toHaveLength(2);
        expect(problems).toHaveLength(1);
    });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run src/contextActions/flowContext.test.ts`

Expected: FAIL, because `./flowContext.ts` cannot be resolved.

- [ ] **Step 4: Implement `ui/src/contextActions/flowContext.ts`**

```ts
import type { EditorState } from '../hooks/editorState.ts';
import { selectionOf, type EditorSelection } from '../hooks/editorNotifications.ts';
import type { FlowContext, FlowTarget } from '../types/spi.ts';
import type { ValidationProblem } from '../types/validation.ts';

/** What the user opened a menu on, before multi-selection is taken into account. */
export type MenuSubject = Exclude<FlowTarget, { kind: 'selection' }>;

/**
 * Maps the clicked element to a menu target: clicking inside a selection of two or more elements targets
 * the whole selection, otherwise the clicked element.
 *
 * @param subject the element the menu was opened on
 * @param selection the current canvas selection
 * @returns a fresh target object
 */
export function menuTarget(subject: MenuSubject, selection: EditorSelection): FlowTarget {
    if (subject.kind === 'node' || subject.kind === 'edge') {
        const size = selection.nodeIds.length + selection.edgeIds.length;
        const inside = subject.kind === 'node'
            ? selection.nodeIds.includes(subject.nodeId) : selection.edgeIds.includes(subject.edgeId);
        if (size >= 2 && inside) {
            return { kind: 'selection', nodeIds: [...selection.nodeIds], edgeIds: [...selection.edgeIds] };
        }
    }
    return structuredClone(subject);
}

/**
 * Builds the context snapshot for one menu opening. Everything is copied, so hosts may keep or mutate it.
 *
 * @param state the editor state at the moment the menu opens
 * @param target the menu target
 * @param problems problems currently shown in the Problems panel
 * @param readOnly whether the editor is read-only
 * @param screenPosition viewport coordinates used to anchor host UI
 * @returns the context
 */
export function buildFlowContext(state: EditorState, target: FlowTarget, problems: ValidationProblem[],
    readOnly: boolean, screenPosition: { x: number; y: number }): FlowContext {
    return {
        target: structuredClone(target),
        workflow: structuredClone(state.document),
        contentRevision: state.contentRevision,
        selection: selectionOf(state),
        problems: structuredClone(problems),
        readOnly,
        screenPosition: { ...screenPosition },
    };
}
```

- [ ] **Step 5: Run the tests and checks**

Run: `npx vitest run src/contextActions/flowContext.test.ts && npx tsc --noEmit && npm run lint`

Expected: PASS. If importing `EditorSelection` into `types/spi.ts` creates an import cycle that lint
reports, move the `EditorSelection` interface into `ui/src/types/spi.ts` instead. Re-export it from
`editorNotifications.ts`, so the existing imports keep working.

- [ ] **Step 6: Run the full suite and commit**

Run: `npx vitest run`

Expected: PASS.

```bash
git add ui/src/types/spi.ts ui/src/index.ts ui/src/contextActions
git commit -m "Add context action types and the menu context snapshot"
```

---

### Task 2: Menu entries and keyboard navigation

**Files:**
- Create:
  - `ui/src/contextActions/menuItems.ts`
  - `ui/src/contextActions/menuItems.test.ts`
  - `ui/src/contextActions/menuNavigation.ts`
  - `ui/src/contextActions/menuNavigation.test.ts`

**Interfaces:**
- Consumes: `FlowTarget`, `FlowContext` and `ContextAction` (Task 1)
- Produces:
  - Types: `BuiltInItem`, `BuiltInHandlers`, `MenuEntry`
  - `builtInItems(target: FlowTarget, handlers: BuiltInHandlers): BuiltInItem[]`
  - `resolveMenuItems(builtIns: BuiltInItem[], contextActions: ((context: FlowContext) => ContextAction[]) | undefined, context: FlowContext, log?: (...args: unknown[]) => void): MenuEntry[]`
  - `runMenuEntry(entry: MenuEntry, log?: (...args: unknown[]) => void): void`
  - `moveFocus(entries: MenuEntry[], current: number, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): number`
  - `clampMenuPosition(position: { x: number; y: number }, size: { width: number; height: number }, bounds: { left: number; top: number; right: number; bottom: number }): { x: number; y: number }`

- [ ] **Step 1: Write the failing tests `ui/src/contextActions/menuItems.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { builtInItems, resolveMenuItems, runMenuEntry, type MenuEntry } from './menuItems.ts';
import type { ContextAction, FlowContext } from '../types/spi.ts';

const context: FlowContext = { target: { kind: 'node', nodeId: 'a' }, workflow: { id: 'w', name: 'W', nodes: [], edges: [] },
    contentRevision: 'sha256:x', selection: { nodeIds: [], edgeIds: [] }, problems: [], readOnly: false,
    screenPosition: { x: 0, y: 0 } };
const handlers = () => ({ clone: vi.fn(), deleteElements: vi.fn() });
const labels = (entries: MenuEntry[]) => entries.map(entry => entry.type === 'divider' ? '---' : entry.label);

describe('builtInItems', () => {
    it('offers Clone and Delete for a node, wired to the handlers', () => {
        const h = handlers();
        const items = builtInItems({ kind: 'node', nodeId: 'a' }, h);
        expect(items.map(item => [item.id, item.label, item.danger ?? false])).toEqual([['clone', 'Clone', false], ['delete', 'Delete', true]]);
        items[0].onSelect();
        items[1].onSelect();
        expect(h.clone).toHaveBeenCalledWith('a');
        expect(h.deleteElements).toHaveBeenCalledWith(['a'], []);
    });

    it('offers Delete for edges and selections and nothing for canvas or problems', () => {
        const h = handlers();
        builtInItems({ kind: 'edge', edgeId: 'x' }, h)[0].onSelect();
        builtInItems({ kind: 'selection', nodeIds: ['a', 'b'], edgeIds: ['x'] }, h)[0].onSelect();
        expect(h.deleteElements.mock.calls).toEqual([[[], ['x']], [['a', 'b'], ['x']]]);
        expect(builtInItems({ kind: 'canvas', flowPosition: { x: 0, y: 0 } }, h)).toEqual([]);
        expect(builtInItems({ kind: 'problem', problem: { severity: 'error', code: 'X', message: 'm' } }, h)).toEqual([]);
    });
});

describe('resolveMenuItems', () => {
    const builtIn = [{ id: 'clone', label: 'Clone', onSelect: () => {} }];
    const host = (actions: ContextAction[]) => () => actions;
    const action = (id: string, extra: Partial<ContextAction> = {}): ContextAction => ({ id, label: id.toUpperCase(), onSelect: () => {}, ...extra });

    it('puts built-ins first, a divider only between non-empty groups, then host items', () => {
        expect(labels(resolveMenuItems(builtIn, host([action('ask')]), context))).toEqual(['Clone', '---', 'ASK']);
        expect(labels(resolveMenuItems([], host([action('ask')]), context))).toEqual(['ASK']);
        expect(labels(resolveMenuItems(builtIn, undefined, context))).toEqual(['Clone']);
        expect(resolveMenuItems([], host([]), context)).toEqual([]);
    });

    it('passes the context to the host and to onSelect, and keeps flags', () => {
        const onSelect = vi.fn();
        const provider = vi.fn(host([action('ask', { onSelect, danger: true, disabled: true })]));
        const [entry] = resolveMenuItems([], provider, context);
        expect(provider).toHaveBeenCalledWith(context);
        expect(entry).toMatchObject({ type: 'item', id: 'host:ask', label: 'ASK', danger: true, disabled: true, source: 'host' });
        runMenuEntry(entry);
        expect(onSelect).toHaveBeenCalledWith(context);
    });

    it('contains host failures and drops invalid items', () => {
        const log = vi.fn();
        const throwing = () => { throw new Error('boom'); };
        expect(labels(resolveMenuItems(builtIn, throwing, context, log))).toEqual(['Clone']);
        expect(labels(resolveMenuItems(builtIn, (() => 'nope') as unknown as () => ContextAction[], context, log))).toEqual(['Clone']);
        const invalid = [{ id: 1, label: 'X', onSelect: () => {} }, { id: 'ok', label: 'OK', onSelect: () => {} }, null];
        expect(labels(resolveMenuItems([], () => invalid as unknown as ContextAction[], context, log))).toEqual(['OK']);
        expect(log).toHaveBeenCalledTimes(4);
    });

    it('treats an item without a function onSelect as invalid', () => {
        const log = vi.fn();
        const items = [{ id: 'x', label: 'X' }] as unknown as ContextAction[];
        expect(resolveMenuItems([], () => items, context, log)).toEqual([]);
        expect(log).toHaveBeenCalledTimes(1);
    });
});

describe('runMenuEntry', () => {
    it('logs instead of throwing when an action fails', () => {
        const log = vi.fn();
        const [entry] = resolveMenuItems([], () => [{ id: 'x', label: 'X', onSelect: () => { throw new Error('bad'); } }], context);
        expect(() => runMenuEntry(entry, log)).not.toThrow();
        expect(log).toHaveBeenCalledTimes(1);
    });

    it('does nothing for disabled items and dividers', () => {
        const onSelect = vi.fn();
        const entries = resolveMenuItems([{ id: 'noop', label: 'Noop', onSelect: () => {} }],
            () => [{ id: 'x', label: 'X', disabled: true, onSelect }], context);
        expect(entries.map(entry => entry.type)).toEqual(['item', 'divider', 'item']);
        runMenuEntry(entries[1]);
        runMenuEntry(entries[2]);
        expect(onSelect).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Write the failing tests `ui/src/contextActions/menuNavigation.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { clampMenuPosition, moveFocus } from './menuNavigation.ts';
import type { MenuEntry } from './menuItems.ts';

const item = (id: string, disabled = false): MenuEntry =>
    ({ type: 'item', id, label: id, danger: false, disabled, source: 'host', run: () => {} });
const divider: MenuEntry = { type: 'divider', id: 'divider' };
// Index:            0          1        2                3
const entries = [item('a'), divider, item('b', true), item('c')];

describe('moveFocus', () => {
    it('moves down and up over selectable items, skipping dividers and disabled items, wrapping', () => {
        expect(moveFocus(entries, 0, 'ArrowDown')).toBe(3);
        expect(moveFocus(entries, 3, 'ArrowDown')).toBe(0);
        expect(moveFocus(entries, 0, 'ArrowUp')).toBe(3);
        expect(moveFocus(entries, 3, 'ArrowUp')).toBe(0);
    });

    it('starts from nothing focused and jumps with Home and End', () => {
        expect(moveFocus(entries, -1, 'ArrowDown')).toBe(0);
        expect(moveFocus(entries, -1, 'ArrowUp')).toBe(3);
        expect(moveFocus(entries, 3, 'Home')).toBe(0);
        expect(moveFocus(entries, 0, 'End')).toBe(3);
    });

    it('returns -1 when nothing is selectable', () => {
        expect(moveFocus([divider, item('x', true)], -1, 'Home')).toBe(-1);
    });
});

describe('clampMenuPosition', () => {
    const bounds = { left: 0, top: 0, right: 500, bottom: 400 };
    it('keeps a fitting menu where it is', () => {
        expect(clampMenuPosition({ x: 10, y: 20 }, { width: 100, height: 80 }, bounds)).toEqual({ x: 10, y: 20 });
    });
    it('shifts a menu back inside the right and bottom edges', () => {
        expect(clampMenuPosition({ x: 450, y: 380 }, { width: 100, height: 80 }, bounds)).toEqual({ x: 400, y: 320 });
    });
    it('never moves above or left of the bounds, even when too large', () => {
        expect(clampMenuPosition({ x: 5, y: 5 }, { width: 900, height: 900 }, bounds)).toEqual({ x: 0, y: 0 });
    });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run src/contextActions/`

Expected: FAIL, because the modules cannot be resolved. Task 1's tests still pass.

- [ ] **Step 4: Implement `ui/src/contextActions/menuItems.ts`**

```ts
import type { ReactNode } from 'react';
import type { ContextAction, FlowContext, FlowTarget } from '../types/spi.ts';

type Log = (...args: unknown[]) => void;
// eslint-disable-next-line no-console
const defaultLog: Log = (...args) => console.error(...args);

/** A built-in editing item (Clone/Delete). */
export interface BuiltInItem {
    id: string;
    label: string;
    danger?: boolean;
    onSelect: () => void;
}

/** Editor operations the built-in items invoke. */
export interface BuiltInHandlers {
    clone: (nodeId: string) => void;
    deleteElements: (nodeIds: string[], edgeIds: string[]) => void;
}

/** One rendered menu row. `run` performs the action; ids are unique within a menu. */
export type MenuEntry =
    | { type: 'item'; id: string; label: string; icon?: ReactNode; danger: boolean; disabled: boolean;
        source: 'builtin' | 'host'; run: () => void }
    | { type: 'divider'; id: 'divider' };

/**
 * Lists the built-in items for a target.
 *
 * @param target the menu target
 * @param handlers editor operations
 * @returns Clone/Delete for nodes, Delete for edges and selections, nothing otherwise
 */
export function builtInItems(target: FlowTarget, handlers: BuiltInHandlers): BuiltInItem[] {
    switch (target.kind) {
        case 'node':
            return [
                { id: 'clone', label: 'Clone', onSelect: () => handlers.clone(target.nodeId) },
                { id: 'delete', label: 'Delete', danger: true, onSelect: () => handlers.deleteElements([target.nodeId], []) },
            ];
        case 'edge':
            return [{ id: 'delete', label: 'Delete', danger: true, onSelect: () => handlers.deleteElements([], [target.edgeId]) }];
        case 'selection':
            return [{ id: 'delete', label: 'Delete', danger: true,
                onSelect: () => handlers.deleteElements(target.nodeIds, target.edgeIds) }];
        default:
            return [];
    }
}

function hostActions(contextActions: ((context: FlowContext) => ContextAction[]) | undefined, context: FlowContext,
    log: Log): ContextAction[] {
    if (!contextActions) return [];
    let result: unknown;
    try {
        result = contextActions(context);
    } catch (error) {
        log('contextActions threw; showing built-in items only', error);
        return [];
    }
    if (!Array.isArray(result)) {
        log('contextActions must return an array; ignoring', result);
        return [];
    }
    return result.filter((action): action is ContextAction => {
        const valid = !!action && typeof action === 'object' && typeof action.id === 'string'
            && typeof action.label === 'string' && typeof action.onSelect === 'function';
        if (!valid) log('Ignoring invalid context action (needs string id, string label and onSelect)', action);
        return valid;
    });
}

/**
 * Merges built-in and host items: built-ins first, a divider only when both groups are non-empty, then host
 * items. Host failures are logged and never prevent the built-ins from showing.
 *
 * @param builtIns the built-in items for this target (empty when editing is unavailable)
 * @param contextActions the host function, if configured
 * @param context the context for this menu opening
 * @param log error logger (defaults to `console.error`)
 * @returns the entries to render; empty means no menu should open
 */
export function resolveMenuItems(builtIns: BuiltInItem[], contextActions: ((context: FlowContext) => ContextAction[]) | undefined,
    context: FlowContext, log: Log = defaultLog): MenuEntry[] {
    const fixed: MenuEntry[] = builtIns.map(item => ({ type: 'item', id: `builtin:${item.id}`, label: item.label,
        danger: !!item.danger, disabled: false, source: 'builtin', run: item.onSelect }));
    const host: MenuEntry[] = hostActions(contextActions, context, log).map(action => ({ type: 'item',
        id: `host:${action.id}`, label: action.label, icon: action.icon, danger: !!action.danger,
        disabled: !!action.disabled, source: 'host', run: () => action.onSelect(context) }));
    return fixed.length && host.length ? [...fixed, { type: 'divider', id: 'divider' }, ...host] : [...fixed, ...host];
}

/**
 * Runs an entry, logging (never throwing) if it fails. Disabled items and dividers do nothing.
 *
 * @param entry the entry the user chose
 * @param log error logger (defaults to `console.error`)
 */
export function runMenuEntry(entry: MenuEntry, log: Log = defaultLog): void {
    if (entry.type !== 'item' || entry.disabled) return;
    try {
        entry.run();
    } catch (error) {
        log(`Context menu action "${entry.label}" threw`, error);
    }
}
```

If the repo's ESLint config doesn't define `no-console`, remove the `eslint-disable-next-line` comment.

- [ ] **Step 5: Implement `ui/src/contextActions/menuNavigation.ts`**

```ts
import type { MenuEntry } from './menuItems.ts';

const selectable = (entry: MenuEntry) => entry.type === 'item' && !entry.disabled;

/**
 * Computes the next focused entry for a navigation key. Dividers and disabled items are skipped, and
 * arrows wrap around.
 *
 * @param entries the menu entries
 * @param current the focused index, or -1 when nothing is focused
 * @param key the navigation key
 * @returns the index to focus, or -1 when no entry is selectable
 */
export function moveFocus(entries: MenuEntry[], current: number, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): number {
    const indices = entries.flatMap((entry, index) => (selectable(entry) ? [index] : []));
    if (!indices.length) return -1;
    if (key === 'Home') return indices[0];
    if (key === 'End') return indices[indices.length - 1];
    if (key === 'ArrowDown') return indices.find(index => index > current) ?? indices[0];
    return [...indices].reverse().find(index => current < 0 ? true : index < current) ?? indices[indices.length - 1];
}

/**
 * Shifts a menu so it stays inside the bounds, preferring to keep its top-left corner on screen.
 *
 * @param position desired top-left corner (viewport coordinates)
 * @param size the menu's rendered size
 * @param bounds the area the menu must stay within
 * @returns the clamped top-left corner
 */
export function clampMenuPosition(position: { x: number; y: number }, size: { width: number; height: number },
    bounds: { left: number; top: number; right: number; bottom: number }): { x: number; y: number } {
    return {
        x: Math.max(bounds.left, Math.min(position.x, bounds.right - size.width)),
        y: Math.max(bounds.top, Math.min(position.y, bounds.bottom - size.height)),
    };
}
```

- [ ] **Step 6: Run the tests and checks**

Run: `npx vitest run src/contextActions/ && npx tsc --noEmit && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/contextActions
git commit -m "Add context menu entry resolution and keyboard navigation helpers"
```

---

### Task 3: `ContextMenu` component and the node menu migration

**Files:**
- Create: `ui/src/components/ContextMenu.tsx`, `ui/src/components/ContextMenu.css`
- Delete: `ui/src/components/NodeContextMenu.tsx`, `ui/src/components/NodeContextMenu.css`
- Modify:
  - `ui/src/components/WorkflowEditor.tsx`
  - `ui/browser/editor.spec.ts`
  - `ui/browser/gates.spec.ts`

**Interfaces:**
- Consumes:
  - `menuTarget`, `buildFlowContext` and `MenuSubject` (Task 1)
  - `builtInItems`, `resolveMenuItems`, `runMenuEntry`, `MenuEntry` and `BuiltInHandlers` (Task 2)
  - `moveFocus` and `clampMenuPosition` (Task 2)
  - `selectionOf` (`ui/src/hooks/editorNotifications.ts`)
- Produces:
  - `<ContextMenu entries position bounds returnFocus onClose />`
  - Inside `WorkflowEditorInner`: `openMenu(subject: MenuSubject, screenPosition: { x: number; y: number },
    returnFocus: HTMLElement | SVGElement | null): boolean`. It returns true when a menu opened. Tasks 4 and 5 call it from
    the other surfaces.

This task changes how node menus open: through `openMenu`, including host items. The other surfaces are
wired in Tasks 4 and 5. Behaviour change: when there are no items at all (for example a locked canvas with
no `contextActions`), no menu opens and the browser's default menu is not prevented.

- [ ] **Step 1: Point the existing browser tests at the new roles and class**

These two tests change:
- `ui/browser/editor.spec.ts`: change `editor.getByRole('button', { name: /Delete/ })` (2 occurrences) to
  `editor.getByRole('menuitem', { name: 'Delete' })`.
- `ui/browser/gates.spec.ts`: change `editor.locator('.node-context-menu')` to
  `editor.locator('.flow-context-menu')`.

Then run `grep -rn "node-context-menu\|NodeContextMenu" ui/src ui/browser` and update any other hits the
same way.

- [ ] **Step 2: Run the affected browser specs and confirm they fail**

Run from `ui/`: `npm run test:browser -- editor.spec.ts gates.spec.ts`

Expected: the context-menu deletion test and the related locked-canvas test FAIL, because no `menuitem`
exists yet. The other tests pass.

- [ ] **Step 3: Create `ui/src/components/ContextMenu.css`**

```css
.flow-context-menu__backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
}
.flow-context-menu {
  position: fixed;
  z-index: 100;
  background: var(--flow-bg-primary, #fff);
  border: 1px solid var(--flow-border, #d2d2d2);
  border-radius: 6px;
  box-shadow: 0 4px 12px var(--flow-shadow-heavy, rgba(0, 0, 0, 0.15));
  min-width: 160px;
  padding: 4px 0;
  outline: none;
}
.flow-context-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 16px;
  background: none;
  border: none;
  text-align: left;
  font-size: 13px;
  cursor: pointer;
  color: var(--flow-text, #151515);
}
.flow-context-menu__item:hover:not(:disabled),
.flow-context-menu__item:focus-visible {
  background: var(--flow-bg-hover, #f0f0f0);
  outline: none;
}
.flow-context-menu__item:disabled {
  cursor: default;
  opacity: 0.5;
}
.flow-context-menu__item--danger {
  color: var(--flow-status-danger, #c9190b);
}
.flow-context-menu__item--danger:hover:not(:disabled),
.flow-context-menu__item--danger:focus-visible {
  background: var(--flow-danger-hover-bg, #fce4e4);
}
.flow-context-menu__icon {
  display: inline-flex;
  width: 16px;
}
.flow-context-menu__divider {
  height: 1px;
  margin: 4px 0;
  background: var(--flow-border, #d2d2d2);
}
```

- [ ] **Step 4: Create `ui/src/components/ContextMenu.tsx`** (2-space indent)

```tsx
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { runMenuEntry, type MenuEntry } from '../contextActions/menuItems.ts';
import { clampMenuPosition, moveFocus } from '../contextActions/menuNavigation.ts';
import './ContextMenu.css';

/** Props for {@link ContextMenu}. Keep `entries`, `position` and `bounds` stable while the menu is open. */
export interface ContextMenuProps {
  entries: MenuEntry[];
  /** Desired top-left corner in viewport coordinates. */
  position: { x: number; y: number };
  /** Area the menu must stay inside, in viewport coordinates (usually the editor's bounding box). */
  bounds: { left: number; top: number; right: number; bottom: number };
  /** Element to refocus on close, unless the chosen action moved focus elsewhere. */
  returnFocus: HTMLElement | SVGElement | null;
  onClose: () => void;
}

const NAVIGATION_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const;
type NavigationKey = typeof NAVIGATION_KEYS[number];

const itemAt = (menu: HTMLElement, index: number) =>
  menu.querySelector<HTMLButtonElement>(`[data-menu-index="${index}"]`);

/** Accessible context menu: arrow/Home/End navigation, Enter/Space to choose, Escape or outside click to close. */
export function ContextMenu({ entries, position, bounds, returnFocus, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp after measuring and move focus into the menu, without a state update.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const clamped = clampMenuPosition(position, { width: menu.offsetWidth, height: menu.offsetHeight }, bounds);
    menu.style.left = `${clamped.x}px`;
    menu.style.top = `${clamped.y}px`;
    const first = moveFocus(entries, -1, 'Home');
    (first >= 0 ? itemAt(menu, first) : menu)?.focus({ preventScroll: true });
  }, [entries, position, bounds]);

  const close = () => {
    const active = document.activeElement;
    const focusStillOurs = !active || active === document.body || !!menuRef.current?.contains(active);
    onClose();
    if (focusStillOurs && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed inside the menu never reach the editor's canvas shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close();
      return;
    }
    if ((NAVIGATION_KEYS as readonly string[]).includes(event.key)) {
      event.preventDefault();
      const current = Number((document.activeElement as HTMLElement | null)?.dataset?.menuIndex ?? -1);
      const next = moveFocus(entries, current, event.key as NavigationKey);
      if (next >= 0 && menuRef.current) itemAt(menuRef.current, next)?.focus();
    }
  };

  return (
    <>
      <div className="flow-context-menu__backdrop" onClick={close}
        onContextMenu={event => { event.preventDefault(); close(); }} />
      <div ref={menuRef} className="flow-context-menu" role="menu" tabIndex={-1}
        style={{ left: position.x, top: position.y }} onKeyDown={onKeyDown}>
        {entries.map((entry, index) => entry.type === 'divider'
          ? <div key={entry.id} className="flow-context-menu__divider" role="separator" />
          : (
            <button key={entry.id} type="button" role="menuitem" tabIndex={-1} data-menu-index={index}
              disabled={entry.disabled}
              className={`flow-context-menu__item${entry.danger ? ' flow-context-menu__item--danger' : ''}`}
              onClick={() => { runMenuEntry(entry); close(); }}>
              {entry.icon && <span className="flow-context-menu__icon" aria-hidden="true">{entry.icon}</span>}
              {entry.label}
            </button>
          ))}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Wire `openMenu` and the node surface into `WorkflowEditor.tsx`**

1. **Imports:**
   - Remove the `NodeContextMenu` import.
   - Add:
     ```ts
     import { ContextMenu } from './ContextMenu.tsx';
     import { buildFlowContext, menuTarget, type MenuSubject } from '../contextActions/flowContext.ts';
     import { builtInItems, resolveMenuItems, type BuiltInHandlers, type MenuEntry } from '../contextActions/menuItems.ts';
     ```
   - Add `selectionOf` to the existing import from `../hooks/editorNotifications.ts`, or add that import if
     there isn't one.
2. **Menu state:** replace the `contextMenu` state declaration with:
   ```tsx
   const [menu, setMenu] = useState<{
     entries: MenuEntry[];
     position: { x: number; y: number };
     bounds: { left: number; top: number; right: number; bottom: number };
     returnFocus: HTMLElement | SVGElement | null;
   } | null>(null);
   ```
3. **Close calls:** replace every `setContextMenu(null)` with `setMenu(null)` (in `onPaneClick` and
   `toggleSim`).
4. **Handlers:** delete `onCloneNode` and `onDeleteNode`. They are no longer used. Check with `grep`, and keep
   any other caller working.
5. **`openMenu`:** replace `onNodeContextMenu` with the code below. Place it after `validationProblems` and
   `interactivityEnabled` are defined; move it lower in the component if necessary.

```tsx
  const builtInHandlers = useMemo<BuiltInHandlers>(() => ({
    clone: nodeId => {
      const node = currentWorkflow.nodes.find(candidate => candidate.id === nodeId);
      if (node) dispatch({ type: 'cloneNode', id: nodeId, newId: generateNodeId(node.type) });
    },
    deleteElements: (nodeIds, edgeIds) =>
      deleteWithEditorFocus(state, { type: 'delete', nodeIds, edgeIds }, editorRootRef.current, dispatch),
  }), [currentWorkflow, state, dispatch]);

  /** Opens a context menu for a subject; returns false (and opens nothing) when there is nothing to show. */
  const openMenu = useCallback((subject: MenuSubject, screenPosition: { x: number; y: number },
    returnFocus: HTMLElement | SVGElement | null): boolean => {
    if (simActive) return false;
    const target = menuTarget(subject, selectionOf(state));
    const context = buildFlowContext(state, target, validationProblems, readOnly, screenPosition);
    const entries = resolveMenuItems(interactivityEnabled ? builtInItems(target, builtInHandlers) : [],
      spi?.contextActions, context);
    if (!entries.length) return false;
    const box = editorRootRef.current?.getBoundingClientRect();
    const bounds = box
      ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    setMenu({ entries, position: { ...screenPosition }, bounds, returnFocus });
    return true;
  }, [simActive, state, validationProblems, readOnly, interactivityEnabled, builtInHandlers, spi]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node<FlowNodeData>) => {
    const opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (openMenu({ kind: 'node', nodeId: node.id }, { x: event.clientX, y: event.clientY }, opener)) {
      event.preventDefault();
    }
  }, [openMenu]);
```

6. **Rendering:** replace the `{contextMenu && interactivityEnabled && (<NodeContextMenu … />)}` block with:

```tsx
          {menu && (
            <ContextMenu entries={menu.entries} position={menu.position} bounds={menu.bounds}
              returnFocus={menu.returnFocus} onClose={() => setMenu(null)} />
          )}
```

- [ ] **Step 6: Delete the old component**

Run: `git rm ui/src/components/NodeContextMenu.tsx ui/src/components/NodeContextMenu.css`

- [ ] **Step 7: Run the checks and the browser specs**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run test:browser -- editor.spec.ts gates.spec.ts`

Expected: PASS. The deletion test checks that focus goes to `[data-workflow-editor]` after Delete. That
still holds, because `deleteWithEditorFocus` moves focus out of the menu before it closes, so `close()` does
not restore focus to the deleted node.

- [ ] **Step 8: Run the full browser suite and commit**

Run: `npm run test:browser`

Expected: PASS.

```bash
git add -A ui/src/components ui/browser/editor.spec.ts ui/browser/gates.spec.ts
git commit -m "Replace the node context menu with an accessible ContextMenu"
```

---

### Task 4: Canvas, edge and selection surfaces, keyboard opening, browser test page modes

**Files:**
- Modify:
  - `ui/src/components/WorkflowEditor.tsx`
  - `ui/browser/host.tsx`
- Create: `ui/browser/context-actions.spec.ts`

**Interfaces:**
- Consumes:
  - `openMenu` (Task 3)
  - `MenuSubject` (Task 1)
  - the public types `FlowContext` and `ContextAction` from `../src/index.ts`
- Produces:
  - Browser test page modes:
    - `?context`: host actions "Ask AI about <target kind>" (enabled) and "Not available" (disabled)
    - `?contextThrow`: with `?context`, `contextActions` throws
    - `?contextEmpty`: with `?context`, it returns `[]`
    - `?readonly`: the editor is read-only
  - `<output data-testid="context-log">`: a JSON array of the contexts that actions received. Task 5 uses it.

- [ ] **Step 1: Add the modes to `ui/browser/host.tsx`**

1. Add `type FlowContext` and `type ContextAction` to the existing import from `'../src/index.ts'`.
2. In `EditorHost`, rename the existing `spi` `useMemo` to `asyncSpi`, keeping its body and dependencies.
   Then add:

```tsx
    const [contextLog, setContextLog] = useState<unknown[]>([]);
    const contextActions = useMemo(() => (params.has('context') ? (context: FlowContext): ContextAction[] => {
        if (params.has('contextThrow')) throw new Error('Host context actions failed');
        if (params.has('contextEmpty')) return [];
        const record = (id: string) => (chosen: FlowContext) => setContextLog(previous => [...previous, {
            id, target: chosen.target, contentRevision: chosen.contentRevision, selection: chosen.selection,
            readOnly: chosen.readOnly, problems: chosen.problems.length, nodes: chosen.workflow.nodes.length,
            screenPosition: chosen.screenPosition,
        }]);
        return [
            { id: 'ask', label: `Ask AI about ${context.target.kind}`, onSelect: record('ask') },
            { id: 'later', label: 'Not available', disabled: true, onSelect: record('later') },
        ];
    } : undefined), []);
    const spi = useMemo<EditorSpi | undefined>(() => (asyncSpi || contextActions
        ? { ...asyncSpi, ...(contextActions ? { contextActions } : {}) } : undefined), [asyncSpi, contextActions]);
```

3. On `<WorkflowEditor …>`, add `readOnly={params.has('readonly')}`.
4. After the existing `<output>` elements, add:
   `<output data-testid="context-log">{JSON.stringify(contextLog)}</output>`

- [ ] **Step 2: Write the failing e2e tests `ui/browser/context-actions.spec.ts`**

```ts
import type { Locator } from '@playwright/test';
import { test, expect, ready } from './test.ts';

const log = async (editor: Locator) => JSON.parse(await editor.getByTestId('context-log').textContent() ?? '[]');
const node = (editor: Locator, id: string) => editor.locator(`.react-flow__node[data-id="${id}"]`);
const menu = (editor: Locator) => editor.getByRole('menu');
const items = (editor: Locator) => menu(editor).getByRole('menuitem');

test('node menu shows built-ins, a divider and host items, and passes the node context', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Clone', 'Delete', 'Ask AI about node', 'Not available']);
    await expect(menu(editor).getByRole('separator')).toHaveCount(1);
    await expect(items(editor).filter({ hasText: 'Not available' })).toBeDisabled();
    await items(editor).filter({ hasText: 'Ask AI about node' }).click();
    await expect(menu(editor)).toHaveCount(0);
    const [entry] = await log(editor);
    expect(entry).toMatchObject({ id: 'ask', target: { kind: 'node', nodeId: 'a' }, readOnly: false, nodes: 4 });
    expect(entry.contentRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entry.screenPosition.x).toBeGreaterThan(0);
});

test('edge and canvas menus pass their targets', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('group', { name: 'Edge from s to a', exact: true }).click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Delete', 'Ask AI about edge', 'Not available']);
    await items(editor).filter({ hasText: 'Ask AI about edge' }).click();
    await editor.locator('.react-flow__pane').click({ button: 'right', position: { x: 30, y: 30 } });
    await expect(items(editor)).toHaveText(['Ask AI about canvas', 'Not available']);
    await expect(menu(editor).getByRole('separator')).toHaveCount(0);
    await items(editor).filter({ hasText: 'Ask AI about canvas' }).click();
    const [edge, canvas] = await log(editor);
    expect(edge.target).toEqual({ kind: 'edge', edgeId: 'sa' });
    expect(canvas.target.kind).toBe('canvas');
    expect(typeof canvas.target.flowPosition.x).toBe('number');
});

test('right-clicking inside a multi-selection targets the whole selection', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click();
    await node(editor, 'h').click({ modifiers: ['Control'] });
    await node(editor, 'h').click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Delete', 'Ask AI about selection', 'Not available']);
    await items(editor).filter({ hasText: 'Ask AI about selection' }).click();
    expect((await log(editor))[0].target).toEqual({ kind: 'selection', nodeIds: ['a', 'h'], edgeIds: [] });
});

test('the menu opens from the keyboard, wraps, skips disabled items and restores focus', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').focus();
    await page.keyboard.press('Shift+F10');
    await expect(items(editor).filter({ hasText: 'Clone' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(items(editor).filter({ hasText: 'Ask AI about node' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items(editor).filter({ hasText: 'Clone' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(items(editor).filter({ hasText: 'Ask AI about node' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu(editor)).toHaveCount(0);
    await expect(node(editor, 'a')).toBeFocused();
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('Enter');
    await expect(editor.locator('.react-flow__node')).toHaveCount(5);
});

test('a read-only editor shows host items only', async ({ page }) => {
    await page.goto('/?context&readonly');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Ask AI about node', 'Not available']);
    await items(editor).filter({ hasText: 'Ask AI about node' }).click();
    expect((await log(editor))[0].readOnly).toBe(true);
});

test('a failing host still leaves the built-in items', async ({ page, browserErrors }) => {
    await page.goto('/?context&contextThrow');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Clone', 'Delete']);
    expect(browserErrors.some(message => message.includes('contextActions threw'))).toBe(true);
    browserErrors.length = 0;
});

test('with nothing to show, no menu opens', async ({ page }) => {
    await page.goto('/?context&contextEmpty&readonly');
    const editor = page.getByTestId('one');
    await ready(editor);
    await node(editor, 'a').click({ button: 'right' });
    await editor.locator('.react-flow__pane').click({ button: 'right', position: { x: 30, y: 30 } });
    await expect(menu(editor)).toHaveCount(0);
});
```

- [ ] **Step 3: Run the spec and confirm it fails**

Run from `ui/`: `npm run test:browser -- context-actions.spec.ts`

Expected: the node, read-only, failing-host and empty tests can already pass, because Task 3 wired nodes.
The edge/canvas, multi-selection and keyboard tests FAIL.

- [ ] **Step 4: Wire the remaining canvas surfaces in `WorkflowEditor.tsx`**

1. **Guard against a second opening.** Add `const menuOpenRef = useRef(false);`.
   - In `openMenu`, set `menuOpenRef.current = true;` right before `setMenu(...)`.
   - Change the `ContextMenu` `onClose` to `() => { menuOpenRef.current = false; setMenu(null); }`, and set
     `menuOpenRef.current = false` wherever else `setMenu(null)` is called.
   - At the start of every mouse context-menu handler, including `onNodeContextMenu`, add
     `if (menuOpenRef.current) { event.preventDefault(); return; }`.

   This stops the browser's native `contextmenu` event, which can follow a keyboard opening, from replacing
   the menu that is already open.

2. **New handlers.** Add these next to `onNodeContextMenu`:

```tsx
  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    if (menuOpenRef.current) { event.preventDefault(); return; }
    const opener = event.currentTarget instanceof HTMLElement || event.currentTarget instanceof SVGElement
      ? event.currentTarget : null;
    if (openMenu({ kind: 'edge', edgeId: edge.id }, { x: event.clientX, y: event.clientY }, opener)) {
      event.preventDefault();
    }
  }, [openMenu]);

  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
    if (menuOpenRef.current) { event.preventDefault(); return; }
    const screenPosition = { x: event.clientX, y: event.clientY };
    if (openMenu({ kind: 'canvas', flowPosition: screenToFlowPosition(screenPosition) }, screenPosition,
      editorRootRef.current)) {
      event.preventDefault();
    }
  }, [openMenu, screenToFlowPosition]);

  // Right-click on the box-selection rectangle: target the selection through its first node.
  const onSelectionContextMenu = useCallback((event: React.MouseEvent, selected: Node[]) => {
    if (menuOpenRef.current) { event.preventDefault(); return; }
    if (selected.length && openMenu({ kind: 'node', nodeId: selected[0].id },
      { x: event.clientX, y: event.clientY }, editorRootRef.current)) {
      event.preventDefault();
    }
  }, [openMenu]);
```

3. **Pass them to `<ReactFlow>`:** `onEdgeContextMenu={onEdgeContextMenu}`,
   `onPaneContextMenu={onPaneContextMenu}`, `onSelectionContextMenu={onSelectionContextMenu}`.

4. **Keyboard opening.** In `onKeyDown`, after `textEditing` is computed and before `editorShortcut(...)` is
   called, add:

```tsx
    if (owned && !textEditing && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      const element = target?.closest<HTMLElement | SVGElement>('.react-flow__node[data-id], .react-flow__edge[data-id]');
      const id = element?.getAttribute('data-id');
      if (element && id) {
        const box = element.getBoundingClientRect();
        const subject: MenuSubject = element.classList.contains('react-flow__node')
          ? { kind: 'node', nodeId: id } : { kind: 'edge', edgeId: id };
        if (openMenu(subject, { x: box.left + box.width / 2, y: box.top + box.height / 2 }, element)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
      return;
    }
```

   Add `openMenu` to `onKeyDown`'s dependency list. Because of the dependency order, `openMenu` must be
   declared before `onKeyDown`; move code as needed.

- [ ] **Step 5: Run the e2e spec and the checks**

Run: `npx tsc --noEmit && npm run lint && npm run test:browser -- context-actions.spec.ts`

Expected: 7 passed. If the edge right-click lands outside the edge path, right-click the edge's `path` child
instead: `editor.locator('.react-flow__edge[data-id="sa"] path').first()`. The test's intent must stay the
same.

- [ ] **Step 6: Run the full suites and commit**

Run: `npx vitest run && npm run test:browser`

Expected: PASS.

```bash
git add ui/src/components/WorkflowEditor.tsx ui/browser/host.tsx ui/browser/context-actions.spec.ts
git commit -m "Open host context actions on canvas, edges, selections and from the keyboard"
```

---

### Task 5: Problems panel rows

**Files:**
- Modify:
  - `ui/src/components/panels/ProblemsPanel.tsx`
  - `ui/src/components/panels/ProblemsPanel.css`
  - `ui/src/components/WorkflowEditor.tsx`
  - `ui/browser/context-actions.spec.ts`
  - `docs/superpowers/specs/2026-10-09-editor-context-actions-design.md`

**Interfaces:**
- Consumes:
  - `openMenu` and `menuOpenRef` (Tasks 3 and 4)
  - `buildFlowContext` (Task 1)
  - `resolveMenuItems` (Task 2)
  - the browser test page's `?context` modes and `context-log` (Task 4)
- Produces: two new optional `ProblemsPanel` props:
  - `onProblemMenu?: (problem: ValidationProblem, screenPosition: { x: number; y: number }, opener: HTMLElement) => boolean`
  - `problemMenuEnabled?: (problem: ValidationProblem) => boolean`

- [ ] **Step 1: Add the failing e2e tests to the end of `ui/browser/context-actions.spec.ts`**

The default fixture workflow always shows the `MISSING_START_INPUTS` warning.

```ts
test('problem rows open host actions by right-click and from their actions button', async ({ page }) => {
    await page.goto('/?context');
    const editor = page.getByTestId('one');
    await ready(editor);
    const row = editor.locator('.problems-panel__item').filter({ hasText: 'MISSING_START_INPUTS' });
    await row.click({ button: 'right' });
    await expect(items(editor)).toHaveText(['Ask AI about problem', 'Not available']);
    await page.keyboard.press('Escape');
    await expect(menu(editor)).toHaveCount(0);
    const button = row.getByRole('button', { name: 'Actions for MISSING_START_INPUTS' });
    await button.click();
    await items(editor).filter({ hasText: 'Ask AI about problem' }).click();
    const [entry] = await log(editor);
    expect(entry.target).toMatchObject({ kind: 'problem', problem: { code: 'MISSING_START_INPUTS', severity: 'warning' } });
    await expect(button).toBeFocused();
});

test('the problem actions button is absent without contextActions and disabled when the host has nothing', async ({ page }) => {
    await page.goto('/');
    let editor = page.getByTestId('one');
    await ready(editor);
    await expect(editor.locator('.problems-panel__menu')).toHaveCount(0);
    await page.goto('/?context&contextEmpty');
    editor = page.getByTestId('one');
    await ready(editor);
    await expect(editor.getByRole('button', { name: 'Actions for MISSING_START_INPUTS' })).toBeDisabled();
});
```

- [ ] **Step 2: Run the spec and confirm the new tests fail**

Run: `npm run test:browser -- context-actions.spec.ts`

Expected: the two new tests FAIL, and the earlier 7 pass.

- [ ] **Step 3: Update `ui/src/components/panels/ProblemsPanel.tsx`** (2-space indent)

1. Extend the props:

```tsx
interface ProblemsPanelProps {
  problems: ValidationProblem[];
  onProblemClick: (problem: ValidationProblem) => void;
  /** Opens the host actions menu for a row; returns true when a menu opened. */
  onProblemMenu?: (problem: ValidationProblem, screenPosition: { x: number; y: number }, opener: HTMLElement) => boolean;
  /** When provided, every row gets an actions button, enabled when this returns true. */
  problemMenuEnabled?: (problem: ValidationProblem) => boolean;
}
```

2. Destructure the two new props.
3. Give the `<li>` an `onContextMenu`:

```tsx
onContextMenu={event => {
  if (onProblemMenu?.(p, { x: event.clientX, y: event.clientY }, event.currentTarget)) event.preventDefault();
}}
```

4. Add this as the last child of the `<li>`:

```tsx
{problemMenuEnabled && (
  <button type="button" className="problems-panel__menu" aria-label={`Actions for ${p.code}`}
    aria-haspopup="menu" disabled={!problemMenuEnabled(p)}
    onClick={event => {
      event.stopPropagation();
      const box = event.currentTarget.getBoundingClientRect();
      onProblemMenu?.(p, { x: box.left, y: box.bottom }, event.currentTarget);
    }}>
    ⋯
  </button>
)}
```

- [ ] **Step 4: Style the button in `ui/src/components/panels/ProblemsPanel.css`**

```css
.problems-panel__menu {
  margin-left: auto;
  padding: 0 6px;
  background: none;
  border: none;
  border-radius: 4px;
  font-size: 16px;
  line-height: 1;
  color: inherit;
  cursor: pointer;
}
.problems-panel__menu:hover:not(:disabled),
.problems-panel__menu:focus-visible {
  background: var(--flow-bg-hover, #f0f0f0);
}
.problems-panel__menu:disabled {
  opacity: 0.4;
  cursor: default;
}
```

If `.problems-panel__item` is not a flex container, `margin-left: auto` has no effect. In that case add
`display: flex; align-items: center; gap: 8px;` to `.problems-panel__item`, keeping its existing rules.

- [ ] **Step 5: Wire the panel in `WorkflowEditor.tsx`**

Add these after `openMenu`:

```tsx
  const onProblemMenu = useCallback((problem: ValidationProblem, screenPosition: { x: number; y: number },
    opener: HTMLElement): boolean => {
    if (menuOpenRef.current) return true;
    return openMenu({ kind: 'problem', problem }, screenPosition, opener);
  }, [openMenu]);

  // Probes the host (silently) to decide whether a row's actions button is enabled; cached per render input.
  const problemMenuEnabled = useMemo(() => {
    const contextActions = spi?.contextActions;
    if (!contextActions) return undefined;
    const cache = new Map<ValidationProblem, boolean>();
    return (problem: ValidationProblem): boolean => {
      if (simActive) return false;
      if (!cache.has(problem)) {
        const context = buildFlowContext(state, { kind: 'problem', problem }, validationProblems, readOnly, { x: 0, y: 0 });
        cache.set(problem, resolveMenuItems([], contextActions, context, () => {}).length > 0);
      }
      return cache.get(problem)!;
    };
  }, [spi, simActive, state, validationProblems, readOnly]);
```

Then change the panel element to:
`<ProblemsPanel problems={validationProblems} onProblemClick={onProblemClick} onProblemMenu={onProblemMenu} problemMenuEnabled={problemMenuEnabled} />`

`menuOpenRef` was added in Task 4. When the guard triggers, `onProblemMenu` returns true, so the
right-click's default is prevented while a menu is already open.

- [ ] **Step 6: Amend the spec**

In `docs/superpowers/specs/2026-10-09-editor-context-actions-design.md`, replace the paragraph that starts
"The "⋯" button on a Problems panel row is rendered only when" with:

```markdown
The "⋯" button on a Problems panel row is rendered only when `contextActions` is configured. To decide
whether it is enabled, Flow calls `contextActions` with that row's `problem` context, using
`screenPosition` `{ x: 0, y: 0 }`. Errors during this probe are not logged; they are logged when the menu
actually opens. The button is disabled when the host returns no items, and during simulation.
```

Also add this sentence to the "Fresh items" rule: "It may also be called to probe Problems row buttons
(see above)."

- [ ] **Step 7: Run the checks and the e2e spec**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run test:browser -- context-actions.spec.ts`

Expected: 9 passed.

- [ ] **Step 8: Run the full browser suite and commit**

Run: `npm run test:browser`

Expected: PASS.

```bash
git add ui/src/components ui/browser/context-actions.spec.ts docs/superpowers/specs/2026-10-09-editor-context-actions-design.md
git commit -m "Offer host context actions on Problems panel rows"
```

---

### Task 6: User guide

**Files:**
- Modify: `docs/user-guide/ai-assisted-editing.md`

**Interfaces:**
- Consumes: the public API from Tasks 1–5

- [ ] **Step 1: Add a "Context actions" section**

Insert it immediately before the `## Events` heading. Wrap lines at 110 characters, except in tables and
code.

````markdown
## Context actions

Context menus are the place to start AI work from the canvas. `spi.contextActions` is called each time a
menu opens. It receives a `FlowContext` and returns the host items, which are shown below the built-in
Clone/Delete items. Flow never shows a prompt itself: open your own UI from `onSelect`, anchored at
`screenPosition`.

| Surface | Opened by | Target |
|---|---|---|
| Canvas background | Right-click | `{ kind: 'canvas', flowPosition }` |
| Node | Right-click; ContextMenu key or Shift+F10 when focused | `{ kind: 'node', nodeId }` |
| Edge | Right-click; ContextMenu key or Shift+F10 when focused | `{ kind: 'edge', edgeId }` |
| Inside a multi-selection | Right-click on a selected element | `{ kind: 'selection', nodeIds, edgeIds }` |
| Problems panel row | Right-click; the row's "⋯" button | `{ kind: 'problem', problem }` |

```tsx
const spi: EditorSpi = {
  contextActions: (context) => [
    {
      id: 'ask-ai',
      label: context.target.kind === 'problem' ? 'Ask AI to fix this' : 'Ask AI…',
      onSelect: (chosen) => openPrompt({
        anchor: chosen.screenPosition,
        // Use the revision the user was looking at as the change set's base.
        onSubmit: async (text) => editorRef.current?.propose(
          await agent.proposeChange({ text, context: chosen, baseRevision: chosen.contentRevision })),
      }),
    },
  ],
};
```

- **Read-only editors:** built-in items are hidden but host items are shown. Check `context.readOnly` to
  hide your own items as well.
- **Simulation:** no menus open while simulating.
- **Nothing to show:** if neither Flow nor the host has an item, no menu opens.
- **Fresh items:** `contextActions` runs on every opening, so items can depend on the current state, for
  example to hide AI actions while an agent is busy. It is also called, with errors silenced, to decide
  whether a Problems row's "⋯" button is enabled.
- **Errors:** if `contextActions` throws or returns something invalid, Flow logs it and still shows the
  built-in items. If an `onSelect` throws, the error is logged and the menu closes.
````

- [ ] **Step 2: Run the docs check**

Run from the repo root: `mkdocs build --strict -q -d /tmp/flow-site`

Expected: exit code 0. If `mkdocs` is not installed, follow `docs/developer-guide/documentation-checks.md`.

- [ ] **Step 3: Final verification**

Run from `ui/`: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build && npm run test:browser`

Expected: everything passes.

- [ ] **Step 4: Commit**

```bash
git add docs/user-guide/ai-assisted-editing.md
git commit -m "Document editor context actions"
```
