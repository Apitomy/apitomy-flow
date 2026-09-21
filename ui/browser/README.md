# Real-browser contracts

Run from `ui/`:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

Linux CI uses `npx playwright install --with-deps chromium`. To use an existing compatible Chromium,
set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable. The default is Playwright's pinned Chromium.
The dedicated `ui-browser` Verify job runs the full command separately from the fast Vitest suite.

`test:browser` builds the library, packs it with npm, installs the tarball into `consumer/`, validates
the peer dependency tree, typechecks and builds the consumer, typechecks the browser harness, and runs
Playwright. The fixture has its own lockfile and local dependencies. Its library install is deliberately
`--no-save --package-lock=false`, so every run tests the current tarball without committing generated
artifact hashes or using source aliases. Declarations are checked with `skipLibCheck: false`.

The source host uses React StrictMode and the actual editor, ReactFlow, PatternFly, viewer and diff.
Assertions read rendered controls and public callback payloads. Tests fail on page exceptions or console
errors, including React lifecycle warnings reported as errors. Async providers are ordinary host SPI
implementations whose promises are settled by host buttons. The late-import test gates only `onload`
delivery after a real FileReader read; it does not replace parsing or editor behavior.

Coverage includes atomic deletion and immediate focus-owned undo, metadata import, field coalescing,
individual checkbox/select/button history, tidy and single/group drag transactions, keyboard movement,
two-editor isolation, native text/select shortcuts, simulation/manual lock, delayed import, stable draft
rows/caret/literals, reset on history/import/selection, async failure/stale results, live loop/parallel
history, positionless viewer/diff updates, and an interactive built-package consumer with CSS.

The editor graph is mount-initialized. Parent metadata changes apply to the current graph; replacing the
`workflow` prop does not replace an in-progress graph. The host uses a React `key` to remount when it
needs full replacement. These tests preserve that existing contract rather than imposing F9's proposed
controlled-document API.

For iteration after preparing the consumer, run `npx playwright test` or a specific `browser/*.spec.ts`.
Ports 4173 and 4174 must be free; existing servers are not reused. Failure traces/screenshots and the HTML
report are written to ignored `test-results/` and `playwright-report/` directories. Use
`npx playwright show-report` to inspect them. Tests do not retry, so failures cannot silently pass on retry.

Scope: Chromium only; no jsdom, network service, or optional Monaco host integration is required. Focus
coverage checks toolbar keyboard navigation, native controls, unique simulation switch IDs, and deletion
handoff. It is not a full accessibility audit: legacy property labels still lack programmatic control
associations, so the shared field locator follows their visible label/container structure.
