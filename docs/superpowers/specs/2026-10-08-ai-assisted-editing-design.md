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
| Server parity | Change-set application and `contentRevision` ship in both TS (`ui/`) and Java (`engine/`), verified by shared `conformance/` fixtures. |
| Per-turn grouping | No Flow support. Axiom accumulates a turn's change sets server-side and proposes one combined set. |

## Overall Feature Set

1. Revision and origin model (this spec)
2. Change sets and imperative editor handle (this spec)
3. Proposal review UX (this spec)
4. Context hooks: host `contextActions` in canvas, node, edge and selection menus and on Problems panel rows,
   receiving a `FlowContext { workflow, contentRevision, selection, problems, position? }` (future spec)
5. Live Action Type catalog: subscribable `ActionTypeProvider`, "unresolved" rendering for unknown action
   types, `onOpenActionType(value)` host callback (future spec)

Out of scope: in-Flow chat, agent status display, per-change rebase, Action Type / tool editing in Flow.

## §1 Revision and Origin

- **`contentRevision`**: `"sha256:" + hex(SHA-256(JCS(stripLayout(workflow))))`.
  - `JCS` is RFC 8785 JSON canonicalization.
  - `stripLayout` removes `position` from every node. All other fields, including workflow `id`, `name`,
    `description`, `version` and config extension keys, are part of the content.
  - It is distinct from the existing internal `revision` counter, which also increments on layout-only edits.
    Layout-only edits do not change it, and undo to identical content restores the identical value.
  - It is implemented in TS (`ui/src/changeset/contentRevision.ts`) and in Java (`ContentRevision` in
    `engine/`). Both are verified by `conformance/content-revision.json`.
  - Hosts computing it server-side must hash exactly the Flow `Workflow` document they send to the editor,
    with no host-specific fields added.
- **Origin**: `EditorCommand` gains optional `origin?: 'user' | 'host' | `agent:${string}`` (default
  `'user'`). Undo snapshots record the origin of the change that produced them so undo labels can name it.
- **`onChange`** becomes `onChange(workflow, meta: { contentRevision, origin })`. The added argument is
  backwards compatible.
- **`handle.replace(workflow, origin)`** replaces the document via the existing `import` command as one
  undo step. The `workflow` prop remains seed-only.
- **`onSelectionChange({ nodeIds, edgeIds })`**: fires only when the selection actually changes. Hosts use
  it to open related tabs (such as Action Type editors) and to feed "user is looking at X" context to the
  agent. It is pulled forward from the context-hooks work.

### Placement of positionless nodes

Today `import` calls `needsLayout`, which returns true when *any* node lacks a position. It then lays out
every node again, which would discard the user's manual layout whenever a server-produced document adds one
positionless node. The new behaviour:

- A pure helper, `placeNewNodes(workflow)`, positions only the nodes that have no position. It places each
  one near its connected neighbours, falling back to a free spot below the existing bounds.
- `import` (and therefore `replace`) uses `placeNewNodes` when at least one node already has a position.
  Full `layoutWorkflow` is used only when no node has a position.
- `applyChangeSet` uses `placeNewNodes` for added nodes.
- Placement is presentation only and is not part of the conformance fixtures. Java does not place nodes.

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
    | { op: 'updateNode'; id: string; patch: { name?: string; config?: Record<string, unknown> };
        unset?: string[] }
    | { op: 'renameNode'; id: string; newId: string }
    | { op: 'removeNode'; id: string }
    | { op: 'addEdge'; edge: WorkflowEdge }
    | { op: 'updateEdge'; id: string; patch: Partial<Omit<WorkflowEdge, 'id'>>; unset?: string[] }
    | { op: 'removeEdge'; id: string }
    | { op: 'metadata'; patch: Partial<Pick<Workflow, 'name' | 'description' | 'version'>> };
