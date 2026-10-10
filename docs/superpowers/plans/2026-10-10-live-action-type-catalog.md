# Live Action Type Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** The editor loads the Action Type catalog once and picks up a new `actionTypes` value without a loading
flash. It marks action nodes whose Action Type is not in the catalog, and it lets the host open its own Action
Type editor from the Properties panel.

**Architecture:**
- **Pure logic, tested with vitest:** a reducer for the catalog's state transitions, and a helper that finds
  unresolved nodes.
- **Hook:** `useActionTypeCatalog` runs the reducer and is called from `WorkflowEditorInner`. The result goes
  down to `PropertiesPanel` as props and to the canvas nodes as an `unresolvedActionType` data flag.
- **New UI:** a node marker, and an Open/Create… button wired to `spi.openActionType`.

**Tech Stack:** TypeScript, React 19, `@xyflow/react` 12, PatternFly 6, vitest (no jsdom), Playwright
(`ui/browser/`).

**Spec:** `docs/superpowers/specs/2026-10-10-live-action-type-catalog-design.md`

## Global Constraints

- **Branch:** work on `feat/live-action-type-catalog`. Commit messages must not include any AI or Claude
  attribution.
- **Testing:** no jsdom and no `@testing-library/react`. Logic lives in pure functions tested with vitest, and
  components are covered by Playwright.
- **Indentation:**
  - `WorkflowEditor.tsx`, `PropertiesPanel.tsx`, `types/spi.ts`, `nodes/nodeTypes.ts` and
    `utils/conversion.ts`: 2 spaces.
  - `validationBadge.tsx/.css`, new files under `hooks/` and `utils/`, and browser specs: 4 spaces.
- **Code:** use explicit `.ts`/`.tsx` import extensions, and add TSDoc to every exported symbol.
- **Catalog status values:** `'none' | 'loading' | 'ready'`.
- **Unresolved rule:** a node is unresolved when all of these hold:
  - it is an `action` node;
  - its `config.actionType` is a string with non-blank content;
  - the catalog status is `'ready'`;
  - no descriptor in the catalog has that `value`.
- **Exact UI strings:**
  - marker tooltip and accessible label: `Unknown Action Type: <value>`
  - panel note: `Not in the catalog yet`
  - button labels: `Open` / `Create…` (with U+2026 `…`)
- **`openActionType`:**
  - Show the button only when the callback is provided and the value is not blank. It is also shown when
    the editor is read-only.
  - `resolved` is `true` while the catalog is loading.
  - If the callback throws, log the error with `console.error` and carry on.
- **Validation and provider API:** built-in validation is unchanged, and no new provider API is added.
- **Verification:**
  - From `ui/`: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, and `npm run test:browser` for tasks
    that touch UI.
  - Run the full suites before marking a task done.

## File Map

| File | Responsibility |
|---|---|
| `ui/src/hooks/actionTypeCatalogState.ts` | Pure catalog reducer and types |
| `ui/src/hooks/useActionTypeCatalog.ts` | Hook running the reducer against `spi.actionTypes` |
| `ui/src/utils/unresolvedActionTypes.ts` | `unresolvedActionTypeIds` |
| `ui/src/components/WorkflowEditor.tsx` | Owns the catalog; passes it to the panel and flags nodes |
| `ui/src/components/panels/PropertiesPanel.tsx` | Receives the catalog as props; note and Open/Create… button |
| `ui/src/components/nodes/validationBadge.tsx/.css` | Unresolved marker (top-right) |
| `ui/src/utils/conversion.ts` | `FlowNodeData.unresolvedActionType?: string` |
| `ui/src/types/spi.ts` | `openActionType`, `ActionTypeProvider` TSDoc |
| `ui/browser/host.tsx`, `ui/browser/action-catalog.spec.ts` | `?catalog` mode and e2e |
| `docs/user-guide/ai-assisted-editing.md` | "Live Action Type catalog" section |

