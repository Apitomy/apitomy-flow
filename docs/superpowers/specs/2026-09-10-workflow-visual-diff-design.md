# Workflow Visual Diff Design

## Overview

Issue: `#93` introduces a visual diff view for workflow definitions in `@apitomy/flow-ui`.

This design adds a new exported component, `WorkflowDiffViewer`, that compares two workflow definitions and
renders a graph-aware diff. The key goal is to separate semantic changes (structure/behavior) from cosmetic
changes (position-only edits and array ordering noise).

## Goals

- Provide a visual diff for two workflow definitions using existing graph rendering patterns.
- Clearly classify nodes/edges as added, removed, changed, unchanged, or cosmetic-only.
- Keep comparison logic pure and independently testable.
- Surface version context in the UI so comparisons are anchored to meaningful labels.

## Non-Goals

- No workflow registry, persistence layer, or version history backend.
- No merge/conflict resolution workflow.
- No migration strategy for in-flight instances across workflow versions.

## Public API

Add a new exported component:

- `WorkflowDiffViewer`

Proposed props shape:

- `baseWorkflow: Workflow`
- `compareWorkflow: Workflow`
- `theme?: FlowTheme`

Behavioral decisions:

- Identity matching uses IDs only.
  - Node identity: same `node.id`.
  - Edge identity: same `edge.id`.
- `version` is optional but surfaced prominently when present.
  - Labels resolve as `name (vN)` when `version` exists.
  - Fallback order: `name`, then `id`.

## Architecture

### New UI Component

`ui/src/components/WorkflowDiffViewer.tsx`

Responsibilities:

- Accept base and compare workflows.
- Compute diff model in `useMemo` via pure utility.
- Render one overlaid React Flow graph with diff-aware styles.
- Show summary counts and legend.
- Show details panel for selected node/edge with before/after fields.

### New Diff Utility Module

`ui/src/diff/workflowDiff.ts`

Responsibilities:

- Compare two workflows and return a typed `WorkflowDiffResult`.
- Normalize entities via ID maps.
- Ignore array ordering in `nodes` and `edges` arrays.
- Classify changes and attach structured change metadata.
- Emit warning metadata for duplicate IDs.

### New Diff Types Module

`ui/src/diff/workflowDiffTypes.ts`

Defines shared contracts for statuses, per-entity diff records, warnings, and summary counts.

### Styling

`ui/src/components/WorkflowDiffViewer.css`

Defines status treatments for:

- added
- removed
- changed (semantic)
- cosmetic (position-only)
- unchanged

Includes styles for legend, warning banner, and detail panel.

### Library Exports

Update `ui/src/index.ts` to export:

- `WorkflowDiffViewer`
- public diff types that hosts may consume

## Diff Semantics

### Node Classification

- `added`: node exists only in `compareWorkflow`.
- `removed`: node exists only in `baseWorkflow`.
- `unchanged`: node fields match semantically.
- `cosmetic`: only `position` changed.
- `changed`: semantic fields changed.

Node semantic fields:

- `type`
- `name`
- `config`

Node cosmetic field:

- `position`

### Edge Classification

- `added`: edge exists only in `compareWorkflow`.
- `removed`: edge exists only in `baseWorkflow`.
- `unchanged`: edge semantic fields unchanged.
- `changed`: one or more semantic fields changed.

Edge semantic fields:

- `source`
- `target`
- `condition`
- `priority`
- `isDefault`
- `label`

## Render Data Flow

1. Receive `baseWorkflow` and `compareWorkflow` props.
2. Compute `WorkflowDiffResult` with `diffWorkflows(base, compare)`.
3. Build render graph from union of node/edge IDs.
   - Prefer compare-side position where present.
   - Fallback to base-side position.
4. Optionally run existing layout pass when positions are absent (`needsLayout/layoutWorkflow`).
5. Render graph, legend, summary counts, and detail panel.

## Error Handling and Warnings

- Do not throw for expected mismatch states (added/removed/changed).
- Return warning metadata for ambiguous input (for example, duplicate IDs).
- Show warnings in a non-blocking viewer banner.
- If layout cannot be applied, render with available coordinates.

## Testing Strategy

Add unit tests for `ui/src/diff/workflowDiff.ts` covering:

- unchanged workflow
- node added/removed
- edge added/removed
- node semantic change (`name`, `type`, `config`)
- node cosmetic-only position change
- edge semantic changes (`source`, `target`, `condition`, `priority`, `isDefault`, `label`)
- array reordering ignored
- duplicate ID warnings
- label resolution with and without `version`

Add focused component-level tests for deterministic formatting/summary logic where practical.

Verification commands during implementation:

- `npx vitest run`
- `npx tsc --noEmit`

## File Impact

New files (planned):

- `ui/src/components/WorkflowDiffViewer.tsx`
- `ui/src/components/WorkflowDiffViewer.css`
- `ui/src/diff/workflowDiff.ts`
- `ui/src/diff/workflowDiffTypes.ts`
- `ui/src/diff/workflowDiff.test.ts`

Updated files (planned):

- `ui/src/index.ts`
- any existing shared style/theme files needed for status color tokens

## Open Decisions Resolved

- Comparison source: explicit `baseWorkflow` + `compareWorkflow` props.
- UI surface: new exported `WorkflowDiffViewer` component.
- Node identity: ID-only matching.
- Position diffs: cosmetic-only (not semantic changed).
- Edge semantics: `priority` changes are semantic.
- Version surfacing: show `vN` prominently when available, fallback otherwise.
