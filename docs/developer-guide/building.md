# Building

## Prerequisites

- Java 21+
- Maven 3.9+
- Node.js 22+

## Full Build

```bash
./build.sh
```

This builds both the engine and the UI in sequence:

1. **Engine**: `mvn clean install` — compiles, runs tests, installs to local Maven repo
2. **UI**: `npm install`, `npm run lint`, `npm run build` — installs deps, lints, builds the library

The script does not run Vitest or Playwright. Run those explicitly as shown below.

The script exits immediately on any failure (`set -euo pipefail`).

## Engine Only

```bash
cd engine
mvn clean install
```

Runs the JUnit 5 suite covering execution, validation, ownership, errors, and event correlation.

## UI Only

```bash
cd ui
npm install
npm run lint       # ESLint with typescript-eslint + react-hooks
npm test           # Vitest pure-logic and shared conformance suites
npx tsc --noEmit    # Application/test source typecheck
npm run build      # TypeScript type checking + Vite library build
```

### UI Dev Server

```bash
cd ui
npm run dev
```

Starts the Vite dev server at **http://localhost:5173** with selectable sample scenarios:

- **Editor** — renders `WorkflowEditor` with drag-and-drop editing
- **Viewer** — renders `WorkflowViewer` with a sample workflow instance
- **Diff** — renders `WorkflowDiffViewer` with before/after definitions

See [Documentation Checks](documentation-checks.md) for focused executable examples, strict MkDocs/link
checks, and the real-browser packed-consumer suite. Test counts come from runner output rather than this
guide.

## Project Structure

```
apitomy-flow/
  build.sh                     Full build script
  serve-docs.sh                Local MkDocs server
  engine/                      Java workflow engine
    pom.xml
    src/main/java/             Source code
    src/test/java/             JUnit 5 tests
  ui/                          React visual editor
    package.json
    vite.config.ts
    eslint.config.js
    src/                       Source code
    src/validation/*.test.ts   Vitest tests
  docs/                        MkDocs documentation
  .github/workflows/           CI/CD pipelines
```
