# Documentation checks and executable examples

Examples below reuse checked-in tests/fixtures rather than copied pseudo-programs. Run commands from the
repository root unless the block explicitly changes directory. Runner output is the authority for counts.

## Java examples

`engine/src/test/java/io/apitomy/flow/engine/AsyncActionNodeTest.java` exercises partial PENDING output,
completion by node ID, required declared output names, aliases, recovery, and parked-sibling preservation.
Its workflow builders live in that class and `engine/src/test/java/io/apitomy/flow/TestWorkflows.java`.

`ConformanceTest` consumes `conformance/routing.json`, including parallel resumes with a JSON round trip
before each completion. `ParallelTopologyTest` covers conditional choices inside structured regions.
`WorkflowEngineStructuredErrorTest` demonstrates the structured/legacy handler boundary.
`JsonOwnershipTest` and `NodeConfigTest` exercise snapshot isolation and typed Java configuration.

```sh
cd engine
mvn -Dtest=AsyncActionNodeTest,ConformanceTest,ParallelTopologyTest,WorkflowEngineStructuredErrorTest,JsonOwnershipTest,NodeConfigTest test
```

For a full start-to-finish application-style example, read
`engine/src/test/java/io/apitomy/flow/engine/LoanApprovalEndToEndTest.java`.

## Shared JSON and TypeScript examples

The [`conformance` corpus](https://github.com/Apitomy/apitomy-flow/tree/main/conformance) is read by Java
and TypeScript, including expression classification, routing, mappings, budgets, topology, and wire schema.
Select this branch when inspecting pending changes. `conformance/README.md` records intentional differences.

The actual v1 configuration fixture (not a second copy) is included here:

```json
--8<-- "conformance/config-v1.json"
```

MkDocs resolves this include from the repository root and fails if its path disappears. Vitest executes
the schema with Ajv; `workflow.contract.test.ts` also contains compile-time authoring assertions.

```sh
cd ui
npx vitest run src/simulation/conformance.test.ts src/simulation/parallelTopology.test.ts src/types/schema.contract.test.ts src/types/workflow.contract.test.ts src/diff/workflowDiffSemantics.test.ts
npx tsc --noEmit
```

These cover shared behavior, not universal Java/browser equivalence. See
[simulation limits](../user-guide/visual-editor.md#simulation-and-condition-testing),
[typed migration](../user-guide/typed-configuration.md), and [diff semantics](../user-guide/workflow-diff.md).

## Browser verification

The executable package-consumer example is `ui/browser/consumer/main.tsx`: it imports the editor, viewer,
diff viewer, public types, and CSS from an actual npm tarball, not source aliases. `ui/browser/README.md`
describes the harness and coverage in detail.

```sh
cd ui
npm ci
npx playwright install chromium
npm run test:browser
```

Linux CI installs browser OS dependencies with `npx playwright install --with-deps chromium`. To use a
compatible local Chrome, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Ports 4173 and 4174 must be available.
The command builds/packs the library, installs and builds the consumer, checks declarations and browser
types, then runs Chromium tests. Trace/screenshot/HTML reports go to ignored test output directories.

Rendered tests cover focus-owned undo/delete, drag transactions, drafts, async SPI results/imports, live
loop/parallel history, positionless diff/viewer updates, and consumer CSS. They fail on browser exceptions
and console errors. This is Chromium verification, not universal browser or full accessibility coverage.
No application code changes are needed merely to run these existing examples.

## Documentation build and links

The repository's `serve-docs.sh` uses MkDocs and Material; install them in your preferred Python environment:

```sh
python3 -m pip install mkdocs mkdocs-material
mkdocs build --strict
```

`mkdocs.yml` includes the current contracts, typed configuration, diff, errors, indexed architecture, and
this page in navigation. Strict link checks cover published guide targets and anchors; archived design
plans remain historical and outside navigation. Also check repository-relative README/BACKLOG links and
Markdown wrapping when editing them. Public prose is wrapped at 110 columns; tables, URLs, and executable
structured content may exceed that limit.
