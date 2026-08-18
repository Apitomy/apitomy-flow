# Contributing

See [CONTRIBUTING.md](https://github.com/Apitomy/apitomy-flow/blob/main/CONTRIBUTING.md) for the full contribution guide.

## Quick Reference

### Prerequisites

- Java 25+
- Maven 3.9+
- Node.js 22+

### Build and Test

```bash
# Full build
./build.sh

# Engine tests
cd engine && mvn test

# UI lint + tests
cd ui && npm run lint && npm test
```

### Coding Standards

**Engine (Java):**

- Pure Java library — no framework dependencies
- Records for immutable data types
- All engine methods return new state (never mutate input)
- JUnit 5 for tests

**UI (React/TypeScript):**

- Named exports, `function` declarations
- TypeScript strict mode
- Plain CSS with PatternFly CSS variables
- ESLint with `typescript-eslint` + `react-hooks`
- Vitest for tests

### CI Checks

All PRs must pass:

- **Engine Build + Test** — `mvn clean install`
- **UI Lint + Build + Test** — `npm run lint`, `npm test`, `npm run build`
