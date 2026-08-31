# Host-Provided Workflow Validation — Design

**Date:** 2026-08-31
**Status:** Approved (design)
**Component:** `@apitomy/flow-ui` — `WorkflowEditor`

## Problem

Host applications embedding the `WorkflowEditor` need to run their own additional validations of
the workflow definition while the user is authoring it. The built-in validator
(`validateWorkflow`) covers structural, connectivity, edge-condition, and semantic rules that are
universal to the workflow model, but hosts have domain-specific rules the library cannot know about
— for example, "this action type must exist in our catalog", "this Jira project is valid", or
"this workflow name matches our naming policy". Some of these require a backend call.

Today there is no supported way for a host to contribute problems into the editor's validation UI.
There is a `validationProblems` prop on `WorkflowEditorProps`, but it is silently ignored (the
editor always recomputes internally) — see BACKLOG #23.

## Goals

- Let a host contribute additional `ValidationProblem`s that merge seamlessly with built-in
  validation and drive the existing UI (Problems panel, per-node error/warning decorations, and the
  `onValidationChange` callback).
- Support host validators that run asynchronously (e.g. server-backed checks).
- Keep the built-in validation path unchanged and unaffected by host behavior or host errors.
- Resolve the misleading dead `validationProblems` prop (BACKLOG #23).

## Non-Goals

- Allowing hosts to suppress, override, or reorder built-in problems. Host validation is purely
  **additive**.
- A blocking "save gate" — the editor emits problems via `onValidationChange`; whether errors block
  anything is the host's concern, unchanged by this feature.
- A "validating…" progress indicator in the Problems panel while async validation is in flight.
  Deliberately deferred; may be added later.
- A dedicated host error-reporting callback. Host validator failures are caught and logged only.

## Decisions

The following were decided during brainstorming:

1. **Integration model: SPI callback.** The host provides `spi.validate(workflow)`; the editor
   orchestrates calling it, merging results, debouncing, and driving the UI. Chosen over a
   controlled `validationProblems` prop (which would push debounce/async complexity onto the host)
   and over supporting both (unnecessary surface area). Consistent with the existing async-capable
   `actionTypes` provider.
2. **Async-capable.** `spi.validate` may return `ValidationProblem[]` or a `Promise` of them. The
   editor debounces while typing and ignores stale/out-of-order results.
3. **Remove the dead prop.** Delete the silently-ignored `validationProblems` prop, resolving
   BACKLOG #23. The SPI callback replaces its intended purpose.

## Public API

Add an async-capable validator type to the SPI, mirroring the sync-or-async `ActionTypeProvider`
pattern already in the file:

```ts
// types/spi.ts
import { type Workflow } from './workflow.ts';
import { type ValidationProblem } from './validation.ts';

export type WorkflowValidator =
  (workflow: Workflow) => ValidationProblem[] | Promise<ValidationProblem[]>;

export interface EditorSpi {
  actionTypes?: ActionTypeProvider;
  validate?: WorkflowValidator;   // NEW
}
```

Host usage:

```ts
const spi: EditorSpi = {
  validate: async (wf) => {
    const problems: ValidationProblem[] = [];
    // host-specific rules; may await backend calls
    return problems;
  },
};
```

- `ValidationProblem` and `ValidationSeverity` are already exported from `index.ts`. Also export the
  new `WorkflowValidator` type.
- Hosts produce the same `{ severity, code, message, nodeId?, edgeId? }` shape, so host problems
  automatically drive node decorations and Problems-panel click-to-navigate.
- **Guidance (docs, not enforced):** hosts should namespace their `code` values (e.g. `HOST_*`) to
  avoid confusion with built-in codes.

## Module Structure

Split the orchestration from React so the tricky logic is unit-testable with vitest alone (no
`@testing-library/react`/jsdom, which the repo does not currently use).

### `validation/hostValidation.ts` (new, pure, no React)

```ts
export interface DebouncedValidatorOptions {
  validate: WorkflowValidator;
  delay?: number;   // default 300ms
}

export interface DebouncedValidator {
  run(workflow: Workflow, onResult: (problems: ValidationProblem[]) => void): void;
  cancel(): void;
}

export function createDebouncedValidator(opts: DebouncedValidatorOptions): DebouncedValidator;
```

Responsibilities:
- **Debounce:** coalesce rapid `run` calls within `delay` into a single validator invocation.
- **Sync/async normalization:** wrap the validator's return value in `Promise.resolve`.
- **Stale-result rejection:** a monotonically increasing request token captured per invocation; when
  a promise resolves, apply its result via `onResult` only if it is still the latest token.
- **Error handling:** if the validator throws synchronously or the promise rejects, call
  `onResult([])` and `console.warn` — never surface to the built-in path.
- **`cancel()`:** clear any pending debounce timer and invalidate the in-flight token (used on
  unmount and when inputs change).

### `hooks/useHostValidation.ts` (new, thin React wrapper)

```ts
export function useHostValidation(
  workflow: Workflow,
  validate: WorkflowValidator | undefined,
): ValidationProblem[];
```

- Returns `[]` immediately (and does no work) when `validate` is `undefined`.
- Creates a `createDebouncedValidator` (memoized on `validate`), calls `run(workflow, setProblems)`
  in an effect keyed on `workflow`, and calls `cancel()` in the effect cleanup.
- Returns the latest host problems from state.

## Data Flow in `WorkflowEditor`

```ts
// unchanged: built-in problems, instant on every edit
const builtInProblems = useMemo(() => validateWorkflow(currentWorkflow), [currentWorkflow]);

// new: debounced, async-safe host problems
const hostProblems = useHostValidation(currentWorkflow, spi?.validate);

// merged list drives ALL existing consumers unchanged
const validationProblems = useMemo(
  () => [...builtInProblems, ...hostProblems],
  [builtInProblems, hostProblems],
);
```

The merged `validationProblems` continues to feed the three existing consumers with no changes to
them:
- `ProblemsPanel`
- `nodesWithValidation` (per-node error/warning border decorations)
- `onValidationChange(validationProblems)` — now reports the complete picture (built-in + host)
  rather than built-in only. This is a deliberate, correct behavior improvement.

Behavioral result: built-in problems still appear instantly; host problems appear shortly after (and
after any async resolves), merged seamlessly.

## Error & Edge Handling

- **Host validator throws/rejects:** caught in the orchestrator; host problems clear to `[]` and a
  `console.warn` is logged. Built-in validation is never affected.
- **Stale async results:** dropped via the request token; only the latest run's result is applied.
- **No `spi.validate`:** the hook short-circuits to `[]` with zero overhead; existing behavior is
  preserved exactly.
- **Unmount / rapid edits:** the pending debounce timer and in-flight token are cancelled via effect
  cleanup / `cancel()`.

## Removing the Dead Prop (BACKLOG #23)

Delete `validationProblems?: ValidationProblem[]` from `WorkflowEditorProps`. It is currently
silently ignored, so removal changes no runtime behavior; it is a breaking change to the props type
in name only. Mark BACKLOG #23 as fixed.

## Dev App Demo

Add a `validate` to the demo `spi` in `dev/App.tsx` so the feature is manually verifiable and serves
as living documentation. Illustrative rules:
- **Error:** an `action` node whose `actionType` is not among the known `actionTypes`.
- **Async warning:** a rule with simulated latency (e.g. `await` a short timeout) to demonstrate the
  debounced/async path and stale-result handling.

## Documentation

- Update `docs/user-guide/visual-editor.md` (and any SPI reference) with the `validate` contract:
  signature, sync-or-async behavior, additive merge semantics, and the `code`-namespacing guidance.

## Testing

- **`validation/hostValidation.test.ts`** (new), using vitest fake timers:
  - sync validator results are applied
  - async validator results are applied
  - rapid `run` calls within `delay` coalesce into a single invocation (debounce)
  - out-of-order async resolutions: only the latest token's result is applied (stale rejection)
  - validator throw and promise rejection both yield `[]` and log a warning
  - `cancel()` prevents a pending invocation from applying
- No changes to `validateWorkflow.test.ts`.
- Hook-level and editor-merge behavior are covered indirectly by the pure orchestrator tests plus the
  dev-app demo (no new DOM test infra introduced).

## Files Touched

**New:**
- `ui/src/validation/hostValidation.ts`
- `ui/src/validation/hostValidation.test.ts`
- `ui/src/hooks/useHostValidation.ts`

**Modified:**
- `ui/src/types/spi.ts` — add `WorkflowValidator` + `EditorSpi.validate`
- `ui/src/index.ts` — export `WorkflowValidator`
- `ui/src/components/WorkflowEditor.tsx` — wire host validation + merge; remove dead prop
- `ui/src/dev/App.tsx` — demo `validate`
- `docs/user-guide/visual-editor.md` — document the SPI validator
- `BACKLOG.md` — mark #23 fixed