---

### Task 1: Catalog reducer and the unresolved helper

**Files:**
- Create:
  - `ui/src/hooks/actionTypeCatalogState.ts`
  - `ui/src/hooks/actionTypeCatalogState.test.ts`
  - `ui/src/utils/unresolvedActionTypes.ts`
  - `ui/src/utils/unresolvedActionTypes.test.ts`

**Interfaces:**
- Produces:
  - `type CatalogStatus = 'none' | 'loading' | 'ready'`
  - `interface ActionTypeCatalog { actionTypes: ActionTypeDescriptor[]; status: CatalogStatus }`
  - `type CatalogEvent = { type: 'provider'; generation: number; provider: ActionTypeProvider | undefined } | { type: 'loaded'; generation: number; actionTypes: ActionTypeDescriptor[] } | { type: 'failed'; generation: number }`
  - `interface CatalogState extends ActionTypeCatalog { generation: number }`
  - `initialCatalogState: CatalogState`
  - `catalogReducer(state: CatalogState, event: CatalogEvent): CatalogState`
  - `unresolvedActionTypeIds(workflow: Workflow, catalog: ActionTypeCatalog): Set<string>`

- [ ] **Step 1: Write the failing tests**

`ui/src/hooks/actionTypeCatalogState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { catalogReducer, initialCatalogState, type CatalogState } from './actionTypeCatalogState.ts';
import type { ActionTypeDescriptor } from '../types/spi.ts';

const a: ActionTypeDescriptor = { value: 'a', label: 'A' };
const b: ActionTypeDescriptor = { value: 'b', label: 'B' };
const loader = () => Promise.resolve([a]);

describe('catalogReducer', () => {
    it('starts with no catalog', () => {
        expect(initialCatalogState).toEqual({ actionTypes: [], status: 'none', generation: 0 });
    });

    it('handles absent, static and function providers', () => {
        expect(catalogReducer(initialCatalogState, { type: 'provider', generation: 1, provider: undefined }))
            .toEqual({ actionTypes: [], status: 'none', generation: 1 });
        expect(catalogReducer(initialCatalogState, { type: 'provider', generation: 1, provider: [a] }))
            .toEqual({ actionTypes: [a], status: 'ready', generation: 1 });
        expect(catalogReducer(initialCatalogState, { type: 'provider', generation: 1, provider: loader }))
            .toEqual({ actionTypes: [], status: 'loading', generation: 1 });
    });

    it('keeps the previous list visible while a swapped provider loads', () => {
        const ready: CatalogState = { actionTypes: [a], status: 'ready', generation: 1 };
        const swapped = catalogReducer(ready, { type: 'provider', generation: 2, provider: loader });
        expect(swapped).toEqual({ actionTypes: [a], status: 'ready', generation: 2 });
        expect(catalogReducer(swapped, { type: 'loaded', generation: 2, actionTypes: [a, b] }))
            .toEqual({ actionTypes: [a, b], status: 'ready', generation: 2 });
    });

    it('ignores results from replaced providers', () => {
        const loading = catalogReducer(initialCatalogState, { type: 'provider', generation: 2, provider: loader });
        expect(catalogReducer(loading, { type: 'loaded', generation: 1, actionTypes: [b] })).toBe(loading);
        expect(catalogReducer(loading, { type: 'failed', generation: 1 })).toBe(loading);
    });

    it('keeps the last list on failure and becomes ready', () => {
        const loading = catalogReducer(initialCatalogState, { type: 'provider', generation: 1, provider: loader });
        expect(catalogReducer(loading, { type: 'failed', generation: 1 }))
            .toEqual({ actionTypes: [], status: 'ready', generation: 1 });
        const reloading: CatalogState = { actionTypes: [a], status: 'ready', generation: 2 };
        expect(catalogReducer(reloading, { type: 'failed', generation: 2 }))
            .toEqual({ actionTypes: [a], status: 'ready', generation: 2 });
    });

    it('treats a non-array loaded result as empty', () => {
        const loading = catalogReducer(initialCatalogState, { type: 'provider', generation: 1, provider: loader });
        expect(catalogReducer(loading, { type: 'loaded', generation: 1, actionTypes: 'x' as unknown as ActionTypeDescriptor[] }))
            .toEqual({ actionTypes: [], status: 'ready', generation: 1 });
    });
});
```

