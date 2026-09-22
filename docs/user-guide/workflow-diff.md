# Workflow Diff Viewer

`WorkflowDiffViewer` is a read-only visual comparison of two workflow definitions. It is exported from
`@apitomy/flow-ui` alongside the editor and instance viewer. This page describes the combined branch
behavior, including pending [#134](https://github.com/Apitomy/apitomy-flow/issues/134).

```tsx
import { WorkflowDiffViewer } from '@apitomy/flow-ui';
import type { Workflow } from '@apitomy/flow-ui';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import '@apitomy/flow-ui/style.css';

function Compare({ before, after }: { before: Workflow; after: Workflow }) {
    return (
        <div style={{ height: 700 }}>
            <WorkflowDiffViewer baseWorkflow={before} compareWorkflow={after} theme="light" />
        </div>
    );
}
```

| Prop | Contract |
|---|---|
| `baseWorkflow` | Required before-definition |
| `compareWorkflow` | Required after-definition |
| `theme` | Optional `light` (default) or `dark` |

## Comparison semantics

Nodes and edges match by **ID**. A rename is an addition/removal, not inferred identity. Ordering of the
top-level node/edge arrays does not create semantic changes. Duplicate IDs produce ambiguity warnings;
fix the definition before relying on its diff.

- **Added / removed:** present only on the compare / base side.
- **Changed node:** type, name, or config differs. JSON object key order is ignored recursively; array
  order and primitive types remain significant. A concurrent position edit stays a semantic change.
- **Cosmetic node:** only position differs. Missing, null, and unusable/nonfinite positions count as
  unpositioned; two unpositioned nodes do not differ merely because of absence representation.
- **Changed edge:** source, target, condition, priority, default flag, or label differs.
- **Unchanged:** none of those fields differs.

Workflow name/version label the comparison header; arbitrary workflow/node/edge extension fields outside
the compared fields are not a general JSON diff. Config extension fields do participate in comparison.
These are definition differences, not proof of equivalent execution or a migration for running instances.

## Canvas and details

The combined canvas includes removed entities and prefers compare-side positions, then base positions;
auto-layout fills in when needed. Select a node or edge for field-by-field before/after details. Click the
canvas background to clear selection. The panel is resizable, and pan/zoom remain available.

Props update live; supply fresh values. The component does not mutate either definition or expose editing
callbacks. `WorkflowDiffResult` and related types are exported; the internal `diffWorkflows` function is
not a package-root API.

The [packed consumer and executable checks](../developer-guide/documentation-checks.md) cover rendering,
positionless updates, nested key-order equality, array ordering, and input nonmutation.
