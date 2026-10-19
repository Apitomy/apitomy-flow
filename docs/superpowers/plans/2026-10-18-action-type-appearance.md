# Action Type Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Action nodes show a host-chosen icon and accent color, chosen per action type, identically in
`WorkflowEditor` and `WorkflowViewer`.

**Architecture:** `ActionTypeDescriptor` gains optional `icon` and `color`. A pure lookup maps action nodes
to an `ActionAppearance` from the loaded catalog. Both components attach it to React Flow node data
(`FlowNodeData.actionAppearance`), and `ActionNode` renders it. The Viewer gains an `actionTypes` prop loaded
with the existing `useActionTypeCatalog` hook.

**Tech Stack:** TypeScript, React 19, `@xyflow/react` v12, PatternFly icons, vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-action-type-appearance-design.md`

## Global Constraints

- All commands run from `ui/`. Tests: `npx vitest run <path>`; typecheck: `npx tsc --noEmit`; lint:
  `npm run lint`.
- No `@testing-library/react` / jsdom: only pure logic gets unit tests.
- Appearance is never written into the workflow document.
- Only Action nodes change. Other node types and `WorkflowDiffViewer` are out of scope.
- Color is one accent: it sets border and icon color only; background and text stay theme-controlled.
- Nodes without an appearance keep today's look and (in the Editor) their object identity.
- Files in `ui/src/utils` and `ui/src/hooks` use 4-space indentation; components use 2-space. Match the file
  you edit.
- Public functions get JSDoc.

---

### Task 1: Descriptor fields and pure appearance lookup

**Files:**
- Modify: `ui/src/types/spi.ts:13-19`
- Create: `ui/src/utils/actionAppearance.ts`
- Test: `ui/src/utils/actionAppearance.test.ts`
- Modify: `ui/src/index.ts:8` (export the new type)

**Interfaces:**
- Consumes: `ActionTypeCatalog` from `ui/src/hooks/actionTypeCatalogState.ts`
  (`{ actionTypes: ActionTypeDescriptor[]; status: 'none' | 'loading' | 'ready' }`), `WorkflowNode` from
  `ui/src/types/workflow.ts`.
- Produces:
  - `interface ActionAppearance { icon?: ReactNode; color?: string }`
  - `actionAppearanceFor(actionType: unknown, catalog: ActionTypeCatalog): ActionAppearance | undefined`
  - `actionAppearanceByNodeId(nodes: WorkflowNode[], catalog: ActionTypeCatalog): Map<string, ActionAppearance>`

- [ ] **Step 1: Add descriptor fields**

In `ui/src/types/spi.ts`, extend `ActionTypeDescriptor` (`ReactNode` is already imported):

```ts
export interface ActionTypeDescriptor {
  value: string;
  label: string;
  description?: string;
  inputs?: ActionTypeField[];
  outputs?: ActionTypeField[];
  /** Icon shown on Action nodes of this type (and in the type picker), replacing the default play icon. */
  icon?: ReactNode;
  /**
   * Accent color for Action nodes of this type: any CSS color, including `var(...)`. It sets the node's
   * border and icon color; background and text stay theme-controlled.
   */
  color?: string;
}
```

- [ ] **Step 2: Write the failing test**

`ui/src/utils/actionAppearance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { ActionTypeCatalog } from '../hooks/actionTypeCatalogState.ts';
import type { ActionTypeDescriptor } from '../types/spi.ts';
import type { WorkflowNode } from '../types/workflow.ts';
import { actionAppearanceByNodeId, actionAppearanceFor } from './actionAppearance.ts';

const icon = createElement('svg', { 'data-testid': 'mail' });
const email: ActionTypeDescriptor = { value: 'email', label: 'Email', icon, color: '#c9190b' };
const slack: ActionTypeDescriptor = { value: 'slack', label: 'Slack', color: 'var(--brand)' };
const plain: ActionTypeDescriptor = { value: 'plain', label: 'Plain' };
const blank: ActionTypeDescriptor = { value: 'blank', label: 'Blank', color: '   ' };
const ready: ActionTypeCatalog = { actionTypes: [email, slack, plain, blank], status: 'ready' };