`ui/src/utils/unresolvedActionTypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { unresolvedActionTypeIds } from './unresolvedActionTypes.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow: Workflow = { id: 'w', name: 'W', edges: [], nodes: [
    { id: 'known', type: 'action', name: 'K', config: { actionType: 'http' } },
    { id: 'unknown', type: 'action', name: 'U', config: { actionType: 'slack.notify' } },
    { id: 'blank', type: 'action', name: 'B', config: { actionType: '  ' } },
    { id: 'missing', type: 'action', name: 'M', config: {} },
    { id: 'weird', type: 'action', name: 'X', config: { actionType: 5 as unknown as string } },
    { id: 'wait', type: 'wait', name: 'W', config: { duration: 'PT1M' } },
] };
const catalog = [{ value: 'http', label: 'HTTP' }];

describe('unresolvedActionTypeIds', () => {
    it('flags only non-blank string action types missing from a ready catalog', () => {
        expect(unresolvedActionTypeIds(workflow, { actionTypes: catalog, status: 'ready' })).toEqual(new Set(['unknown']));
    });

    it('flags nothing while the catalog is absent or loading', () => {
        expect(unresolvedActionTypeIds(workflow, { actionTypes: [], status: 'none' }).size).toBe(0);
        expect(unresolvedActionTypeIds(workflow, { actionTypes: [], status: 'loading' }).size).toBe(0);
    });

    it('flags every referenced type against an empty ready catalog', () => {
        expect(unresolvedActionTypeIds(workflow, { actionTypes: [], status: 'ready' })).toEqual(new Set(['known', 'unknown']));
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/hooks/actionTypeCatalogState.test.ts src/utils/unresolvedActionTypes.test.ts`

Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement `ui/src/hooks/actionTypeCatalogState.ts`**

```ts
import type { ActionTypeDescriptor, ActionTypeProvider } from '../types/spi.ts';

/** Whether a catalog is configured and, if so, whether its first list has arrived. */
export type CatalogStatus = 'none' | 'loading' | 'ready';

/** The Action Type catalog as the editor currently knows it. */
export interface ActionTypeCatalog {
    actionTypes: ActionTypeDescriptor[];
    status: CatalogStatus;
}

/** Reducer state: the catalog plus the generation of the provider it belongs to. */
export interface CatalogState extends ActionTypeCatalog {
    generation: number;
}

/** Inputs to {@link catalogReducer}; `generation` identifies the provider instance an event belongs to. */
export type CatalogEvent =
    | { type: 'provider'; generation: number; provider: ActionTypeProvider | undefined }
    | { type: 'loaded'; generation: number; actionTypes: ActionTypeDescriptor[] }
    | { type: 'failed'; generation: number };

/** State before any provider has been seen. */
export const initialCatalogState: CatalogState = { actionTypes: [], status: 'none', generation: 0 };

/**
 * Applies a catalog event. A swapped function provider keeps the previous list visible (no loading flash),
 * results from replaced providers are ignored, and a failed load keeps the last list.
 *
 * @param state the current state
 * @param event the event
 * @returns the next state (the same object when the event is ignored)
 */
export function catalogReducer(state: CatalogState, event: CatalogEvent): CatalogState {
    if (event.type === 'provider') {
        const { provider, generation } = event;
        if (provider === undefined) return { actionTypes: [], status: 'none', generation };
        if (Array.isArray(provider)) return { actionTypes: provider, status: 'ready', generation };
        return state.status === 'ready'
            ? { actionTypes: state.actionTypes, status: 'ready', generation }
            : { actionTypes: [], status: 'loading', generation };
    }
    if (event.generation !== state.generation) return state;
    if (event.type === 'loaded') {
        return { actionTypes: Array.isArray(event.actionTypes) ? event.actionTypes : [], status: 'ready',
            generation: state.generation };
    }
    return { actionTypes: state.actionTypes, status: 'ready', generation: state.generation };
}
```

