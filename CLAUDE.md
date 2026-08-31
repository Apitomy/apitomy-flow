# Apitomy Flow

`@apitomy/flow-ui` — an embeddable React component library for authoring (`WorkflowEditor`) and
visualizing (`WorkflowViewer`) Apitomy workflow definitions. The library source lives under `ui/`.

## Tech Stack

- TypeScript + React 19
- `@xyflow/react` (React Flow v12) for the node/edge canvas
- Vite for the dev app and library build
- vitest for tests (no `@testing-library/react` / jsdom — testable logic is kept pure)

## Build & Test

All commands run from the `ui/` directory:

- Dev app: `npm run dev` (served at <http://localhost:5173/>)
- Tests: `npm test` (`vitest run`) or `npx vitest run <path>` for a single file
- Typecheck: `npx tsc --noEmit`
- Lint: `npm run lint`
- Build: `npm run build`

## Testing Expectations For AI Agents

AI agents MUST run the relevant tests and typecheck to validate their work before considering a task
complete. When you add or change behavior, run `npx vitest run` for the affected tests and
`npx tsc --noEmit` to confirm the change compiles. Do not report work as done on unverified code.
