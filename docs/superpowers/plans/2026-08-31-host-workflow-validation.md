# Host-Provided Workflow Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let host apps contribute their own workflow validations via an async-capable `spi.validate` callback whose results merge with the built-in validator and drive the existing editor UI.

**Architecture:** A pure, framework-agnostic debounced orchestrator (`createDebouncedValidator`) owns debounce + async normalization + stale-result rejection and is unit-tested with vitest alone. A thin React hook (`useHostValidation`) wraps it. `WorkflowEditor` merges host problems with built-in problems into the single list that already feeds the Problems panel, node decorations, and `onValidationChange`. The dead `validationProblems` prop is removed (BACKLOG #23).

**Tech Stack:** TypeScript, React 19, `@xyflow/react`, vitest 3.

**Spec:** `docs/superpowers/specs/2026-08-31-host-workflow-validation-design.md`

## Global Constraints

- Host validation is **additive only** — never suppress, override, or reorder built-in problems.
- `spi.validate` may return `ValidationProblem[]` **or** `Promise<ValidationProblem[]>`.
- Built-in validation must remain unchanged and unaffected by host behavior or host errors.
- Debounce delay default: **300ms** (constant `DEFAULT_DELAY`).
- No new test infrastructure (no `@testing-library/react`/jsdom) — testable logic must be pure and runnable under plain vitest.
- Commit message style: Conventional Commits, `feat(ui):` / `docs:` etc. **No Claude attribution in commit messages.**
- Do not run Maven; this is the `ui/` npm package. All commands run from the `ui/` directory unless noted.

---

### Task 1: SPI validator type surface

**Files:**
- Modify: `ui/src/types/spi.ts`
- Modify: `ui/src/index.ts`

**Interfaces:**
- Consumes: `Workflow` (`types/workflow.ts`), `ValidationProblem` (`types/validation.ts`).
- Produces: `type WorkflowValidator = (workflow: Workflow) => ValidationProblem[] | Promise<ValidationProblem[]>` and `EditorSpi.validate?: WorkflowValidator`. Both are consumed by Tasks 2–5.

- [ ] **Step 1: Add the validator type and SPI field**

In `ui/src/types/spi.ts`, add imports at the top and the new type + field:

```ts
import { type Workflow } from './workflow.ts';
import { type ValidationProblem } from './validation.ts';

// ... existing ActionType* declarations unchanged ...

/**
 * A host-provided validator invoked as the user authors a workflow. May run
 * synchronously or return a Promise (e.g. for server-backed checks). Its
 * problems are merged, additively, with the editor's built-in validation.
 *
 * @param workflow the current workflow definition being edited
 * @returns host validation problems, or a Promise resolving to them
 */
export type WorkflowValidator =
  (workflow: Workflow) => ValidationProblem[] | Promise<ValidationProblem[]>;

export interface EditorSpi {
  actionTypes?: ActionTypeProvider;
  /** Optional host-provided additional validation (see {@link WorkflowValidator}). */
  validate?: WorkflowValidator;
}
```

(Replace the existing `EditorSpi` interface with the version above.)

- [ ] **Step 2: Export the new type**

In `ui/src/index.ts`, extend the spi export line:

```ts
export type { EditorSpi, ActionTypeDescriptor, ActionTypeField, ActionTypeProvider, WorkflowValidator } from './types/spi.ts';
```

- [ ] **Step 3: Typecheck**

Run (from `ui/`): `npx tsc -p tsconfig.lib.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/types/spi.ts ui/src/index.ts
git commit -m "feat(ui): add WorkflowValidator SPI type for host validation"
```

---

### Task 2: Pure debounced validation orchestrator

**Files:**
- Create: `ui/src/validation/hostValidation.ts`
- Test: `ui/src/validation/hostValidation.test.ts`

**Interfaces:**
- Consumes: `WorkflowValidator` (Task 1), `Workflow`, `ValidationProblem`.
- Produces:
  - `createDebouncedValidator(opts: DebouncedValidatorOptions): DebouncedValidator`
  - `interface DebouncedValidatorOptions { validate: WorkflowValidator; delay?: number }`
  - `interface DebouncedValidator { run(workflow: Workflow, onResult: (problems: ValidationProblem[]) => void): void; cancel(): void }`
  - `const DEFAULT_DELAY = 300`
  - Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/validation/hostValidation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedValidator } from './hostValidation.ts';
import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';

const wf = (id: string): Workflow => ({ id, name: id, nodes: [], edges: [] });
const problem = (code: string): ValidationProblem => ({ severity: 'warning', code, message: code });