describe('actionAppearanceFor', () => {
    it('returns icon and color for a styled match', () => {
        expect(actionAppearanceFor('email', ready)).toEqual({ icon, color: '#c9190b' });
    });
    it('returns color only when the descriptor has no icon', () => {
        expect(actionAppearanceFor('slack', ready)).toEqual({ color: 'var(--brand)' });
    });
    it('returns undefined for an unknown type', () => {
        expect(actionAppearanceFor('nope', ready)).toBeUndefined();
    });
    it('returns undefined for a descriptor with neither icon nor color', () => {
        expect(actionAppearanceFor('plain', ready)).toBeUndefined();
    });
    it('ignores a blank color', () => {
        expect(actionAppearanceFor('blank', ready)).toBeUndefined();
    });
    it('ignores a non-string color', () => {
        const odd = { value: 'odd', label: 'Odd', color: 42 } as unknown as ActionTypeDescriptor;
        expect(actionAppearanceFor('odd', { actionTypes: [odd], status: 'ready' })).toBeUndefined();
    });
    it('returns undefined for non-string action types', () => {
        expect(actionAppearanceFor(7, ready)).toBeUndefined();
        expect(actionAppearanceFor(null, ready)).toBeUndefined();
        expect(actionAppearanceFor(undefined, ready)).toBeUndefined();
    });
    it('uses whatever descriptors are present regardless of status', () => {
        expect(actionAppearanceFor('email', { actionTypes: [], status: 'loading' })).toBeUndefined();
        expect(actionAppearanceFor('email', { actionTypes: [], status: 'none' })).toBeUndefined();
        expect(actionAppearanceFor('email', { actionTypes: [email], status: 'loading' }))
            .toEqual({ icon, color: '#c9190b' });
    });
});

describe('actionAppearanceByNodeId', () => {
    it('maps only styled action nodes', () => {
        const nodes = [
            { id: 's', type: 'start', name: 'Start', config: {} },
            { id: 'a1', type: 'action', name: 'Mail', config: { actionType: 'email' } },
            { id: 'a2', type: 'action', name: 'Plain', config: { actionType: 'plain' } },
            { id: 'a3', type: 'action', name: 'None', config: {} },
            { id: 'a4', type: 'action', name: 'Slack', config: { actionType: 'slack' } },
            { id: 'e', type: 'end', name: 'End', config: {} },
        ] as WorkflowNode[];
        const result = actionAppearanceByNodeId(nodes, ready);
        expect([...result.keys()]).toEqual(['a1', 'a4']);
        expect(result.get('a4')).toEqual({ color: 'var(--brand)' });
    });
    it('is empty when the catalog is empty', () => {
        const nodes = [{ id: 'a', type: 'action', name: 'A', config: { actionType: 'email' } }] as WorkflowNode[];
        expect(actionAppearanceByNodeId(nodes, { actionTypes: [], status: 'none' }).size).toBe(0);
    });
});
```

Note: during a catalog reload the status is `ready` with the previous list kept, and on first async load the
list is empty, so the lookup intentionally uses whatever descriptors are present and ignores `status`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/utils/actionAppearance.test.ts`
Expected: FAIL — cannot resolve `./actionAppearance.ts`.

- [ ] **Step 4: Implement**

`ui/src/utils/actionAppearance.ts`:

```ts
import type { ReactNode } from 'react';
import type { ActionTypeCatalog } from '../hooks/actionTypeCatalogState.ts';
import type { WorkflowNode } from '../types/workflow.ts';

/** Host-chosen look for an Action node, taken from its Action Type descriptor. */
export interface ActionAppearance {
    /** Replaces the default play icon. */
    icon?: ReactNode;
    /** Accent color (any CSS color) for the node border and icon. */
    color?: string;
}

/**
 * Finds the appearance for one Action Type value.
 *
 * @param actionType the node's `config.actionType`, of any type
 * @param catalog the loaded Action Type catalog
 * @returns the descriptor's icon and/or color, or undefined when there is no match or nothing to style
 */
export function actionAppearanceFor(actionType: unknown, catalog: ActionTypeCatalog): ActionAppearance | undefined {
    if (typeof actionType !== 'string') return undefined;
    const descriptor = catalog.actionTypes.find(candidate => candidate.value === actionType);
    if (!descriptor) return undefined;
    const icon = descriptor.icon ?? undefined;
    const color = typeof descriptor.color === 'string' && descriptor.color.trim() !== ''
        ? descriptor.color : undefined;
    if (icon === undefined && color === undefined) return undefined;
    const appearance: ActionAppearance = {};
    if (icon !== undefined) appearance.icon = icon;
    if (color !== undefined) appearance.color = color;
    return appearance;
}

/**
 * Computes appearances for every styled Action node.
 *
 * @param nodes the workflow nodes
 * @param catalog the loaded Action Type catalog
 * @returns node id to appearance, containing only Action nodes whose descriptor has an icon or color
 */
export function actionAppearanceByNodeId(nodes: WorkflowNode[], catalog: ActionTypeCatalog): Map<string, ActionAppearance> {
    const result = new Map<string, ActionAppearance>();
    if (catalog.actionTypes.length === 0) return result;
    for (const node of nodes) {
        if (node.type !== 'action') continue;
        const appearance = actionAppearanceFor(node.config.actionType, catalog);
        if (appearance) result.set(node.id, appearance);
    }
    return result;
}
```

- [ ] **Step 5: Export the type**

In `ui/src/index.ts`, add after line 8:

```ts
export type { ActionAppearance } from './utils/actionAppearance.ts';
```

- [ ] **Step 6: Verify**

Run: `npx vitest run src/utils/actionAppearance.test.ts src/dev/libraryExports.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. If `libraryExports.test.ts` snapshots the export list, update it to include
the new type (type-only exports do not appear at runtime, so it most likely needs no change).

- [ ] **Step 7: Commit**

```bash
git add ui/src/types/spi.ts ui/src/utils/actionAppearance.ts ui/src/utils/actionAppearance.test.ts ui/src/index.ts
git commit -m "Add icon and color to ActionTypeDescriptor with appearance lookup"
```

---

### Task 2: Render the appearance on ActionNode and wire it into Editor and Viewer

**Files:**
- Modify: `ui/src/utils/conversion.ts:6-17`
- Modify: `ui/src/components/nodes/ActionNode.tsx`
- Modify: `ui/src/components/nodes/ActionNode.css`
- Modify: `ui/src/components/WorkflowEditor.tsx:271-291`
- Modify: `ui/src/components/WorkflowViewer.tsx:40-55, 106-130`

**Interfaces:**
- Consumes: `ActionAppearance`, `actionAppearanceByNodeId` (Task 1); `useActionTypeCatalog(provider:
  ActionTypeProvider | undefined): ActionTypeCatalog` from `ui/src/hooks/useActionTypeCatalog.ts`.
- Produces: `FlowNodeData.actionAppearance?: ActionAppearance`; `WorkflowViewerProps.actionTypes?:
  ActionTypeProvider`.

- [ ] **Step 1: Extend `FlowNodeData`**

In `ui/src/utils/conversion.ts`, add the import and field (after `unresolvedActionType`):

```ts
import {type ActionAppearance} from './actionAppearance.ts';
```

```ts
  /** Host-chosen icon/color for an Action node, from its Action Type descriptor. */
  actionAppearance?: ActionAppearance;
