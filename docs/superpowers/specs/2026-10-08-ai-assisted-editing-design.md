# AI-Assisted Editing Foundations — Design

Date: 2026-10-08
Status: Approved (brainstorming)

## Context

Apitomy Axiom will offer an AI-based workflow creation experience in which the user makes manual and
AI-assisted edits concurrently. Apitomy Flow (`@apitomy/flow-ui`) is the canvas for that experience. This
spec covers the Flow-side foundations (sub-projects 1–3 of the feature set below).

## Decisions

| Topic | Decision |
|---|---|
| Where the agent runs | Outside Flow (Axiom/host). Flow is AI-agnostic and exposes an edit API. |
| How AI edits land | Staged change sets are the primitive; "apply live" = auto-accepting a change set as one tagged, undoable transaction. |
| Action Types / tools authoring | Not owned by Flow. Axiom has its own editors. |
| AI entry points in Flow | Host-defined context hooks only; no chat and no agent-status UI in Flow. |
| Conflicts | Strict base-revision check; stale change sets are rejected and the host re-asks the agent. |

## Overall Feature Set

1. Revision and origin model (this spec)
2. Change sets and imperative editor handle (this spec)
3. Proposal review UX (this spec)
4. Context hooks: host `contextActions` in canvas/node/edge/selection menus and Problems panel rows,
   receiving a `FlowContext { workflow, contentRevision, selection, problems, position? }` (future spec)
5. Live Action Type catalog: subscribable `ActionTypeProvider`, "unresolved" rendering for unknown action
   types, `onOpenActionType(value)` host callback (future spec)

Out of scope: in-Flow chat, agent status display, per-change rebase, Action Type / tool editing in Flow.

## §1 Revision and Origin

- **`contentRevision`**: deterministic hash of the editor's `semanticDocument`, exposed as an opaque string.
  It is distinct from the existing internal `revision` counter, which also increments on layout-only edits.
  - Layout-only edits do not change it.
  - Undo to identical content restores the identical value.
  - The hash algorithm is pure and documented so a host may compute it server-side.
- **Origin**: `EditorCommand` gains optional `origin?: 'user' | 'host' | `agent:${string}`` (default
  `'user'`). Undo snapshots record the origin of the change that produced them so undo labels can name it.
- **`onChange`** becomes `onChange(workflow, meta: { contentRevision, origin })`. The added argument is
  backwards compatible.
- **`handle.replace(workflow, origin)`** replaces the document via the existing `import` command as one
  undo step. The `workflow` prop remains seed-only.

## §2 Change Sets

```ts
interface ChangeSet {
    id: string;
    baseRevision: string;            // contentRevision the agent based this on
    author: `agent:${string}` | 'host';
    summary: string;
    ops: ChangeOp[];
}

type ChangeOp =
    | { op: 'addNode'; node: WorkflowNode }
    | { op: 'updateNode'; id: string; patch: { name?: string; config?: Record<string, unknown> } }
    | { op: 'renameNode'; id: string; newId: string }
    | { op: 'removeNode'; id: string }
    | { op: 'addEdge'; edge: WorkflowEdge }
    | { op: 'updateEdge'; id: string; patch: Partial<Omit<WorkflowEdge, 'id'>> }
    | { op: 'removeEdge'; id: string }
    | { op: 'metadata'; patch: Partial<Pick<Workflow, 'name' | 'description' | 'version'>> };
```

Op semantics:

- `updateNode.patch.config` is merged shallowly into the existing config.
- `renameNode` rewrites the `source`/`target` of attached edges, the same as the existing `renameNode`
  command.
- `removeNode` also removes all edges attached to the node.
- Ops apply in order. Later ops see the effects of earlier ops.

Pure core, in `ui/src/changeset/applyChangeSet.ts`:

- `applyChangeSet(workflow, changeSet)` returns `{ ok: true; workflow }` or
  `{ ok: false; error: { opIndex: number; reason: string } }`.
- It is atomic. Failure reasons:
  - the target is missing;
  - the id is a duplicate;
  - an edge endpoint does not exist;
  - the op is malformed.
- Added nodes without a `position` are placed near their connected neighbours. If they have none, the
  existing layout fallback places them.

Imperative handle, exposed through a `ref` on `WorkflowEditor`. None of these methods throw.

| Method | Result |
|---|---|
| `propose(cs)` | `{ status: 'staged' }` or `'stale'` or `{ status: 'invalid', error }` |
| `apply(cs)` | `{ status: 'applied' }` or `'stale'` or `{ status: 'invalid', error }` |
| `withdraw(id)` | `void` |
| `replace(workflow, origin)` | `void` |
| `getSnapshot()` | `{ workflow, contentRevision, selection, problems }` |

Rules:

- `stale` means `cs.baseRevision !== contentRevision`.
- `apply` dispatches a new reducer command, `applyChangeSet`. That command produces exactly one undo step,
  with `origin = cs.author`.
- At most one staged proposal exists. A new `propose` replaces the current one, and the old one resolves as
  `'withdrawn'`.
- A staged proposal becomes stale on any content edit. Edits the user makes through undo or redo count too.
  It does not become stale on layout-only edits.

## §3 Proposal Review UX

- **Preview**: while a proposal is staged, `preview = applyChangeSet(document, cs)`. The canvas renders the
  preview's elements plus ghosts of removed elements. Each element gets a diff status of `added`,
  `modified`, `removed` or `unchanged`. That status comes from a pure helper, extracted from the existing
  `WorkflowDiffViewer` diff logic and shared with it.
- **Interaction**: the canvas stays editable. Proposal elements can't be edited. Selecting one shows a
  read-only before/after view in the Properties panel.
- **Review bar**: a floating panel at the top of the canvas.
  - It shows the summary, the author, and change counts.
  - It shows a validation delta for `preview` versus the current document, using built-in validation plus
    `spi.validate`: "introduces N / fixes M".
  - **Accept** runs the same path as `apply` and resolves as `'accepted'`. **Reject** discards the proposal
    and resolves as `'rejected'`.
  - When the proposal is stale, the bar shows "Out of date" and only **Dismiss** is available.
- **Events**: `onProposalResolved(id, 'accepted' | 'rejected' | 'stale' | 'withdrawn')`.
  - `'stale'` fires at the moment of invalidation.
  - On accept, `onChange` fires once, with the agent origin.
- **Read-only mode**:
  - `propose` renders the preview without the review bar, which is useful for displaying a diff.
  - `apply` returns `invalid` with the reason `'read-only'`.

## Error Handling

- No handle method throws.
- Invalid change sets return `{ status: 'invalid', error: { opIndex, reason } }`, which is suitable for
  sending back to the agent.
- Host validation failures in the preview are reported the same way as the existing host validation
  failures.

## Testing

Vitest unit tests on pure logic. No jsdom.

- `applyChangeSet`:
  - each op type;
  - missing targets and duplicate ids;
  - cascade on `removeNode`;
  - edge rewrite on `renameNode`;
  - op ordering;
  - atomicity.
- `contentRevision`:
  - stable for identical content;
  - unchanged by layout-only edits;
  - restored by undo.
- Reducer:
  - `applyChangeSet` creates a single undo step;
  - origin is recorded;
  - stale, staged and withdrawn transitions are correct.
- Diff status helper, including parity with `WorkflowDiffViewer` behaviour.
- Validation delta computation.
- Manual verification in the dev app (via Chrome DevTools MCP), with demo controls that propose or apply a
  canned change set.
