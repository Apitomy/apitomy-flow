# Code-quality program design

The user approved this design on September 21, 2026: implement C1–C14 as fourteen separate pull requests,
using concurrent isolated worktrees and stacked branches for dependent changes.

## Scope and architecture

GitHub issues #124–#137 define the acceptance criteria, in C1–C14 order. Preserve the current JSON wire
format and public APIs where possible, with explicit documentation of necessary stricter validation.
Independent execution, validation, immutable-model, editor, and diff work proceeds concurrently.

- Execution: preserve parked branches, reject unsupported joins before side effects, queue recovery
  iteratively under one budget, and unify completion eligibility/required-output checks.
- Data: normalize untrusted JSON, snapshot JSON ownership, introduce typed config adapters, and execute
  common Java/TypeScript conformance fixtures.
- UI: use atomic document transactions for undo/redo and scoped interaction, with real-browser tests.
- Maintenance: structured failures, indexed graph analysis, focused components, and accurate docs.

## Isolation and integration

Each issue owns a branch and `.worktrees/cN` directory. Engine recovery changes stack C3 on C1 and C4
on C3; C12 builds on that execution stack. C6 builds on C5, C8 combines stable model/boundary work,
and C10 builds on C9. C11 is independent. C13 integrates prior fixes for targeted extraction and
benchmarks. C14 documents the final combined contract. Dependency bases are recorded in every PR.

## Compatibility decisions

- C2 may reject unsupported conditional join shapes rather than introduce a new persisted token model.
- Java configuration adapters retain legacy map serialization and extension fields.
- Browser expression support is explicitly delimited; valid engine-only syntax must not be mislabeled
  as malformed syntax without a documented distinction.
- Real-browser testing uses Playwright rather than adding jsdom to pure Vitest tests.
- Recovered failures retain their causes without requiring hosts to implement a replacement SPI.

## Verification

Every behavioral issue gets a failing regression before its fix. Run Maven tests for engine changes;
run relevant Vitest tests, `npx tsc --noEmit`, lint, and build for UI changes. Browser scenarios and
consumer package smoke tests execute for C10. Independent review checks issue scope and correctness.
A temporary integration branch verifies the combined result before handoff. No PR is automatically merged.