```

Op semantics:

- `updateNode.patch.config` is merged shallowly into the existing config. Nested values, such as the
  `inputs` and `outputs` mappings, are replaced whole.
- `updateNode.unset` lists top-level config keys to remove, for example `timeout` or `correlationKey`.
  `updateEdge.unset` lists top-level edge fields to remove, for example `condition`. `unset` is applied after
  `patch`, and a key appearing in both is `malformed`. `null` in a patch is stored as a value, not treated as
  a removal.
- Because `unset` and patches operate on top-level keys only, removing one entry from a nested mapping means
  resending the whole mapping. For example, to drop input `foo` from an action node, send
  `patch.config.inputs` containing every remaining input; `unset: ["inputs"]` would remove all of them.
- `renameNode` rewrites the `source`/`target` of attached edges, the same as the existing `renameNode`
  command.
- `removeNode` also removes all edges attached to the node.
- Ops apply in order. Later ops see the effects of earlier ops.

Pure core, in `ui/src/changeset/applyChangeSet.ts`:

- `applyChangeSet(workflow, changeSet)` returns `{ ok: true; workflow }` or
  `{ ok: false; error: ChangeSetError }`.
- `ChangeSetError` is `{ code, opIndex?, reason }`. `reason` is human-readable, and `code` is one of the
  stable values below, which hosts may map to agent prompt hints:

  | Code | Meaning |
  |---|---|
  | `target-missing` | The op references a node or edge that does not exist. |
  | `duplicate-id` | An added or renamed element's id already exists. |
  | `edge-endpoint-missing` | An edge's `source` or `target` does not exist. |
  | `malformed` | The op is structurally invalid, for example a key in both `patch` and `unset`. |
  | `read-only` | The editor is read-only. Handle only. |
  | `stale` | `baseRevision` does not match `contentRevision`. No `opIndex`. |

- It is atomic: any error leaves the workflow unchanged.
- Java parity: `ChangeSets.apply(workflow, changeSet)` in `engine/` has the same semantics and the same
  error codes. Both implementations are verified by `conformance/changesets.json`. Each fixture case gives an
  input workflow, a change set, and either the expected output workflow (compared with layout stripped) or
  the expected error `code` and `opIndex`.
- Added nodes without a `position` are placed by `placeNewNodes` (see §1).

Imperative handle, exposed through a `ref` on `WorkflowEditor`. None of these methods throw.

| Method | Result |
|---|---|
| `propose(cs)` | `{ status: 'staged' }` or `{ status: 'rejected', error }` |
| `apply(cs)` | `{ status: 'applied' }` or `{ status: 'rejected', error }` |
| `clearHighlights()` | `void` |
| `withdraw(id)` | `void` |
| `replace(workflow, origin)` | `void` |
| `getSnapshot()` | `{ workflow, contentRevision, selection, problems }` |

Rules:

- `cs.baseRevision !== contentRevision` produces the error code `stale`.
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
- **Highlight after apply**: elements added or modified by the most recently applied change set (via
  `apply` or Accept) keep a lingering highlight. It uses the same diff-status helper and the same styling as
  the review overlay. Removed elements get no ghost.
  - The highlight clears on the next user content edit, on `handle.clearHighlights()`, or when another
    change set is applied.
  - It is enabled by default and can be disabled with the `highlightApplied={false}` prop.
- **Events**: `onProposalResolved(id, 'accepted' | 'rejected' | 'stale' | 'withdrawn')`.
  - `'stale'` fires at the moment of invalidation.
  - On accept, `onChange` fires once, with the agent origin.
- **Read-only mode**:
  - `propose` renders the preview without the review bar, which is useful for displaying a diff.
  - `apply` returns an error with the code `read-only`.

## Error Handling

- No handle method throws.
- Failed change sets return `{ status: 'rejected', error: { code, opIndex?, reason } }`, which is
  suitable for sending back to the agent.
- Host validation failures in the preview are reported the same way as the existing host validation
  failures.

## Testing

Shared conformance fixtures, run by both the vitest and JUnit 5 suites:

- `conformance/changesets.json`: every op type, `unset`, every error code, cascade, rename rewrite, and
  ordering.
- `conformance/content-revision.json`: hashes for representative workflows, including key-order
  permutations and number formatting edge cases.

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
- `placeNewNodes`: only positionless nodes move, and the full-layout fallback applies when no node has a
  position.
- Highlight lifecycle: set on apply, cleared on user edit, on `clearHighlights` and on the next apply.
- `onSelectionChange`: fires only on an actual change.
- Java: JUnit 5 tests for `ChangeSets` and `ContentRevision` that drive the conformance fixtures.
- Manual verification in the dev app (via Chrome DevTools MCP), with demo controls that propose or apply a
  canned change set.
