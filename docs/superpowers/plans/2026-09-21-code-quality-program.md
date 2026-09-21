# Code-quality program implementation plan

> **For agentic workers:** Use subagent-driven-development with concurrent isolated worktrees, as
> explicitly requested by the user. Each issue remains an independently reviewed task and pull request.

**Goal:** Resolve C1–C14 (#124–#137) in fourteen verified, issue-specific pull requests.

**Architecture:** Independent workstreams converge through documented stacked branch dependencies.
Preserve wire compatibility; strengthen execution invariants and data boundaries before broad refactors.

**Tech Stack:** Java 21/Maven, React 19/TypeScript/Vite/Vitest, Playwright browser tests.

**Spec:** `docs/superpowers/specs/2026-09-21-code-quality-program-design.md`

## Global constraints

- Java 21 source compatibility; public methods have Javadoc/docstrings.
- Preserve current JSON field names and host extension fields.
- Four-space indentation in new code; follow surrounding style for localized edits.
- Markdown wraps at 110 characters except structured content.
- Use `gh` for GitHub operations. No force pushes, automatic merges, or attribution footers.
- Each issue has its own worktree, branch, regression evidence, and commit(s).
- Workers commit only their assigned changes; controller reviews and publishes PRs.

## Task protocol

Read the full assigned issue with `gh issue view NUMBER --json title,body`. Reproduce the specified
failure in a focused test, run that test to demonstrate failure, implement the smallest coherent fix,
then run its suite and required checks. Inspect `git status`, `git diff`, and `git log --oneline -10`
before staging intended files and committing. Return SHA, exact commands/results, and scope decisions.

### Task 1: C1 / #124 — runnable branch invariants

Files: `engine/.../engine/WorkflowEngine.java`, `WorkflowEngineParallelTest.java`.
- [ ] Reproduce retry of pending action with unanswered human sibling; assert `WAITING`, open history.
- [ ] Filter runnable continuations on all retry, transition, and edge-error queue rebuilds.
- [ ] Run `mvn test`, review, commit on `fix/c1-124-parked-siblings`.

### Task 2: C2 / #125 — join topology

Files: Java `ParallelRegions.java`, TypeScript `parallelRegions.ts`, validators and parallel tests.
- [ ] Reproduce mutually exclusive incoming join edges and outside-region arrivals.
- [ ] Reject unsupported topology before executor side effects; preserve nested balanced regions.
- [ ] Mirror rule codes and fixtures; run Maven, Vitest, typecheck, lint, build; review and commit.

### Task 3: C3 / #126 — iterative recovery

Files: `WorkflowEngine.java`, engine error/parallel tests. Base: C1.
- [ ] Demonstrate self-transition and two-action recovery cycles exceed the execution budget.
- [ ] Queue recovery entry instead of recursion and count it in the shared execution budget.
- [ ] Preserve blocking recovery targets and sibling state; run Maven tests; review and commit.

### Task 4: C4 / #127 — completion contracts

Files: `WorkflowEngine.java`, async action/event/info tests. Base: C3.
- [ ] Reproduce omitted required async output and inactive future event matching.
- [ ] Share completion validation and active-node eligibility without changing info null/false contracts.
- [ ] Exercise pending siblings and wrong-type nodes; run Maven tests; review and commit.

### Task 5: C5 / #128 — JSON boundaries

Files: `workflowIo.ts`, `validateWorkflow.ts`, Java validator, focused boundary tests.
- [ ] Test numeric literal input, unknown node type, missing endpoints, null entries, invalid collections.
- [ ] Normalize from unknown and report structured errors before semantic traversal/property rendering.
- [ ] Keep positionless layout and host extensions; run both suites and UI checks; review and commit.

### Task 6: C6 / #129 — conformance

Files: shared `conformance/` JSON fixtures, both test suites, evaluator/simulator. Base: C5 plus C2.
- [ ] Execute identical expression, validation, routing, and serialization examples in both runtimes.
- [ ] Fix malformed exponent acceptance, edge-condition checks, and transition-budget drift.
- [ ] Document engine-only expression support explicitly; run all checks; review and commit.

### Task 7: C7 / #130 — immutable ownership

Files: Java model records and JSON snapshot helper, model/executor tests.
- [ ] Mutate nested original inputs and returned collections to demonstrate aliasing.
- [ ] Snapshot map/list/tree data at constructors and executor/listener boundaries; preserve nulls.
- [ ] Cover direct construction and Jackson round trips; run Maven tests; review and commit.

### Task 8: C8 / #131 — typed contracts

Files: TS workflow types, Java config adapters, shared schema, public exports. Base: C5/C7/C6.
- [ ] Introduce discriminated configs and recursive JSON values with host extension support.
- [ ] Replace unchecked built-in config interpretation with typed adapters, preserving wire shapes.
- [ ] Export config types; test schema/examples and consumers; run both suites/UI checks; commit.

### Task 9: C9 / #132 — editor transactions

Files: editor reducer/hooks, `WorkflowEditor.tsx`, history tests.
- [ ] Test atomic node/edge edits, property history, metadata import undo, and layout redo.
- [ ] Centralize transactions; scope shortcuts; gate mutations while simulating.
- [ ] Preserve ReactFlow presentation state separately; run UI checks; review and commit.

### Task 10: C10 / #133 — browser and consumer tests

Files: Playwright config/scenarios, consumer fixture, package scripts, verify workflow. Base: C9/C11.
- [ ] Exercise real editor delete/undo/import/layout, multi-editor scoping, and draft selection.
- [ ] Exercise live viewer/diff rendering and asynchronous host interactions.
- [ ] Pack/build the actual package and render a consumer with styles; run in CI; review and commit.

### Task 11: C11 / #134 — semantic diffs

Files: `workflowDiff.ts`, `workflowDiffFieldComparisons.ts`, tests and shared JSON equality helper.
- [ ] Demonstrate key-order false positives and omitted/null/nonfinite coordinate failures.
- [ ] Compare objects semantically and arrays in order; distinguish layout-only cosmetic changes.
- [ ] Run UI suite/typecheck/lint/build; review and commit.

### Task 12: C12 / #135 — structured failures

Files: engine errors, executor registry/SPI docs and tests. Base: C4.
- [ ] Preserve missing-output and input-expression diagnostic details through errors and final state.
- [ ] Reject duplicate executors and malformed extension responses deterministically.
- [ ] Document callback/null/side-effect semantics; run Maven tests; review and commit.

### Task 13: C13 / #136 — targeted extraction and indexing

Files: engine graph/index/execution helpers, editor forms and semantic validation cache. Base: prior code.
- [ ] Establish repeatable large graph/history benchmarks.
- [ ] Extract single-purpose units and index immutable graph adjacency without stale caching.
- [ ] Prevent selection/layout-only validation reruns; run combined checks; review and commit.

### Task 14: C14 / #137 — documentation reconciliation

Files: README, BACKLOG, architecture/user/developer guides and executable examples. Base: final integration.
- [ ] Verify every documented behavior against the resulting code and current issue status.
- [ ] Explain expression subset, async/parallel usage, immutability, and compatibility decisions.
- [ ] Replace stale rule counts/manual status with linked authoritative references; verify docs and commit.

## Integration and publication

- [ ] Review each task against its issue and inspect its complete base-to-head diff.
- [ ] Integrate on a temporary branch and run Maven, Vitest, typecheck, lint, build, browser, and docs checks.
- [ ] Publish each issue branch and create one PR with `Closes #NUMBER`, verification, and dependencies.
- [ ] Verify all fourteen PRs and report URLs, ordering, and any outstanding CI limitations.
