# Installation

## Engine (Java)

Add the engine dependency to your Maven project:

```xml
<dependency>
    <groupId>io.apitomy</groupId>
    <artifactId>apitomy-flow-engine</artifactId>
    <version>${apitomy-flow.version}</version>
</dependency>
```

Set `apitomy-flow.version` to your selected artifact version. These guides describe the combined source
branch, not a guarantee that pending changes are in the latest release. See
[current contracts](../user-guide/current-contracts.md); build/install the branch for its exact behavior.

### Requirements

- Java 21+
- No additional framework dependencies required

The engine is a pure Java library. It works in any Java application — Quarkus, Spring, standalone,
or otherwise.

## Visual Editor (React)

Install the UI component library:

```bash
npm install @apitomy/flow-ui
```

### Peer Dependencies

The visual editor requires:

- React 19+
- React DOM 19+
- [@xyflow/react](https://reactflow.dev/) 12+
- [@patternfly/react-core](https://www.patternfly.org/) 6+
- [@patternfly/react-icons](https://www.patternfly.org/) 6+
- `@patternfly/patternfly` 6+

Import the required CSS in your application entry point:

```typescript
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import '@apitomy/flow-ui/style.css';
```

## Building from Source

```bash
git clone git@github.com:Apitomy/apitomy-flow.git
cd apitomy-flow
./build.sh
```

This builds both the engine (`engine/`) and the UI (`ui/`). See
[Building](../developer-guide/building.md) for details.