```

- [ ] **Step 2: Render in `ActionNode.tsx`**

Replace the file with:

```tsx
import { type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PlayIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './ActionNode.css';

export function ActionNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const appearance = nodeData.actionAppearance;
  const style = appearance?.color
    ? ({ '--flow-node-action-accent': appearance.color } as CSSProperties)
    : undefined;

  return (
    <div className={`flow-node-action ${selected ? 'selected' : ''}`} style={style}>
      <Handle type="target" position={Position.Left} />
      <span className="flow-node-action-icon" aria-hidden="true">{appearance?.icon ?? <PlayIcon />}</span>
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 3: CSS**

In `ui/src/components/nodes/ActionNode.css`, replace the `border:` line and append the icon rule:

```css
  border: 2px solid var(--flow-node-action-accent, var(--flow-node-action-border, #06c));
```

```css
.flow-node-action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--flow-node-action-accent, inherit);
}
.flow-node-action-icon > svg,
.flow-node-action-icon > img { width: 100%; height: 100%; }
```

- [ ] **Step 4: Editor wiring**

In `ui/src/components/WorkflowEditor.tsx`, import
`import { actionAppearanceByNodeId } from '../utils/actionAppearance.ts';` and replace lines 271-291 with:

```tsx
  const unresolvedIds = useMemo(() => unresolvedActionTypeIds(semanticWorkflow, actionTypeCatalog),
    [semanticWorkflow, actionTypeCatalog]);
  const appearances = useMemo(() => actionAppearanceByNodeId(semanticWorkflow.nodes, actionTypeCatalog),
    [semanticWorkflow, actionTypeCatalog]);

  const nodesWithValidation = useMemo(() => {
    if (!validationProblems?.length && !parallelAnalysis && !unresolvedIds.size && !appearances.size) return nodes;
    return nodes.map(node => {
      const problems = validationProblems.filter(p => p.nodeId === node.id);
      const role = parallelRole(node.id, parallelAnalysis);
      const unresolved = unresolvedIds.has(node.id)
        ? String((node.data.config as { actionType?: unknown }).actionType) : undefined;
      const appearance = appearances.get(node.id);
      return (problems.length || role || unresolved || appearance) ? {
        ...node,
        data: {
          ...node.data,
          validationProblems: problems.length ? problems : undefined,
          parallelRole: role,
          unresolvedActionType: unresolved,
          actionAppearance: appearance,
        },
      } : node;
    });
  }, [nodes, validationProblems, parallelAnalysis, unresolvedIds, appearances]);
```

Confirm `semanticWorkflow` updates when a node's `actionType` changes in the Properties panel (it is the
semantic revision, so it does); this makes the appearance follow type edits.

- [ ] **Step 5: Viewer wiring**

In `ui/src/components/WorkflowViewer.tsx`:

Imports:

```tsx
import { type ActionTypeProvider } from '../types/spi.ts';
import { useActionTypeCatalog } from '../hooks/useActionTypeCatalog.ts';
import { actionAppearanceByNodeId } from '../utils/actionAppearance.ts';
```

Add to `WorkflowViewerProps`:

```ts
  /**
   * The Action Type catalog, used for Action node icons and colors. Pass the same value as the editor's
   * `spi.actionTypes` so both components render action types identically.
   */
  actionTypes?: ActionTypeProvider;
```

Destructure it: `function WorkflowViewerInner({ workflow, instance, theme = 'light', nodeContextMenuItems, actionTypes }: WorkflowViewerProps)`.

Before the `nodes` memo:

```tsx
  const actionTypeCatalog = useActionTypeCatalog(actionTypes);
  const appearances = useMemo(() => actionAppearanceByNodeId(laidOutNodes, actionTypeCatalog),
    [laidOutNodes, actionTypeCatalog]);
```

In the `nodes` memo change the data line and dependency list:

```tsx
        data: { ...node.data, isCurrent: isCurrent && !isTerminal, actionAppearance: appearances.get(node.id) },
```

```tsx
  }, [laidOutNodes, activeIds, instance.status, isTerminal, visitedNodeIds, selectedNodeId, appearances]);
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: no errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add ui/src/utils/conversion.ts ui/src/components/nodes/ActionNode.tsx ui/src/components/nodes/ActionNode.css ui/src/components/WorkflowEditor.tsx ui/src/components/WorkflowViewer.tsx
git commit -m "Render action type icon and color on Action nodes in editor and viewer"
```

---

### Task 3: Icons in the Action Type picker

**Files:**
- Modify: `ui/src/components/panels/ActionTypeSelect.tsx:72-76`

**Interfaces:**
- Consumes: `ActionTypeDescriptor.icon` (Task 1).

- [ ] **Step 1: Pass the icon to options**

PatternFly `SelectOption` supports an `icon` prop. Change the option render to:

```tsx
                {filteredOptions.map(action => (
                    <SelectOption key={action.value} value={action.value} description={action.description}
                        icon={action.icon}>
                        {action.label}
                    </SelectOption>
                ))}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/panels/ActionTypeSelect.tsx
git commit -m "Show action type icons in the Action Type picker"
```

---

### Task 4: Dev app demo, docs, and visual check

**Files:**
- Modify: `ui/src/dev/demoCatalog.ts`
- Modify: `ui/src/dev/App.tsx:313-318`
- Modify: `docs/user-guide/visual-editor.md:382-388`
- Modify: `docs/user-guide/workflow-viewer.md:29` and a new section before `## Styling`

- [ ] **Step 1: Style demo catalog entries**

`demoCatalog.ts` is a `.ts` file, so use `createElement` rather than JSX. Add imports:

```ts
import { createElement } from 'react';
import { EnvelopeIcon, GlobeIcon, BugIcon, TicketAltIcon } from '@patternfly/react-icons';
```

Add to the descriptors (leave `analyze-cve` and `close-tracker` unstyled to show the default):

- `send-email`: `icon: createElement(EnvelopeIcon), color: '#c9190b',`
- `http-request`: `icon: createElement(GlobeIcon),`
- `lookup-cve`: `icon: createElement(BugIcon), color: '#8476d1',`
- `create-jira-ticket`: `icon: createElement(TicketAltIcon), color: '#f0ab00',`

If an icon name does not exist in `@patternfly/react-icons` (`tsc` will say so), pick another that does.

- [ ] **Step 2: Pass the catalog to the demo Viewer**

In `ui/src/dev/App.tsx`, add `actionTypes={demoCatalog}` to the `<WorkflowViewer ... />` element.

- [ ] **Step 3: Docs — editor**

In `docs/user-guide/visual-editor.md`, add to the `ActionTypeDescriptor` block:

```ts
  icon?: ReactNode;              // shown on Action nodes of this type and in the dropdown
  color?: string;                // accent color (any CSS color) for the node border and icon
```

and after the code block that ends the descriptor section add (wrap at 110 chars):

```markdown
##### Action node icons and colors

Set `icon` and/or `color` on a descriptor to make Action nodes of that type easy to tell apart. `icon`
replaces the default play icon (it is sized to 16px). `color` is a single accent applied to the node border
and icon; the background and text keep their theme colors so nodes stay readable in light and dark mode.
Nodes whose type has no descriptor, or whose catalog is still loading, use the default look. Pass the same
catalog to `WorkflowViewer`'s `actionTypes` prop so running workflows look the same.
```

- [ ] **Step 4: Docs — viewer**

In `docs/user-guide/workflow-viewer.md`, add a props table row after `nodeContextMenuItems`:

```markdown
| `actionTypes` | `ActionTypeProvider` | No | Action Type catalog used for Action node icons and colors. Pass the same value as the editor's `spi.actionTypes`. See [Action Type Icons and Colors](#action-type-icons-and-colors) |
```

And a section before `## Styling`:

````markdown
### Action Type Icons and Colors

When `actionTypes` is set, Action nodes use the `icon` and `color` of their Action Type descriptor, exactly
as in the editor. Share one catalog between the two components:

```tsx
const actionTypes: ActionTypeDescriptor[] = [
  { value: 'email.send', label: 'Send email', icon: <EnvelopeIcon />, color: '#c9190b' },
  { value: 'slack.post', label: 'Post to Slack', icon: <SlackIcon /> },
];

<WorkflowEditor spi={{ actionTypes }} ... />
<WorkflowViewer actionTypes={actionTypes} ... />
```

A function provider is loaded the same way as in the editor; nodes use the default look until it resolves.
````

- [ ] **Step 5: Full verification**

Run: `npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: all succeed.

- [ ] **Step 6: Visual check**

Run `npm run dev` and open <http://localhost:5173/>. In the Editor, with a scenario containing
`send-email`/`lookup-cve` actions:
- styled nodes show the host icon and accent border; unstyled ones look as before;
- changing a node's action type in the Properties panel updates the icon/color immediately;
- the action-type dropdown shows icons;
- selection ring, validation badge and unresolved "?" marker still appear.

In the Viewer: the same nodes show the same icons/colors, and visited/current/failed highlighting still
shows. Repeat both in the dark theme.

- [ ] **Step 7: Commit**

```bash
git add ui/src/dev/demoCatalog.ts ui/src/dev/App.tsx docs/user-guide/visual-editor.md docs/user-guide/workflow-viewer.md
git commit -m "Document action type icons and colors and show them in the dev app"
```
