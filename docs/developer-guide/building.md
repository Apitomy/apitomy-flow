# Building

## Prerequisites

- Java 25+
- Maven 3.9+
- Node.js 22+

## Full Build

```bash
./build.sh
```

This builds both the engine and the UI in sequence:

1. **Engine**: `mvn clean install` — compiles, runs tests, installs to local Maven repo
2. **UI**: `npm install`, `npm run lint`, `npm run build` — installs deps, lints, runs vitest, builds the library

The script exits immediately on any failure (`set -euo pipefail`).

## Engine Only

```bash
cd engine
mvn clean install
```

Runs all 76 JUnit 5 tests covering workflow execution, validation, error handling, and event correlation.

## UI Only

```bash
cd ui
npm install
npm run lint       # ESLint with typescript-eslint + react-hooks
npm test           # Vitest — 17 validation module tests
npm run build      # TypeScript type checking + Vite library build
```

### UI Dev Server

```bash
cd ui
npm run dev
```

Starts the Vite dev server at **http://localhost:5173** with a sample CVE triage workflow. The dev app has two tabs:

- **Editor** — renders `WorkflowEditor` with drag-and-drop editing
- **Viewer** — renders `WorkflowViewer` with a sample workflow instance

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