describe('createDebouncedValidator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies a synchronous validator result after the delay', async () => {
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate: () => [problem('A')] });
    v.run(wf('w'), onResult);
    expect(onResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith([problem('A')]);
  });

  it('applies an async validator result', async () => {
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate: async () => [problem('B')] });
    v.run(wf('w'), onResult);
    await vi.advanceTimersByTimeAsync(300);
    expect(onResult).toHaveBeenCalledWith([problem('B')]);
  });

  it('coalesces rapid runs into a single validator invocation', async () => {
    const validate = vi.fn(() => [problem('C')]);
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate });
    v.run(wf('1'), onResult);
    v.run(wf('2'), onResult);
    v.run(wf('3'), onResult);
    await vi.advanceTimersByTimeAsync(300);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(wf('3'));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('drops stale (out-of-order) async results', async () => {
    const resolvers: ((p: ValidationProblem[]) => void)[] = [];
    const validate = vi.fn(() => new Promise<ValidationProblem[]>((res) => resolvers.push(res)));
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate });

    v.run(wf('a'), onResult);
    await vi.advanceTimersByTimeAsync(300); // fires -> token 1, promise[0] pending
    v.run(wf('b'), onResult);
    await vi.advanceTimersByTimeAsync(300); // fires -> token 2, promise[1] pending

    resolvers[0]([problem('STALE')]);       // token 1 result — must be dropped
    resolvers[1]([problem('FRESH')]);       // token 2 result — must be applied
    await Promise.resolve();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith([problem('FRESH')]);
  });

  it('yields [] and warns when the validator throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate: () => { throw new Error('boom'); } });
    v.run(wf('w'), onResult);
    await vi.advanceTimersByTimeAsync(300);
    expect(onResult).toHaveBeenCalledWith([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('yields [] and warns when the async validator rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate: async () => { throw new Error('boom'); } });
    v.run(wf('w'), onResult);
    await vi.advanceTimersByTimeAsync(300);
    expect(onResult).toHaveBeenCalledWith([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('cancel() prevents a pending invocation from applying', async () => {
    const validate = vi.fn(() => [problem('X')]);
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate });
    v.run(wf('w'), onResult);
    v.cancel();
    await vi.advanceTimersByTimeAsync(300);
    expect(validate).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `ui/`): `npx vitest run src/validation/hostValidation.test.ts`
Expected: FAIL — `createDebouncedValidator` is not defined / module not found.

- [ ] **Step 3: Write the implementation**

Create `ui/src/validation/hostValidation.ts`:

```ts
import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { type WorkflowValidator } from '../types/spi.ts';

export const DEFAULT_DELAY = 300;

export interface DebouncedValidatorOptions {
  validate: WorkflowValidator;
  /** Debounce delay in milliseconds (default {@link DEFAULT_DELAY}). */
  delay?: number;
}

export interface DebouncedValidator {
  /** Schedule a (debounced) validation run; `onResult` fires with the latest problems. */
  run(workflow: Workflow, onResult: (problems: ValidationProblem[]) => void): void;
  /** Cancel any pending run and invalidate any in-flight async result. */
  cancel(): void;
}

/**
 * Creates a debounced, async-safe wrapper around a host {@link WorkflowValidator}.
 * Coalesces rapid calls, normalizes sync/async return values, and drops stale
 * (out-of-order) results so only the most recent run is ever applied. Validator
 * failures are swallowed (yield `[]` and warn) so they never affect built-in
 * validation.
 */
export function createDebouncedValidator(opts: DebouncedValidatorOptions): DebouncedValidator {
  const delay = opts.delay ?? DEFAULT_DELAY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latestToken = 0;

  function run(workflow: Workflow, onResult: (problems: ValidationProblem[]) => void): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const token = ++latestToken;
      Promise.resolve()
        .then(() => opts.validate(workflow))
        .then((problems) => {
          if (token === latestToken) onResult(problems);
        })
        .catch((err) => {
          if (token === latestToken) {
            console.warn('Host workflow validation failed:', err);
            onResult([]);
          }
        });
    }, delay);
  }

  function cancel(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    // Invalidate any in-flight promise so its result is ignored.
    latestToken++;
  }

  return { run, cancel };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `ui/`): `npx vitest run src/validation/hostValidation.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/validation/hostValidation.ts ui/src/validation/hostValidation.test.ts
git commit -m "feat(ui): add debounced async-safe host validation orchestrator"
```

---

### Task 3: `useHostValidation` React hook

**Files:**
- Create: `ui/src/hooks/useHostValidation.ts`

**Interfaces:**
- Consumes: `createDebouncedValidator` (Task 2), `WorkflowValidator` (Task 1), `Workflow`, `ValidationProblem`.
- Produces: `useHostValidation(workflow: Workflow, validate: WorkflowValidator | undefined): ValidationProblem[]`. Consumed by Task 4.

> No unit test: the repo has no DOM test infra (`@testing-library/react`/jsdom), and per the spec we add none. The hook is a thin wrapper over the fully-tested Task 2 orchestrator; it is verified by typecheck here and exercised end-to-end via the dev-app demo in Task 5.

- [ ] **Step 1: Write the hook**

Create `ui/src/hooks/useHostValidation.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { type WorkflowValidator } from '../types/spi.ts';
import { createDebouncedValidator } from '../validation/hostValidation.ts';

/**
 * Runs an optional host {@link WorkflowValidator} as the workflow changes,
 * debounced and async-safe, and returns its latest problems. Returns an empty
 * array (and does no work) when no validator is provided.
 *
 * @param workflow the current workflow definition
 * @param validate the host validator, or undefined
 * @returns the latest host validation problems
 */
export function useHostValidation(
  workflow: Workflow,
  validate: WorkflowValidator | undefined,
): ValidationProblem[] {
  const [problems, setProblems] = useState<ValidationProblem[]>([]);

  const validator = useMemo(
    () => (validate ? createDebouncedValidator({ validate }) : undefined),
    [validate],
  );

  useEffect(() => {
    if (!validator) {
      setProblems([]);
      return;
    }
    validator.run(workflow, setProblems);
    return () => validator.cancel();
  }, [validator, workflow]);

  return problems;
}
```

- [ ] **Step 2: Typecheck**

Run (from `ui/`): `npx tsc -p tsconfig.lib.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/hooks/useHostValidation.ts
git commit -m "feat(ui): add useHostValidation hook wrapping the validation orchestrator"
```

---

### Task 4: Wire host validation into `WorkflowEditor` and remove the dead prop

**Files:**
- Modify: `ui/src/components/WorkflowEditor.tsx`

**Interfaces:**
- Consumes: `useHostValidation` (Task 3), `spi?.validate` (Task 1).
- Produces: no new exported symbols. Removes `validationProblems` from `WorkflowEditorProps`. The merged `validationProblems` local continues to feed `ProblemsPanel`, `nodesWithValidation`, and `onValidationChange` (all unchanged).

- [ ] **Step 1: Remove the dead prop from the props interface**

In `ui/src/components/WorkflowEditor.tsx`, delete the `validationProblems?` line from `WorkflowEditorProps` (currently around line 40). The interface becomes:

```ts
export interface WorkflowEditorProps {
  workflow: Workflow;
  onChange: (workflow: Workflow) => void;
  onValidationChange?: (problems: ValidationProblem[]) => void;
  theme?: FlowTheme;
  spi?: EditorSpi;
}
```

- [ ] **Step 2: Import the hook**

Add near the other local imports (after the `validateWorkflow` import, ~line 24):

```ts
import { useHostValidation } from '../hooks/useHostValidation.ts';
```

- [ ] **Step 3: Merge built-in and host problems**

Replace the existing block (currently ~lines 105-108):

```ts
  const validationProblems = useMemo(
    () => validateWorkflow(currentWorkflow),
    [currentWorkflow],
  );
```

with:

```ts
  const builtInProblems = useMemo(
    () => validateWorkflow(currentWorkflow),
    [currentWorkflow],
  );

  const hostProblems = useHostValidation(currentWorkflow, spi?.validate);

  const validationProblems = useMemo(
    () => [...builtInProblems, ...hostProblems],
    [builtInProblems, hostProblems],
  );
```

No other changes are needed: `onValidationChange`, `nodesWithValidation`, and `<ProblemsPanel problems={validationProblems} .../>` already consume the `validationProblems` local.

- [ ] **Step 4: Typecheck and lint**

Run (from `ui/`):
```bash
npx tsc -p tsconfig.lib.json --noEmit
npm run lint
```
Expected: no type errors; no new lint errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/WorkflowEditor.tsx
git commit -m "feat(ui): merge host validation into WorkflowEditor and remove dead validationProblems prop"
```

---

### Task 5: Dev-app demo validator

**Files:**
- Modify: `ui/src/dev/App.tsx`

**Interfaces:**
- Consumes: `EditorSpi.validate` (Task 1), `ValidationProblem` (`types/validation.ts`).
- Produces: nothing exported; a demonstrable host validator wired into the dev app's `spi`.

- [ ] **Step 1: Import `ValidationProblem`**

In `ui/src/dev/App.tsx`, add to the existing type imports:

```ts
import { type ValidationProblem } from '../types/validation.ts';
```

- [ ] **Step 2: Add a `validate` to the demo `spi`**

Inside the `const spi: EditorSpi = { ... }` object, add a `validate` property after `actionTypes`:

```ts
  validate: async (wf): Promise<ValidationProblem[]> => {
    const problems: ValidationProblem[] = [];
    const known = new Set(['send-email', 'http-request', 'lookup-cve', 'create-jira-ticket']);

    // Synchronous host rule: action type must be in the host's catalog.
    for (const node of wf.nodes) {
      if (node.type === 'action') {
        const actionType = node.config.actionType;
        if (typeof actionType === 'string' && actionType.trim() !== '' && !known.has(actionType)) {
          problems.push({
            severity: 'error',
            code: 'HOST_UNKNOWN_ACTION_TYPE',
            message: `Action type "${actionType}" is not in the host catalog`,
            nodeId: node.id,
          });
        }
      }
    }

    // Simulated backend latency to demonstrate the debounced/async path.
    await new Promise((resolve) => setTimeout(resolve, 400));

    if (wf.name && wf.name.length > 40) {
      problems.push({
        severity: 'warning',
        code: 'HOST_NAME_TOO_LONG',
        message: 'Workflow name exceeds the host limit of 40 characters',
      });
    }

    return problems;
  },
```

- [ ] **Step 3: Typecheck**

Run (from `ui/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run (from `ui/`): `npm run dev`, open the Editor tab, and set an action node's Action Type to a value not in the catalog (e.g. `foo`). Confirm a `HOST_UNKNOWN_ACTION_TYPE` error appears in the Problems panel shortly after typing and the node shows an error border; clearing it removes the problem. (The built-in problems still appear instantly.)

- [ ] **Step 5: Commit**

```bash
git add ui/src/dev/App.tsx
git commit -m "feat(ui): demo host validation in the dev app spi"
```

---

### Task 6: Documentation and BACKLOG update

**Files:**
- Modify: `docs/user-guide/visual-editor.md`
- Modify: `BACKLOG.md`

**Interfaces:**
- Consumes: the public API from Tasks 1–4.
- Produces: docs only.

- [ ] **Step 1: Document the SPI validator**

In `docs/user-guide/visual-editor.md`, add a section describing host validation. Wrap prose at 110 characters. Use this content (adjust the surrounding heading level to match the file):

```markdown
## Host-provided validation

In addition to the editor's built-in validation, a host application can contribute its own
validations through the `validate` function on the editor SPI. Problems it returns are merged with
the built-in problems and drive the same Problems panel, per-node error/warning highlighting, and
`onValidationChange` callback.

The validator may run synchronously or return a `Promise`, so it can perform server-backed checks.
The editor debounces calls while the user types and ignores stale (out-of-order) results, so only
the most recent run is ever shown. If the validator throws or rejects, its problems are cleared and
a warning is logged; built-in validation is never affected.

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
`nodeId` / `edgeId`). Namespace your `code` values (for example, prefix them with `HOST_`) to keep
them distinguishable from the built-in codes.
```

- [ ] **Step 2: Mark BACKLOG #23 fixed**

In `BACKLOG.md`, change the status of row 23 from `Open` to `Fixed` (the row that reads
"**`validationProblems` prop silently ignored.**"). Update the status cell only; leave the
description intact.

- [ ] **Step 3: Commit**

```bash
git add docs/user-guide/visual-editor.md BACKLOG.md
git commit -m "docs(ui): document host validation SPI and resolve BACKLOG #23"
```

---

## Self-Review

**Spec coverage:**
- Public API (`WorkflowValidator` + `EditorSpi.validate` + export) → Task 1. ✓
- Pure orchestrator with debounce/async/stale/error handling → Task 2 (+ tests). ✓
- Thin hook → Task 3. ✓
- Editor merge + three consumers unchanged + remove dead prop → Task 4. ✓
- Dev-app demo (sync error rule + async warning) → Task 5. ✓
- Docs + BACKLOG #23 → Task 6. ✓
- `onValidationChange` now emits merged list → satisfied by Task 4 (it consumes the merged `validationProblems`). ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; all code and commands are concrete. ✓

**Type consistency:** `WorkflowValidator`, `createDebouncedValidator`, `DebouncedValidator.run/cancel`, `DEFAULT_DELAY`, and `useHostValidation` signatures are identical everywhere they appear across Tasks 1–5. ✓