- [ ] **Step 4: Implement `ui/src/utils/unresolvedActionTypes.ts`**

```ts
import type { ActionTypeCatalog } from '../hooks/actionTypeCatalogState.ts';
import type { Workflow } from '../types/workflow.ts';

/**
 * Finds action nodes whose Action Type is not in a loaded catalog.
 *
 * @param workflow the workflow
 * @param catalog the editor's catalog
 * @returns ids of unresolved action nodes; empty unless the catalog status is `ready`
 */
export function unresolvedActionTypeIds(workflow: Workflow, catalog: ActionTypeCatalog): Set<string> {
    if (catalog.status !== 'ready') return new Set();
    const known = new Set(catalog.actionTypes.map(descriptor => descriptor.value));
    return new Set(workflow.nodes.filter(node => {
        if (node.type !== 'action') return false;
        const value = node.config.actionType;
        return typeof value === 'string' && value.trim() !== '' && !known.has(value);
    }).map(node => node.id));
}
```

- [ ] **Step 5: Run the tests and checks, then commit**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`

Expected: PASS.

```bash
git add ui/src/hooks/actionTypeCatalogState.ts ui/src/hooks/actionTypeCatalogState.test.ts ui/src/utils/unresolvedActionTypes.ts ui/src/utils/unresolvedActionTypes.test.ts
git commit -m "Add Action Type catalog state and unresolved reference helpers"
```

---

### Task 2: Editor-level catalog hook without a loading flash

**Files:**
- Create: `ui/src/hooks/useActionTypeCatalog.ts`
- Modify:
  - `ui/src/components/WorkflowEditor.tsx`
  - `ui/src/components/panels/PropertiesPanel.tsx`
  - `ui/src/types/spi.ts` (TSDoc only)
  - `ui/browser/async.spec.ts`

**Interfaces:**
- Consumes (Task 1): `catalogReducer`, `initialCatalogState`, `ActionTypeCatalog`
- Produces:
  - `useActionTypeCatalog(provider: ActionTypeProvider | undefined): ActionTypeCatalog`
  - `PropertiesPanel` gains the prop `actionTypeCatalog: ActionTypeCatalog`. The panel no longer calls the
    SPI provider itself.

- [ ] **Step 1: Add the failing e2e test to `ui/browser/async.spec.ts`**

```ts
test('replacing a loaded provider keeps the previous Action Types while the new one loads', async ({ page }) => {
    await page.goto('/?async');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await editor.getByRole('button', { name: 'Resolve current actions', exact: true }).click();
    await expect(editor.getByText('Current provider description')).toBeVisible();
    await editor.getByRole('button', { name: 'Replace provider', exact: true }).click();
    const filter = editor.getByRole('textbox', { name: 'Type to filter' });
    await expect(filter).not.toHaveAttribute('placeholder', 'Loading...');
    await expect(editor.getByText('Current provider description')).toBeVisible();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test:browser -- async.spec.ts`

Expected: the new test FAILS, because the placeholder shows `Loading...` after the swap.

- [ ] **Step 3: Implement `ui/src/hooks/useActionTypeCatalog.ts`**

```ts
import { useEffect, useReducer, useRef } from 'react';
import type { ActionTypeProvider } from '../types/spi.ts';
import { catalogReducer, initialCatalogState, type ActionTypeCatalog } from './actionTypeCatalogState.ts';

/**
 * Loads the Action Type catalog for the whole editor. Passing a new provider (array or function) reloads it;
 * a reloading function provider keeps the previous list visible until its result arrives.
 *
 * @param provider `spi.actionTypes`
 * @returns the current catalog
 */
export function useActionTypeCatalog(provider: ActionTypeProvider | undefined): ActionTypeCatalog {
    const [state, dispatch] = useReducer(catalogReducer, initialCatalogState);
    const generation = useRef(0);
    useEffect(() => {
        generation.current += 1;
        const current = generation.current;
        dispatch({ type: 'provider', generation: current, provider });
        if (typeof provider !== 'function') return;
        let active = true;
        Promise.resolve().then(provider).then(
            actionTypes => { if (active) dispatch({ type: 'loaded', generation: current, actionTypes }); },
            () => { if (active) dispatch({ type: 'failed', generation: current }); },
        );
        return () => { active = false; };
    }, [provider]);
    return { actionTypes: state.actionTypes, status: state.status };
}
```

The `active` flag drops results after unmount and on StrictMode replays. The reducer's `generation` check
drops results from providers that have since been replaced.

- [ ] **Step 4: Move catalog ownership to the editor**

In `WorkflowEditor.tsx`:
1. Import `useActionTypeCatalog` from `../hooks/useActionTypeCatalog.ts`.
2. Add `const actionTypeCatalog = useActionTypeCatalog(spi?.actionTypes);` near `useHostValidation`.
3. Pass `actionTypeCatalog={actionTypeCatalog}` to `<PropertiesPanel>`.

In `PropertiesPanel.tsx`:
1. Delete the private `useActionTypes` function and any imports that become unused.
2. Add this prop to `PropertiesPanelProps`, with TSDoc:
   ```ts
   /** The editor's Action Type catalog. */
   actionTypeCatalog?: ActionTypeCatalog;
   ```
   Import the type from `../../hooks/actionTypeCatalogState.ts`.
3. Replace `const { actionTypes, loading: actionTypesLoading } = useActionTypes(spi);` with:

```tsx
  const catalog = props.actionTypeCatalog ?? { actionTypes: [], status: 'none' as const };
  const actionTypes = catalog.actionTypes;
  const actionTypesLoading = catalog.status === 'loading';
```

Inside `ActionNodeFields`, `hasSpi` must keep today's meaning, which is "a catalog is configured". Pass the
status down by adding the prop `catalogStatus: CatalogStatus`, and change the line to
`const hasSpi = catalogStatus !== 'none';`. This keeps the picker in place for a configured catalog that
loaded empty, as it behaves today. If an existing test asserts the free-form text input for an empty async
catalog (`async.spec.ts`, "failed action loading falls back to editable free-form input"), keep that
behaviour instead: use `hasSpi = actionTypes.length > 0 || catalogStatus === 'loading'`, and note the choice
in the commit message.

- [ ] **Step 5: Update the `ActionTypeProvider` TSDoc in `ui/src/types/spi.ts`**

Add this sentence to the type's doc comment:
"Pass a new array or function to change the catalog; the editor reloads it and keeps the previous list
visible until a function provider's result arrives."

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run test:browser`

Expected: PASS, including the whole `async.spec.ts`.

```bash
git add ui/src ui/browser/async.spec.ts
git commit -m "Load the Action Type catalog once per editor and keep it visible while reloading"
```

---

### Task 3: Unresolved markers on the canvas and in the panel

**Files:**
- Modify:
  - `ui/src/utils/conversion.ts` (the `FlowNodeData` type only)
  - `ui/src/components/WorkflowEditor.tsx`
  - `ui/src/components/nodes/validationBadge.tsx`
  - `ui/src/components/nodes/validationBadge.css`
  - `ui/src/components/panels/PropertiesPanel.tsx`
  - `ui/browser/host.tsx`
- Create: `ui/browser/action-catalog.spec.ts`

**Interfaces:**
- Consumes:
  - `unresolvedActionTypeIds` (Task 1)
  - `actionTypeCatalog` in the editor (Task 2)
- Produces:
  - `FlowNodeData.unresolvedActionType?: string`
  - Browser test page mode `?catalog`: a static catalog held in host state, initially
    `[{ value: 'http', label: 'HTTP' }]`. It does not contain the fixture's `noop`.
  - An "Add noop to catalog" button that adds `{ value: 'noop', label: 'No-op' }`.
  - `<output data-testid="open-requests">`, the JSON list of `openActionType` requests. Task 4 fills it.

- [ ] **Step 1: Add the `?catalog` mode to `ui/browser/host.tsx`**

In `EditorHost`, add:

```tsx
    const [catalog, setCatalog] = useState<ActionTypeDescriptor[]>([{ value: 'http', label: 'HTTP' }]);
    const [openRequests, setOpenRequests] = useState<unknown[]>([]);
```

Merge into the existing combined `spi` `useMemo` from the context-actions work, which spreads `asyncSpi` and
`contextActions`. When `params.has('catalog')`, add `actionTypes: catalog`, plus
`openActionType: request => setOpenRequests(previous => [...previous, request])` unless
`params.has('noOpen')`. Add `catalog` to the memo's dependencies. If `asyncSpi` also defines `actionTypes`,
`?catalog` wins.

Inside `<nav>`, add:

```tsx
            {params.has('catalog') && <button onClick={() => setCatalog(previous => [...previous, { value: 'noop', label: 'No-op' }])}>
                Add noop to catalog</button>}
```

After the other outputs, add `<output data-testid="open-requests">{JSON.stringify(openRequests)}</output>`.

- [ ] **Step 2: Write the failing e2e tests `ui/browser/action-catalog.spec.ts`**

```ts
import { test, expect, ready } from './test.ts';

test('an Action Type missing from the catalog is marked until the host adds it', async ({ page }) => {
    await page.goto('/?catalog');
    const editor = page.getByTestId('one');
    await ready(editor);
    const node = editor.locator('.react-flow__node[data-id="a"]');
    const marker = node.getByLabel('Unknown Action Type: noop');
    await expect(marker).toBeVisible();
    await node.click();
    await expect(editor.getByText('Not in the catalog yet')).toBeVisible();
    await editor.getByRole('button', { name: 'Add noop to catalog' }).click();
    await expect(marker).toHaveCount(0);
    await expect(editor.getByText('Not in the catalog yet')).toHaveCount(0);
});

test('nothing is marked without a catalog', async ({ page }) => {
    await page.goto('/');
    const editor = page.getByTestId('one');
    await ready(editor);
    await expect(editor.locator('.flow-node-unresolved')).toHaveCount(0);
});
```

- [ ] **Step 3: Run them and confirm the first fails**

Run: `npm run test:browser -- action-catalog.spec.ts`

Expected: the first test FAILS and the second passes.

- [ ] **Step 4: Flag the nodes in `WorkflowEditor.tsx`**

1. In `ui/src/utils/conversion.ts`, add this to the `FlowNodeData` member list (type only):
   ```ts
     /** Action Type value not found in the loaded catalog (editor only). */
     unresolvedActionType?: string;
   ```
2. In `WorkflowEditor.tsx`, import `unresolvedActionTypeIds` and add:

```tsx
  const unresolvedIds = useMemo(() => unresolvedActionTypeIds(semanticWorkflow, actionTypeCatalog),
    [semanticWorkflow, actionTypeCatalog]);
```

`useActionTypeCatalog` returns a new object on every render. Wrap its return value in `useMemo` keyed on
`[state.actionTypes, state.status]` inside the hook, so dependent memos stay stable.

3. Extend the `nodesWithValidation` memo:
   - Compute `const unresolved = unresolvedIds.has(node.id) ? String((node.data.config as { actionType?: unknown }).actionType) : undefined;`.
   - Include `unresolved` in the "needs a copy" condition and add `unresolvedActionType: unresolved` to the
     copied data.
   - Change the early return to `if (!validationProblems?.length && !parallelAnalysis && !unresolvedIds.size) return nodes;`.
   - Add `unresolvedIds` to the memo's dependencies.

- [ ] **Step 5: Render the marker in `validationBadge.tsx` (4-space indent)**

Add a component next to `ValidationBadge`:

```tsx
/** A "?" marker on the node's top-right corner for an Action Type missing from the catalog. */
function UnresolvedActionTypeMarker({ value }: { value: string }) {
    const label = `Unknown Action Type: ${value}`;
    return (
        <Tooltip content={label} position="top">
            <span className="flow-node-unresolved" role="img" aria-label={label}>?</span>
        </Tooltip>
    );
}
```

In `withValidationBadge`, render
`{data.unresolvedActionType ? <UnresolvedActionTypeMarker value={data.unresolvedActionType} /> : null}`
after the validation badge. Update the TSDoc to mention the marker.

Append to `validationBadge.css`:

```css
/* Unresolved Action Type marker: straddles the top-right corner. */
.flow-node-unresolved {
    position: absolute;
    top: -8px;
    right: -8px;
    z-index: 2;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--flow-status-info, #2b9af3);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    cursor: help;
    pointer-events: auto;
    box-shadow: 0 0 0 1px var(--flow-bg-primary, #fff);
}
```

- [ ] **Step 6: Show the panel note in `ActionNodeFields` (`PropertiesPanel.tsx`)**

Add `catalogStatus` to the props if Task 2 did not. Compute:

```tsx
  const unresolved = catalogStatus === 'ready' && currentActionType.trim() !== '' && !descriptor;
```

Render this right after the `descriptor?.description` hint:

```tsx
        {unresolved && (
          <div className="properties-panel__field-hint properties-panel__field-hint--unresolved">Not in the catalog yet</div>
        )}
```

Optionally style `--unresolved` with `color: var(--flow-status-info, #2b9af3);` in `PropertiesPanel.css`.

- [ ] **Step 7: Verify and commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run test:browser`

Expected: PASS.

```bash
git add ui/src ui/browser/host.tsx ui/browser/action-catalog.spec.ts
git commit -m "Mark action nodes whose Action Type is not in the catalog"
```

---

### Task 4: `openActionType` and docs

**Files:**
- Modify:
  - `ui/src/types/spi.ts`
  - `ui/src/components/panels/PropertiesPanel.tsx`
  - `ui/browser/action-catalog.spec.ts`
  - `docs/user-guide/ai-assisted-editing.md`

**Interfaces:**
- Consumes:
  - the `?catalog` and `?noOpen` modes, and the `open-requests` output (Task 3)
  - `catalogStatus` and `descriptor` in `ActionNodeFields`
- Produces: `EditorSpi.openActionType?: (request: { value: string; resolved: boolean }) => void`

- [ ] **Step 1: Add the failing e2e tests to `ui/browser/action-catalog.spec.ts`**

```ts
test('Create… and Open call the host with the Action Type and whether it resolved', async ({ page }) => {
    await page.goto('/?catalog');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await editor.getByRole('button', { name: 'Create…', exact: true }).click();
    await editor.getByRole('button', { name: 'Add noop to catalog' }).click();
    await editor.getByRole('button', { name: 'Open', exact: true }).click();
    expect(JSON.parse(await editor.getByTestId('open-requests').textContent() ?? '[]')).toEqual([
        { value: 'noop', resolved: false }, { value: 'noop', resolved: true },
    ]);
});

test('the button is absent without openActionType', async ({ page }) => {
    await page.goto('/?catalog&noOpen');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.locator('.react-flow__node[data-id="a"]').click();
    await expect(editor.getByRole('button', { name: /^(Open|Create…)$/ })).toHaveCount(0);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm run test:browser -- action-catalog.spec.ts`

Expected: the first new test FAILS.

- [ ] **Step 3: Add `openActionType` to `EditorSpi` in `ui/src/types/spi.ts`**

```ts
  /**
   * Opens the host's Action Type editor. Called from the Properties panel's Open/Create… button, which is
   * shown only when this is provided. `resolved` is false when the value is not in the loaded catalog.
   */
  openActionType?: (request: { value: string; resolved: boolean }) => void;
```

- [ ] **Step 4: Render the button in `ActionNodeFields`**

1. Pass `openActionType={spi?.openActionType}` from `PropertiesPanel` into `ActionNodeFields` as a new
   optional prop.
2. Wrap the existing picker or text input in `<div className="properties-panel__action-type-row">`, followed
   by:

```tsx
          {openActionType && currentActionType.trim() !== '' && (
            <button type="button" className="properties-panel__open-action-type"
              onClick={() => {
                try {
                  openActionType({ value: currentActionType, resolved: !unresolved });
                } catch (error) {
                  console.error('openActionType threw', error);
                }
              }}>
              {unresolved ? 'Create…' : 'Open'}
            </button>
          )}
```

3. In read-only mode the panel's controls are disabled through a `<fieldset disabled>`. If that disables this
   button, render it outside the fieldset or check how the panel exempts other controls. The button must work
   when the editor is read-only (spec §2).
4. Add CSS in `PropertiesPanel.css`:

```css
.properties-panel__action-type-row { display: flex; gap: 8px; align-items: flex-start; }
.properties-panel__action-type-row > :first-child { flex: 1; min-width: 0; }
.properties-panel__open-action-type { padding: 6px 10px; border: 1px solid var(--flow-border, #d2d2d2);
  border-radius: 4px; background: var(--flow-bg-primary, #fff); color: var(--flow-text, #151515); cursor: pointer;
  white-space: nowrap; }
.properties-panel__open-action-type:hover { background: var(--flow-bg-hover, #f0f0f0); }
```

- [ ] **Step 5: Add the user guide section**

In `docs/user-guide/ai-assisted-editing.md`, add this immediately before `## Events`. Wrap lines at 110
characters, except in tables and code.

````markdown
## Live Action Type catalog

The editor loads `spi.actionTypes` once for the whole editor. To change the catalog, for example after an
agent creates an Action Type, pass a new array or provider function. The editor reloads it without a
remount, and while a provider function loads it keeps the previous list visible.

```tsx
const [catalog, setCatalog] = useState<ActionTypeDescriptor[]>(initialCatalog);
const spi = useMemo<EditorSpi>(() => ({
  actionTypes: catalog,
  openActionType: ({ value, resolved }) => (resolved ? openEditor(value) : openCreateDialog(value)),
}), [catalog]);
// Later, when Axiom reports a new Action Type:
setCatalog(previous => [...previous, created]);
```

- **Unresolved references:** once the catalog has loaded, an action node whose Action Type is not in it shows
  a "?" marker, and the Properties panel says "Not in the catalog yet". Both disappear as soon as the catalog
  includes the value. Built-in validation does not report unknown Action Types; use `spi.validate` if you
  want a problem.
- **Opening your editor:** when `openActionType` is provided, the Properties panel shows **Open** (or
  **Create…** for an unresolved value) next to the Action Type field. This also applies in read-only
  editors. To offer the same from the canvas, add a host item with `contextActions`.
````

- [ ] **Step 6: Verify and commit**

Run from `ui/`: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build && npm run test:browser`

Then, from the repo root: `mkdocs build --strict -q -d /tmp/flow-site`

Expected: everything passes.

```bash
git add ui/src ui/browser/action-catalog.spec.ts docs/user-guide/ai-assisted-editing.md
git commit -m "Let hosts open their Action Type editor from the Properties panel"
```
