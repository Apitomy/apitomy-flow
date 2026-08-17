# Apitomy Flow Visual Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React component library exporting `WorkflowEditor` (drag-and-drop workflow builder with live validation) and `WorkflowViewer` (read-only instance visualization) for the apitomy-flow workflow engine.

**Architecture:** A Vite-based React component library in `ui/`. Exports two top-level components that consuming applications (starting with Axiom) import and render. Uses `@xyflow/react` for the canvas, PatternFly 6 for UI chrome, and a TypeScript port of the Java validator for real-time validation feedback. A dev app provides visual testing during development.

**Tech Stack:** React 19, TypeScript 5.9, Vite 6.4, @xyflow/react 12.x, PatternFly 6 (@patternfly/react-core, @patternfly/react-icons), @apitomy/common-ui-components

**Spec:** `docs/superpowers/specs/2026-08-17-apitomy-flow-design.md` (Visual Editor section)

## Global Constraints

- **Package name:** `@apitomy/flow-ui`
- **React:** 19, **TypeScript:** 5.9, **Vite:** 6.4
- **Component style:** Named exports, `function` keyword declarations (not arrow-const), no default exports — matches axiom UI conventions
- **CSS:** Plain `.css` files co-located with components, PatternFly CSS variables for colors — no CSS modules
- **Imports:** Relative paths only, no path aliases. Use `type` imports for type-only (`import { type Workflow }`)
- **Strict TypeScript:** `strict: true`, `noUnusedLocals`, `noUnusedParameters`
- **Testing:** Vitest for validation logic. Visual components tested manually via dev app (`npm run dev`)
- **Do NOT include the `Co-Authored-By` attribution line in git commit messages**

---

## File Map

```
ui/
  package.json
  tsconfig.json
  tsconfig.lib.json
  vite.config.ts
  index.html                          (dev app entry)
  src/
    index.ts                          (public library exports)
    types/
      workflow.ts                     (Workflow, WorkflowNode, WorkflowEdge, NodeType, WorkflowInput)
      instance.ts                     (WorkflowInstance, InstanceStatus, HistoryEntry)
      validation.ts                   (ValidationProblem, ValidationSeverity)
    utils/
      id.ts                           (ID generation for new nodes/edges)
      conversion.ts                   (Workflow model ↔ React Flow model adapters)
    components/
      nodes/
        StartNode.tsx                 (start node with input icon)
        StartNode.css
        EndNode.tsx                   (end/terminal node)
        EndNode.css
        ActionNode.tsx                (action node with gear icon)
        ActionNode.css
        HumanTaskNode.tsx             (human task with user icon)
        HumanTaskNode.css
        ReceiveEventNode.tsx          (event receiver with signal icon)
        ReceiveEventNode.css
        nodeTypes.ts                  (React Flow nodeTypes registry)
      edges/
        ConditionalEdge.tsx           (edge with condition badge)
        ConditionalEdge.css
        edgeTypes.ts                  (React Flow edgeTypes registry)
      panels/
        NodePalette.tsx               (draggable node type list)
        NodePalette.css
        PropertiesPanel.tsx           (node/edge config form)
        PropertiesPanel.css
        ProblemsPanel.tsx             (validation problems list)
        ProblemsPanel.css
      WorkflowEditor.tsx              (top-level editor)
      WorkflowEditor.css
      WorkflowViewer.tsx              (top-level viewer)
      WorkflowViewer.css
    validation/
      validateWorkflow.ts             (TypeScript validator — 23 rules)
      validateWorkflow.test.ts        (Vitest unit tests)
    dev/
      App.tsx                         (dev app for visual testing)
      App.css
      sampleWorkflows.ts              (sample data for dev testing)
```

---

### Task 1: Project Scaffolding + TypeScript Types + Dev App Shell

**Files:**
- Create: `ui/package.json`
- Create: `ui/tsconfig.json`
- Create: `ui/tsconfig.lib.json`
- Create: `ui/vite.config.ts`
- Create: `ui/index.html`
- Create: `ui/src/index.ts`
- Create: `ui/src/types/workflow.ts`
- Create: `ui/src/types/instance.ts`
- Create: `ui/src/types/validation.ts`
- Create: `ui/src/utils/id.ts`
- Create: `ui/src/dev/App.tsx`
- Create: `ui/src/dev/App.css`
- Create: `ui/src/dev/sampleWorkflows.ts`

**Interfaces:**
- Consumes: Nothing (first task)
- Produces: All TypeScript types, utility functions, and a running dev app that subsequent tasks render into

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@apitomy/flow-ui",
  "version": "1.0.0-SNAPSHOT",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.lib.json && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@patternfly/patternfly": "^6.0.0",
    "@patternfly/react-core": "^6.0.0",
    "@patternfly/react-icons": "^6.0.0",
    "@xyflow/react": "^12.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.7.0",
    "typescript": "~5.9.0",
    "vite": "^6.4.0",
    "vitest": "^3.0.0"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./style.css": "./dist/style.css"
  },
  "files": ["dist"]
}
```

- [ ] **Step 2: Create tsconfig.json (dev — includes dev app)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Create `tsconfig.lib.json` (library build — excludes dev app and tests):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationDir": "./dist",
    "emitDeclarationOnly": true
  },
  "include": ["src"],
  "exclude": ["src/dev", "src/**/*.test.ts", "src/**/*.test.tsx"]
}
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime',
        '@xyflow/react', '@patternfly/react-core', '@patternfly/react-icons',
        '@patternfly/patternfly'],
    },
  },
});
```

- [ ] **Step 4: Create index.html (dev app entry)**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Apitomy Flow — Dev</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/dev/App.tsx"></script>
</body>
</html>
```

- [ ] **Step 5: Create TypeScript types**

`ui/src/types/workflow.ts`:
```typescript
export type NodeType = 'start' | 'end' | 'action' | 'human-task' | 'receive-event';

export interface WorkflowInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required: boolean;
  description?: string;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, any>;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
  priority: number;
  isDefault: boolean;
  label?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}
```

`ui/src/types/instance.ts`:
```typescript
export type InstanceStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export interface HistoryEntry {
  nodeId: string;
  nodeName: string;
  edgeId?: string;
  edgeCondition?: string;
  enteredOn: string;
  completedOn?: string;
  output?: Record<string, any>;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  currentNodeId: string;
  status: InstanceStatus;
  context: Record<string, any>;
  history: HistoryEntry[];
  failureReason?: string;
  createdOn: string;
  updatedOn: string;
}
```

`ui/src/types/validation.ts`:
```typescript
export type ValidationSeverity = 'error' | 'warning';

export interface ValidationProblem {
  severity: ValidationSeverity;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}
```

- [ ] **Step 6: Create utility files**

`ui/src/utils/id.ts`:
```typescript
let counter = 0;

export function generateNodeId(type: string): string {
  return `${type}-${Date.now()}-${++counter}`;
}

export function generateEdgeId(source: string, target: string): string {
  return `e-${source}-${target}-${Date.now()}-${++counter}`;
}
```

`ui/src/utils/conversion.ts`:
```typescript
import { type Node, type Edge } from '@xyflow/react';
import { type WorkflowNode, type WorkflowEdge, type Workflow } from '../types/workflow.ts';

export interface FlowNodeData {
  name: string;
  nodeType: WorkflowNode['type'];
  config: Record<string, any>;
}

export function toReactFlowNodes(nodes: WorkflowNode[]): Node<FlowNodeData>[] {
  return nodes.map(node => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: {
      name: node.name,
      nodeType: node.type,
      config: node.config,
    },
  }));
}

export function toReactFlowEdges(edges: WorkflowEdge[]): Edge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'conditional',
    data: {
      condition: edge.condition,
      priority: edge.priority,
      isDefault: edge.isDefault,
      label: edge.label,
    },
  }));
}

export function toWorkflowNodes(nodes: Node<FlowNodeData>[]): WorkflowNode[] {
  return nodes.map(node => ({
    id: node.id,
    type: node.data.nodeType,
    name: node.data.name,
    config: node.data.config,
    position: node.position,
  }));
}

export function toWorkflowEdges(edges: Edge[]): WorkflowEdge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    condition: edge.data?.condition,
    priority: edge.data?.priority ?? 0,
    isDefault: edge.data?.isDefault ?? false,
    label: edge.data?.label,
  }));
}

export function toWorkflow(id: string, name: string, nodes: Node<FlowNodeData>[], edges: Edge[]): Workflow {
  return {
    id,
    name,
    nodes: toWorkflowNodes(nodes),
    edges: toWorkflowEdges(edges),
  };
}
```

- [ ] **Step 7: Create library index.ts (public exports)**

`ui/src/index.ts`:
```typescript
export type { Workflow, WorkflowNode, WorkflowEdge, NodeType, WorkflowInput } from './types/workflow.ts';
export type { WorkflowInstance, InstanceStatus, HistoryEntry } from './types/instance.ts';
export type { ValidationProblem, ValidationSeverity } from './types/validation.ts';
```

Components will be added to exports in later tasks.

- [ ] **Step 8: Create sample data and dev app**

`ui/src/dev/sampleWorkflows.ts`:
```typescript
import { type Workflow } from '../types/workflow.ts';
import { type WorkflowInstance } from '../types/instance.ts';

export const cveTriage: Workflow = {
  id: 'cve-triage',
  name: 'CVE Triage',
  description: 'Analyze and triage CVE vulnerabilities',
  nodes: [
    { id: 'start', type: 'start', name: 'Start', config: { inputs: [{ name: 'cveId', type: 'string', required: true }] }, position: { x: 50, y: 200 } },
    { id: 'analyze', type: 'action', name: 'Analyze CVE', config: { actionType: 'analyze-cve' }, position: { x: 250, y: 200 } },
    { id: 'triage', type: 'human-task', name: 'Triage Decision', config: { title: 'Is this CVE affected?' }, position: { x: 500, y: 200 } },
    { id: 'mitigate', type: 'action', name: 'Plan Mitigation', config: { actionType: 'plan-mitigation' }, position: { x: 750, y: 100 } },
    { id: 'close', type: 'action', name: 'Close Tracker', config: { actionType: 'close-tracker' }, position: { x: 750, y: 300 } },
    { id: 'end-mitigated', type: 'end', name: 'Mitigated', config: { outcome: 'mitigated' }, position: { x: 1000, y: 100 } },
    { id: 'end-not-affected', type: 'end', name: 'Not Affected', config: { outcome: 'not-affected' }, position: { x: 1000, y: 300 } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'analyze', priority: 0, isDefault: false },
    { id: 'e2', source: 'analyze', target: 'triage', priority: 0, isDefault: false },
    { id: 'e3', source: 'triage', target: 'mitigate', condition: "context.affected == true", priority: 1, isDefault: false, label: 'Affected' },
    { id: 'e4', source: 'triage', target: 'close', priority: 2, isDefault: true, label: 'Not Affected' },
    { id: 'e5', source: 'mitigate', target: 'end-mitigated', priority: 0, isDefault: false },
    { id: 'e6', source: 'close', target: 'end-not-affected', priority: 0, isDefault: false },
  ],
};

export const triageInstance: WorkflowInstance = {
  id: 'inst-1',
  workflowId: 'cve-triage',
  currentNodeId: 'triage',
  status: 'waiting',
  context: { cveId: 'CVE-2024-1234', severity: 'high' },
  history: [
    { nodeId: 'start', nodeName: 'Start', enteredOn: '2024-01-01T00:00:00Z', completedOn: '2024-01-01T00:00:00Z' },
    { nodeId: 'analyze', nodeName: 'Analyze CVE', edgeId: 'e1', enteredOn: '2024-01-01T00:00:01Z', completedOn: '2024-01-01T00:00:05Z', output: { severity: 'high' } },
    { nodeId: 'triage', nodeName: 'Triage Decision', edgeId: 'e2', enteredOn: '2024-01-01T00:00:05Z' },
  ],
  createdOn: '2024-01-01T00:00:00Z',
  updatedOn: '2024-01-01T00:00:05Z',
};

export const emptyWorkflow: Workflow = {
  id: 'new',
  name: 'New Workflow',
  nodes: [],
  edges: [],
};
```

`ui/src/dev/App.css`:
```css
.dev-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.dev-app__tabs {
  padding: 8px 16px;
  background: var(--pf-t--global--background--color--secondary--default, #f0f0f0);
  border-bottom: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
}
.dev-app__tabs button {
  margin-right: 8px;
  padding: 6px 12px;
  cursor: pointer;
}
.dev-app__tabs button.active {
  font-weight: bold;
  border-bottom: 2px solid var(--pf-t--global--color--brand--default, #06c);
}
.dev-app__content {
  flex: 1;
  overflow: hidden;
}
```

`ui/src/dev/App.tsx`:
```typescript
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import './App.css';

function App() {
  const [tab, setTab] = useState<'editor' | 'viewer'>('editor');

  return (
    <div className="dev-app">
      <div className="dev-app__tabs">
        <button className={tab === 'editor' ? 'active' : ''} onClick={() => setTab('editor')}>
          Editor
        </button>
        <button className={tab === 'viewer' ? 'active' : ''} onClick={() => setTab('viewer')}>
          Viewer
        </button>
      </div>
      <div className="dev-app__content">
        {tab === 'editor' && <div style={{ padding: 20 }}>WorkflowEditor will render here (Task 3)</div>}
        {tab === 'viewer' && <div style={{ padding: 20 }}>WorkflowViewer will render here (Task 7)</div>}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

- [ ] **Step 9: Install dependencies and verify dev app runs**

Run:
```bash
cd ui && npm install && npm run dev
```
Expected: Dev server starts, page loads with tab UI at localhost:5173

- [ ] **Step 10: Verify TypeScript compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 11: Commit**

```bash
git add ui/
git commit -m "feat(ui): scaffold project with TypeScript types and dev app"
```

---

### Task 2: Custom Node and Edge Components

**Files:**
- Create: `ui/src/components/nodes/StartNode.tsx`, `StartNode.css`
- Create: `ui/src/components/nodes/EndNode.tsx`, `EndNode.css`
- Create: `ui/src/components/nodes/ActionNode.tsx`, `ActionNode.css`
- Create: `ui/src/components/nodes/HumanTaskNode.tsx`, `HumanTaskNode.css`
- Create: `ui/src/components/nodes/ReceiveEventNode.tsx`, `ReceiveEventNode.css`
- Create: `ui/src/components/nodes/nodeTypes.ts`
- Create: `ui/src/components/edges/ConditionalEdge.tsx`, `ConditionalEdge.css`
- Create: `ui/src/components/edges/edgeTypes.ts`

**Interfaces:**
- Consumes: `FlowNodeData` from `utils/conversion.ts` (Task 1)
- Produces: `nodeTypes` registry object, `edgeTypes` registry object — used by WorkflowEditor (Task 3) and WorkflowViewer (Task 7)

Each node type has a distinct visual style: unique icon, color, and shape. Nodes show validation state via CSS classes passed in data.

- [ ] **Step 1: Create the base node CSS pattern**

Each node component follows this pattern: a rounded container with an icon, label, and handles. Validation state is shown via border color.

`ui/src/components/nodes/StartNode.css`:
```css
.flow-node-start {
  padding: 10px 20px;
  border-radius: 20px;
  background: var(--pf-t--global--color--status--success--default, #3e8635);
  color: white;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  min-width: 100px;
  justify-content: center;
}
.flow-node-start.has-error { border-color: var(--pf-t--global--color--status--danger--default, #c9190b); }
.flow-node-start.has-warning { border-color: var(--pf-t--global--color--status--warning--default, #f0ab00); }
.flow-node-start.selected { box-shadow: 0 0 0 2px var(--pf-t--global--color--brand--default, #06c); }
```

- [ ] **Step 2: Create StartNode component**

`ui/src/components/nodes/StartNode.tsx`:
```typescript
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PlayIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './StartNode.css';

export function StartNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const validationClass = nodeData.validationSeverity === 'error' ? 'has-error'
    : nodeData.validationSeverity === 'warning' ? 'has-warning' : '';

  return (
    <div className={`flow-node-start ${validationClass} ${selected ? 'selected' : ''}`}>
      <PlayIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 3: Create EndNode component**

`ui/src/components/nodes/EndNode.css`:
```css
.flow-node-end {
  padding: 10px 20px;
  border-radius: 20px;
  background: var(--pf-t--global--color--status--danger--default, #c9190b);
  color: white;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  min-width: 100px;
  justify-content: center;
}
.flow-node-end.has-error { border-color: var(--pf-t--global--color--status--danger--default, #c9190b); }
.flow-node-end.has-warning { border-color: var(--pf-t--global--color--status--warning--default, #f0ab00); }
.flow-node-end.selected { box-shadow: 0 0 0 2px var(--pf-t--global--color--brand--default, #06c); }
```

`ui/src/components/nodes/EndNode.tsx`:
```typescript
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FlagCheckeredIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './EndNode.css';

export function EndNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const validationClass = nodeData.validationSeverity === 'error' ? 'has-error'
    : nodeData.validationSeverity === 'warning' ? 'has-warning' : '';

  return (
    <div className={`flow-node-end ${validationClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <FlagCheckeredIcon />
      <span>{nodeData.name}</span>
    </div>
  );
}
```

- [ ] **Step 4: Create ActionNode component**

`ui/src/components/nodes/ActionNode.css`:
```css
.flow-node-action {
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--pf-t--global--color--brand--default, #06c);
  color: white;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  min-width: 120px;
}
.flow-node-action.has-error { border-color: var(--pf-t--global--color--status--danger--default, #c9190b); }
.flow-node-action.has-warning { border-color: var(--pf-t--global--color--status--warning--default, #f0ab00); }
.flow-node-action.selected { box-shadow: 0 0 0 2px var(--pf-t--global--color--brand--default, #06c); }
```

`ui/src/components/nodes/ActionNode.tsx`:
```typescript
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CogIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './ActionNode.css';

export function ActionNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const validationClass = nodeData.validationSeverity === 'error' ? 'has-error'
    : nodeData.validationSeverity === 'warning' ? 'has-warning' : '';

  return (
    <div className={`flow-node-action ${validationClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <CogIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 5: Create HumanTaskNode component**

`ui/src/components/nodes/HumanTaskNode.css`:
```css
.flow-node-human-task {
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--pf-t--global--color--status--info--default, #2b9af3);
  color: white;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  min-width: 120px;
}
.flow-node-human-task.has-error { border-color: var(--pf-t--global--color--status--danger--default, #c9190b); }
.flow-node-human-task.has-warning { border-color: var(--pf-t--global--color--status--warning--default, #f0ab00); }
.flow-node-human-task.selected { box-shadow: 0 0 0 2px var(--pf-t--global--color--brand--default, #06c); }
```

`ui/src/components/nodes/HumanTaskNode.tsx`:
```typescript
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { UserIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './HumanTaskNode.css';

export function HumanTaskNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const validationClass = nodeData.validationSeverity === 'error' ? 'has-error'
    : nodeData.validationSeverity === 'warning' ? 'has-warning' : '';

  return (
    <div className={`flow-node-human-task ${validationClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <UserIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 6: Create ReceiveEventNode component**

`ui/src/components/nodes/ReceiveEventNode.css`:
```css
.flow-node-receive-event {
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--pf-t--global--color--status--custom--default, #73bcf7);
  color: #151515;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  min-width: 120px;
}
.flow-node-receive-event.has-error { border-color: var(--pf-t--global--color--status--danger--default, #c9190b); }
.flow-node-receive-event.has-warning { border-color: var(--pf-t--global--color--status--warning--default, #f0ab00); }
.flow-node-receive-event.selected { box-shadow: 0 0 0 2px var(--pf-t--global--color--brand--default, #06c); }
```

`ui/src/components/nodes/ReceiveEventNode.tsx`:
```typescript
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { BoltIcon } from '@patternfly/react-icons';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './ReceiveEventNode.css';

export function ReceiveEventNode({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const validationClass = nodeData.validationSeverity === 'error' ? 'has-error'
    : nodeData.validationSeverity === 'warning' ? 'has-warning' : '';

  return (
    <div className={`flow-node-receive-event ${validationClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <BoltIcon />
      <span>{nodeData.name}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 7: Create node type and edge type registries**

`ui/src/components/nodes/nodeTypes.ts`:
```typescript
import { type NodeTypes } from '@xyflow/react';
import { StartNode } from './StartNode.tsx';
import { EndNode } from './EndNode.tsx';
import { ActionNode } from './ActionNode.tsx';
import { HumanTaskNode } from './HumanTaskNode.tsx';
import { ReceiveEventNode } from './ReceiveEventNode.tsx';

export const nodeTypes: NodeTypes = {
  'start': StartNode,
  'end': EndNode,
  'action': ActionNode,
  'human-task': HumanTaskNode,
  'receive-event': ReceiveEventNode,
};
```

- [ ] **Step 8: Create ConditionalEdge component**

`ui/src/components/edges/ConditionalEdge.css`:
```css
.edge-condition-badge {
  background: var(--pf-t--global--background--color--primary--default, #fff);
  border: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--pf-t--global--text--color--subtle, #6a6e73);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.edge-condition-badge.is-default {
  background: var(--pf-t--global--color--status--info--default, #2b9af3);
  color: white;
  border-color: transparent;
}
.edge-condition-badge.has-error {
  border-color: var(--pf-t--global--color--status--danger--default, #c9190b);
}
```

`ui/src/components/edges/ConditionalEdge.tsx`:
```typescript
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import './ConditionalEdge.css';

export function ConditionalEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, style, markerEnd, selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const condition = data?.condition as string | undefined;
  const isDefault = data?.isDefault as boolean | undefined;
  const label = data?.label as string | undefined;

  const displayText = label || (isDefault ? 'default' : condition);
  const badgeClass = isDefault ? 'is-default' : '';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          strokeWidth: selected ? 2.5 : 1.5,
          stroke: selected ? 'var(--pf-t--global--color--brand--default, #06c)' : undefined,
        }}
        markerEnd={markerEnd}
      />
      {displayText && (
        <EdgeLabelRenderer>
          <div
            className={`edge-condition-badge ${badgeClass}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            {displayText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
```

`ui/src/components/edges/edgeTypes.ts`:
```typescript
import { type EdgeTypes } from '@xyflow/react';
import { ConditionalEdge } from './ConditionalEdge.tsx';

export const edgeTypes: EdgeTypes = {
  'conditional': ConditionalEdge,
};
```

- [ ] **Step 9: Update FlowNodeData to include validation state**

Add `validationSeverity` to `FlowNodeData` in `ui/src/utils/conversion.ts`:
```typescript
export interface FlowNodeData {
  name: string;
  nodeType: WorkflowNode['type'];
  config: Record<string, any>;
  validationSeverity?: 'error' | 'warning';
}
```

- [ ] **Step 10: Verify TypeScript compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 11: Commit**

```bash
git add ui/src/components/nodes/ ui/src/components/edges/ ui/src/utils/conversion.ts
git commit -m "feat(ui): add custom node and edge components for all 5 node types"
```

---

### Task 3: WorkflowEditor — Core Canvas + Node Palette

**Files:**
- Create: `ui/src/components/panels/NodePalette.tsx`, `NodePalette.css`
- Create: `ui/src/components/WorkflowEditor.tsx`, `WorkflowEditor.css`
- Modify: `ui/src/index.ts` (add WorkflowEditor export)
- Modify: `ui/src/dev/App.tsx` (render WorkflowEditor with sample data)

**Interfaces:**
- Consumes: `nodeTypes` (Task 2), `edgeTypes` (Task 2), conversion utils (Task 1), types (Task 1)
- Produces: `WorkflowEditor` component with props `{ workflow: Workflow, onChange: (workflow: Workflow) => void }` — used by consuming applications and dev app

- [ ] **Step 1: Create NodePalette**

`ui/src/components/panels/NodePalette.css`:
```css
.node-palette {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  background: var(--pf-t--global--background--color--secondary--default, #f0f0f0);
  border-bottom: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
  flex-wrap: wrap;
}
.node-palette__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
  background: var(--pf-t--global--background--color--primary--default, #fff);
  cursor: grab;
  font-size: 13px;
  user-select: none;
}
.node-palette__item:hover {
  border-color: var(--pf-t--global--color--brand--default, #06c);
}
```

`ui/src/components/panels/NodePalette.tsx`:
```typescript
import { type DragEvent } from 'react';
import { PlayIcon, FlagCheckeredIcon, CogIcon, UserIcon, BoltIcon } from '@patternfly/react-icons';
import { type NodeType } from '../../types/workflow.ts';
import './NodePalette.css';

const paletteItems: { type: NodeType; label: string; icon: React.ReactNode }[] = [
  { type: 'start', label: 'Start', icon: <PlayIcon /> },
  { type: 'action', label: 'Action', icon: <CogIcon /> },
  { type: 'human-task', label: 'Human Task', icon: <UserIcon /> },
  { type: 'receive-event', label: 'Receive Event', icon: <BoltIcon /> },
  { type: 'end', label: 'End', icon: <FlagCheckeredIcon /> },
];

export function NodePalette() {
  function onDragStart(event: DragEvent, nodeType: NodeType) {
    event.dataTransfer.setData('application/reactflow-nodetype', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div className="node-palette">
      {paletteItems.map(item => (
        <div
          key={item.type}
          className="node-palette__item"
          draggable
          onDragStart={(e) => onDragStart(e, item.type)}
        >
          {item.icon}
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create WorkflowEditor**

`ui/src/components/WorkflowEditor.css`:
```css
.workflow-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}
.workflow-editor__canvas {
  flex: 1;
}
```

`ui/src/components/WorkflowEditor.tsx`:
```typescript
import { useCallback, useMemo, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { type FlowNodeData, toReactFlowNodes, toReactFlowEdges, toWorkflow } from '../utils/conversion.ts';
import { generateNodeId, generateEdgeId } from '../utils/id.ts';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import { NodePalette } from './panels/NodePalette.tsx';
import './WorkflowEditor.css';

export interface WorkflowEditorProps {
  workflow: Workflow;
  onChange: (workflow: Workflow) => void;
  validationProblems?: ValidationProblem[];
  onValidationChange?: (problems: ValidationProblem[]) => void;
}

function WorkflowEditorInner({ workflow, onChange, validationProblems }: WorkflowEditorProps) {
  const initialNodes = useMemo(() => toReactFlowNodes(workflow.nodes), []);
  const initialEdges = useMemo(() => toReactFlowEdges(workflow.edges), []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition } = useReactFlow();

  const nodesWithValidation = useMemo(() => {
    if (!validationProblems?.length) return nodes;
    return nodes.map(node => {
      const problems = validationProblems.filter(p => p.nodeId === node.id);
      const severity = problems.some(p => p.severity === 'error') ? 'error'
        : problems.some(p => p.severity === 'warning') ? 'warning' : undefined;
      return severity ? { ...node, data: { ...node.data, validationSeverity: severity } } : node;
    });
  }, [nodes, validationProblems]);

  const emitChange = useCallback((updatedNodes: Node<FlowNodeData>[], updatedEdges: Edge[]) => {
    onChange(toWorkflow(workflow.id, workflow.name, updatedNodes, updatedEdges));
  }, [workflow.id, workflow.name, onChange]);

  const handleNodesChange: typeof onNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    setNodes(current => {
      const updated = current;
      setTimeout(() => emitChange(updated, edges), 0);
      return current;
    });
  }, [onNodesChange, edges, emitChange, setNodes]);

  const handleEdgesChange: typeof onEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);
    setEdges(current => {
      const updated = current;
      setTimeout(() => emitChange(nodes, updated), 0);
      return current;
    });
  }, [onEdgesChange, nodes, emitChange, setEdges]);

  const onConnect = useCallback((connection: Connection) => {
    const edgeId = generateEdgeId(connection.source!, connection.target!);
    const newEdge: Edge = {
      ...connection,
      id: edgeId,
      type: 'conditional',
      data: { condition: undefined, priority: 0, isDefault: false },
    };
    setEdges(eds => {
      const updated = addEdge(newEdge, eds);
      setTimeout(() => emitChange(nodes, updated), 0);
      return updated;
    });
  }, [setEdges, nodes, emitChange]);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData('application/reactflow-nodetype');
    if (!nodeType) return;

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const newNode: Node<FlowNodeData> = {
      id: generateNodeId(nodeType),
      type: nodeType,
      position,
      data: {
        name: nodeType.charAt(0).toUpperCase() + nodeType.slice(1).replace(/-/g, ' '),
        nodeType: nodeType as FlowNodeData['nodeType'],
        config: nodeType === 'action' ? { actionType: '' } : {},
      },
    };

    setNodes(nds => {
      const updated = [...nds, newNode];
      setTimeout(() => emitChange(updated, edges), 0);
      return updated;
    });
  }, [screenToFlowPosition, setNodes, edges, emitChange]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div className="workflow-editor">
      <NodePalette />
      <div className="workflow-editor__canvas">
        <ReactFlow
          nodes={nodesWithValidation}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={{ type: 'conditional' }}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}

export function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
```

- [ ] **Step 3: Update index.ts exports**

Add to `ui/src/index.ts`:
```typescript
export { WorkflowEditor, type WorkflowEditorProps } from './components/WorkflowEditor.tsx';
```

- [ ] **Step 4: Update dev app to render WorkflowEditor**

Replace the editor placeholder in `ui/src/dev/App.tsx` with:
```typescript
import { useState } from 'react';
import { WorkflowEditor } from '../components/WorkflowEditor.tsx';
import { cveTriage, emptyWorkflow } from './sampleWorkflows.ts';
import { type Workflow } from '../types/workflow.ts';
// ... keep existing imports and structure

// Inside App component, replace the editor tab content:
{tab === 'editor' && (
  <WorkflowEditor
    workflow={sampleWorkflow}
    onChange={(w) => setSampleWorkflow(w)}
  />
)}
```

Full updated `App.tsx`:
```typescript
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '@patternfly/patternfly/patternfly.css';
import '@xyflow/react/dist/style.css';
import { WorkflowEditor } from '../components/WorkflowEditor.tsx';
import { cveTriage } from './sampleWorkflows.ts';
import { type Workflow } from '../types/workflow.ts';
import './App.css';

function App() {
  const [tab, setTab] = useState<'editor' | 'viewer'>('editor');
  const [workflow, setWorkflow] = useState<Workflow>(cveTriage);

  return (
    <div className="dev-app">
      <div className="dev-app__tabs">
        <button className={tab === 'editor' ? 'active' : ''} onClick={() => setTab('editor')}>
          Editor
        </button>
        <button className={tab === 'viewer' ? 'active' : ''} onClick={() => setTab('viewer')}>
          Viewer
        </button>
      </div>
      <div className="dev-app__content">
        {tab === 'editor' && (
          <WorkflowEditor workflow={workflow} onChange={setWorkflow} />
        )}
        {tab === 'viewer' && <div style={{ padding: 20 }}>WorkflowViewer will render here (Task 7)</div>}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

- [ ] **Step 5: Verify dev app runs with editor**

Run: `cd ui && npm run dev`
Expected: Editor renders with CVE triage workflow. Nodes are draggable, edges connect, node palette works.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/ ui/src/index.ts ui/src/dev/
git commit -m "feat(ui): add WorkflowEditor with canvas, node palette, and edge creation"
```

---

### Task 4: Properties Panel

**Files:**
- Create: `ui/src/components/panels/PropertiesPanel.tsx`, `PropertiesPanel.css`
- Modify: `ui/src/components/WorkflowEditor.tsx` (integrate properties panel)

**Interfaces:**
- Consumes: Types from Task 1, WorkflowEditor state from Task 3
- Produces: `PropertiesPanel` component that modifies selected node/edge configuration

- [ ] **Step 1: Create PropertiesPanel**

`ui/src/components/panels/PropertiesPanel.css`:
```css
.properties-panel {
  width: 320px;
  border-left: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
  background: var(--pf-t--global--background--color--primary--default, #fff);
  overflow-y: auto;
  padding: 16px;
}
.properties-panel__header {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
}
.properties-panel__empty {
  color: var(--pf-t--global--text--color--subtle, #6a6e73);
  font-size: 13px;
  padding: 20px;
  text-align: center;
}
.properties-panel__field {
  margin-bottom: 12px;
}
.properties-panel__field label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}
.properties-panel__field input,
.properties-panel__field textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
  border-radius: 4px;
  font-size: 13px;
}
.properties-panel__field input[type="checkbox"] {
  width: auto;
  margin-right: 8px;
}
.properties-panel__field input[type="number"] {
  width: 80px;
}
```

`ui/src/components/panels/PropertiesPanel.tsx`:
```typescript
import { type Node, type Edge } from '@xyflow/react';
import { type FlowNodeData } from '../../utils/conversion.ts';
import './PropertiesPanel.css';

interface PropertiesPanelProps {
  selectedNode?: Node<FlowNodeData>;
  selectedEdge?: Edge;
  onNodeChange: (id: string, data: Partial<FlowNodeData>) => void;
  onEdgeChange: (id: string, data: Record<string, any>) => void;
}

export function PropertiesPanel({ selectedNode, selectedEdge, onNodeChange, onEdgeChange }: PropertiesPanelProps) {
  if (!selectedNode && !selectedEdge) {
    return (
      <div className="properties-panel">
        <div className="properties-panel__empty">
          Select a node or edge to view its properties
        </div>
      </div>
    );
  }

  if (selectedNode) {
    return (
      <div className="properties-panel">
        <div className="properties-panel__header">
          {selectedNode.data.nodeType} Node
        </div>
        <div className="properties-panel__field">
          <label>Name</label>
          <input
            type="text"
            value={selectedNode.data.name}
            onChange={(e) => onNodeChange(selectedNode.id, { name: e.target.value })}
          />
        </div>
        {selectedNode.data.nodeType === 'action' && (
          <div className="properties-panel__field">
            <label>Action Type</label>
            <input
              type="text"
              value={(selectedNode.data.config.actionType as string) || ''}
              onChange={(e) => onNodeChange(selectedNode.id, {
                config: { ...selectedNode.data.config, actionType: e.target.value },
              })}
            />
          </div>
        )}
        {selectedNode.data.nodeType === 'receive-event' && (
          <>
            <div className="properties-panel__field">
              <label>Event Type</label>
              <input
                type="text"
                value={(selectedNode.data.config.eventType as string) || ''}
                onChange={(e) => onNodeChange(selectedNode.id, {
                  config: { ...selectedNode.data.config, eventType: e.target.value },
                })}
              />
            </div>
          </>
        )}
        <div className="properties-panel__field">
          <label>Node ID</label>
          <input type="text" value={selectedNode.id} disabled />
        </div>
      </div>
    );
  }

  if (selectedEdge) {
    return (
      <div className="properties-panel">
        <div className="properties-panel__header">Edge</div>
        <div className="properties-panel__field">
          <label>Label</label>
          <input
            type="text"
            value={(selectedEdge.data?.label as string) || ''}
            onChange={(e) => onEdgeChange(selectedEdge.id, { label: e.target.value })}
          />
        </div>
        <div className="properties-panel__field">
          <label>Condition (EL expression)</label>
          <textarea
            rows={3}
            value={(selectedEdge.data?.condition as string) || ''}
            onChange={(e) => onEdgeChange(selectedEdge.id, { condition: e.target.value })}
          />
        </div>
        <div className="properties-panel__field">
          <label>Priority</label>
          <input
            type="number"
            value={(selectedEdge.data?.priority as number) ?? 0}
            onChange={(e) => onEdgeChange(selectedEdge.id, { priority: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div className="properties-panel__field">
          <label>
            <input
              type="checkbox"
              checked={(selectedEdge.data?.isDefault as boolean) || false}
              onChange={(e) => onEdgeChange(selectedEdge.id, { isDefault: e.target.checked })}
            />
            Default edge (fallback when no conditions match)
          </label>
        </div>
        <div className="properties-panel__field">
          <label>Edge ID</label>
          <input type="text" value={selectedEdge.id} disabled />
        </div>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 2: Integrate PropertiesPanel into WorkflowEditor**

Update `WorkflowEditor.tsx` to track selection and render the panel. Add selection state, click handlers for nodes/edges, and node/edge data update callbacks. The editor layout becomes a horizontal flex with the canvas on the left and the properties panel on the right.

Update the CSS:
```css
.workflow-editor__body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.workflow-editor__canvas {
  flex: 1;
}
```

Add to `WorkflowEditorInner`:
```typescript
const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

const selectedNode = nodes.find(n => n.id === selectedNodeId);
const selectedEdge = edges.find(e => e.id === selectedEdgeId);

const onNodeClick = useCallback((_: any, node: Node) => {
  setSelectedNodeId(node.id);
  setSelectedEdgeId(null);
}, []);

const onEdgeClick = useCallback((_: any, edge: Edge) => {
  setSelectedEdgeId(edge.id);
  setSelectedNodeId(null);
}, []);

const onPaneClick = useCallback(() => {
  setSelectedNodeId(null);
  setSelectedEdgeId(null);
}, []);

const onNodeDataChange = useCallback((id: string, dataUpdate: Partial<FlowNodeData>) => {
  setNodes(nds => {
    const updated = nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...dataUpdate } } : n);
    setTimeout(() => emitChange(updated, edges), 0);
    return updated;
  });
}, [setNodes, edges, emitChange]);

const onEdgeDataChange = useCallback((id: string, dataUpdate: Record<string, any>) => {
  setEdges(eds => {
    const updated = eds.map(e => e.id === id ? { ...e, data: { ...e.data, ...dataUpdate } } : e);
    setTimeout(() => emitChange(nodes, updated), 0);
    return updated;
  });
}, [setEdges, nodes, emitChange]);
```

Wrap the canvas and panel in the body layout:
```tsx
<div className="workflow-editor__body">
  <div className="workflow-editor__canvas">
    <ReactFlow
      ...existing props...
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
    >
      ...
    </ReactFlow>
  </div>
  <PropertiesPanel
    selectedNode={selectedNode}
    selectedEdge={selectedEdge}
    onNodeChange={onNodeDataChange}
    onEdgeChange={onEdgeDataChange}
  />
</div>
```

- [ ] **Step 3: Verify properties panel works**

Run: `cd ui && npm run dev`
Expected: Click a node — properties panel shows name and type-specific fields. Click an edge — shows condition, priority, default checkbox. Click canvas — panel shows "Select a node or edge."

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/
git commit -m "feat(ui): add properties panel for node and edge configuration"
```

---

### Task 5: Validation Module (TypeScript Logic)

**Files:**
- Create: `ui/src/validation/validateWorkflow.ts`
- Create: `ui/src/validation/validateWorkflow.test.ts`

**Interfaces:**
- Consumes: Types from Task 1 (`Workflow`, `WorkflowNode`, `WorkflowEdge`, `ValidationProblem`)
- Produces: `validateWorkflow(workflow: Workflow): ValidationProblem[]` — used by WorkflowEditor (Task 6)

TypeScript port of the Java WorkflowValidator. Implements 23 of 24 rules (skips `INVALID_CONDITION` which requires Jakarta EL parsing).

- [ ] **Step 1: Write failing tests**

`ui/src/validation/validateWorkflow.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateWorkflow } from './validateWorkflow.ts';
import { type Workflow, type WorkflowNode, type WorkflowEdge } from '../types/workflow.ts';

function node(id: string, type: WorkflowNode['type'], config: Record<string, any> = {}): WorkflowNode {
  return { id, type, name: id, config, position: { x: 0, y: 0 } };
}

function edge(id: string, source: string, target: string, opts: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return { id, source, target, priority: 0, isDefault: false, ...opts };
}

function workflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow {
  return { id: 'test', name: 'Test', nodes, edges };
}

function hasProblem(problems: ReturnType<typeof validateWorkflow>, code: string): boolean {
  return problems.some(p => p.code === code);
}

describe('validateWorkflow', () => {
  describe('structural rules', () => {
    it('NO_START_NODE when no start', () => {
      const w = workflow([node('end', 'end')], []);
      expect(hasProblem(validateWorkflow(w), 'NO_START_NODE')).toBe(true);
    });

    it('MULTIPLE_START_NODES', () => {
      const w = workflow(
        [node('s1', 'start'), node('s2', 'start'), node('end', 'end')],
        [edge('e1', 's1', 'end'), edge('e2', 's2', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MULTIPLE_START_NODES')).toBe(true);
    });

    it('NO_END_NODE', () => {
      const w = workflow([node('start', 'start')], []);
      expect(hasProblem(validateWorkflow(w), 'NO_END_NODE')).toBe(true);
    });

    it('INVALID_EDGE_SOURCE', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('e1', 'missing', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_EDGE_SOURCE')).toBe(true);
    });

    it('INVALID_EDGE_TARGET', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('e1', 'start', 'missing')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_EDGE_TARGET')).toBe(true);
    });

    it('DUPLICATE_NODE_ID', () => {
      const w = workflow([node('dup', 'start'), node('dup', 'end')], []);
      expect(hasProblem(validateWorkflow(w), 'DUPLICATE_NODE_ID')).toBe(true);
    });

    it('DUPLICATE_EDGE_ID', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('dup', 'start', 'end'), edge('dup', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'DUPLICATE_EDGE_ID')).toBe(true);
    });

    it('START_HAS_INCOMING', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 'x' }), node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'start'), edge('e3', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'START_HAS_INCOMING')).toBe(true);
    });

    it('END_HAS_OUTGOING', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end'), node('a', 'action', { actionType: 'x' })],
        [edge('e1', 'start', 'end'), edge('e2', 'end', 'a')],
      );
      expect(hasProblem(validateWorkflow(w), 'END_HAS_OUTGOING')).toBe(true);
    });

    it('MISSING_ACTION_TYPE', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action'), node('end', 'end')],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_ACTION_TYPE')).toBe(true);
    });
  });

  describe('connectivity rules', () => {
    it('DISCONNECTED_NODE', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end'), node('orphan', 'action', { actionType: 'x' })],
        [edge('e1', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'DISCONNECTED_NODE')).toBe(true);
    });

    it('NO_OUTGOING_EDGES', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 'x' }), node('end', 'end')],
        [edge('e1', 'start', 'a')],
      );
      expect(hasProblem(validateWorkflow(w), 'NO_OUTGOING_EDGES')).toBe(true);
    });
  });

  describe('edge/condition rules', () => {
    it('NO_DEFAULT_EDGE with conditional edges', () => {
      const w = workflow(
        [node('start', 'start'), node('a', 'action', { actionType: 'x' }), node('b', 'action', { actionType: 'y' }), node('end', 'end')],
        [
          edge('e1', 'start', 'a', { condition: 'context.x == 1', priority: 1 }),
          edge('e2', 'start', 'b', { condition: 'context.x == 2', priority: 2 }),
          edge('e3', 'a', 'end'),
          edge('e4', 'b', 'end'),
        ],
      );
      expect(hasProblem(validateWorkflow(w), 'NO_DEFAULT_EDGE')).toBe(true);
    });

    it('MULTIPLE_DEFAULT_EDGES', () => {
      const w = workflow(
        [node('start', 'start'), node('end1', 'end'), node('end2', 'end')],
        [
          edge('e1', 'start', 'end1', { isDefault: true }),
          edge('e2', 'start', 'end2', { isDefault: true }),
        ],
      );
      expect(hasProblem(validateWorkflow(w), 'MULTIPLE_DEFAULT_EDGES')).toBe(true);
    });
  });

  describe('semantic rules', () => {
    it('MISSING_EVENT_TYPE', () => {
      const w = workflow(
        [node('start', 'start'), node('r', 'receive-event'), node('end', 'end')],
        [edge('e1', 'start', 'r'), edge('e2', 'r', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_EVENT_TYPE')).toBe(true);
    });

    it('MISSING_START_INPUTS', () => {
      const w = workflow(
        [node('start', 'start'), node('end', 'end')],
        [edge('e1', 'start', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_START_INPUTS')).toBe(true);
    });
  });

  describe('valid workflows', () => {
    it('valid workflow has no errors', () => {
      const w = workflow(
        [
          node('start', 'start', { inputs: [{ name: 'x', type: 'string', required: true }] }),
          node('a', 'action', { actionType: 'test' }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 'a'), edge('e2', 'a', 'end')],
      );
      const errors = validateWorkflow(w).filter(p => p.severity === 'error');
      expect(errors).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ui && npx vitest run`
Expected: Compilation failure — `validateWorkflow` doesn't exist

- [ ] **Step 3: Implement validateWorkflow**

`ui/src/validation/validateWorkflow.ts`:
```typescript
import { type Workflow, type WorkflowNode, type WorkflowEdge } from '../types/workflow.ts';
import { type ValidationProblem, type ValidationSeverity } from '../types/validation.ts';

function problem(severity: ValidationSeverity, code: string, message: string, nodeId?: string, edgeId?: string): ValidationProblem {
  return { severity, code, message, nodeId, edgeId };
}

export function validateWorkflow(workflow: Workflow): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  validateStructure(workflow, problems);
  validateConnectivity(workflow, problems);
  validateEdgeConditions(workflow, problems);
  validateSemantics(workflow, problems);
  return problems;
}

function validateStructure(workflow: Workflow, problems: ValidationProblem[]) {
  const { nodes, edges } = workflow;
  const nodeIds = new Set<string>();

  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      problems.push(problem('error', 'DUPLICATE_NODE_ID', `Duplicate node ID: ${node.id}`, node.id));
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      problems.push(problem('error', 'DUPLICATE_EDGE_ID', `Duplicate edge ID: ${edge.id}`, undefined, edge.id));
    }
    edgeIds.add(edge.id);
  }

  const startNodes = nodes.filter(n => n.type === 'start');
  if (startNodes.length === 0) {
    problems.push(problem('error', 'NO_START_NODE', 'No start node found'));
  } else if (startNodes.length > 1) {
    problems.push(problem('error', 'MULTIPLE_START_NODES', `Found ${startNodes.length} start nodes`));
  }

  if (!nodes.some(n => n.type === 'end')) {
    problems.push(problem('error', 'NO_END_NODE', 'No end node found'));
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      problems.push(problem('error', 'INVALID_EDGE_SOURCE', `Edge ${edge.id} references nonexistent source: ${edge.source}`, undefined, edge.id));
    }
    if (!nodeIds.has(edge.target)) {
      problems.push(problem('error', 'INVALID_EDGE_TARGET', `Edge ${edge.id} references nonexistent target: ${edge.target}`, undefined, edge.id));
    }
  }

  for (const start of startNodes) {
    if (edges.some(e => e.target === start.id)) {
      problems.push(problem('error', 'START_HAS_INCOMING', 'Start node must not have incoming edges', start.id));
    }
  }

  for (const end of nodes.filter(n => n.type === 'end')) {
    if (edges.some(e => e.source === end.id)) {
      problems.push(problem('error', 'END_HAS_OUTGOING', 'End node must not have outgoing edges', end.id));
    }
  }

  for (const action of nodes.filter(n => n.type === 'action')) {
    if (!action.config.actionType) {
      problems.push(problem('error', 'MISSING_ACTION_TYPE', 'Action node missing actionType in config', action.id));
    }
  }
}

function validateConnectivity(workflow: Workflow, problems: ValidationProblem[]) {
  const { nodes, edges } = workflow;

  for (const node of nodes) {
    const incoming = edges.filter(e => e.target === node.id);
    const outgoing = edges.filter(e => e.source === node.id);

    if (node.type !== 'start' && incoming.length === 0 && outgoing.length === 0) {
      problems.push(problem('error', 'DISCONNECTED_NODE', 'Node is completely disconnected', node.id));
      continue;
    }

    if (node.type !== 'end' && outgoing.length === 0) {
      problems.push(problem('error', 'NO_OUTGOING_EDGES', 'Non-end node has no outgoing edges', node.id));
    }

    if (node.type !== 'start' && incoming.length === 0) {
      problems.push(problem('warning', 'NO_INCOMING_EDGES', 'Node has no incoming edges — unreachable', node.id));
    }
  }

  const startNode = nodes.find(n => n.type === 'start');
  if (startNode) {
    const reachable = new Set<string>();
    const queue = [startNode.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const edge of edges.filter(e => e.source === current)) {
        queue.push(edge.target);
      }
    }

    for (const node of nodes) {
      if (!reachable.has(node.id) && node.type !== 'start') {
        problems.push(problem('warning', 'UNREACHABLE_NODE', 'Node cannot be reached from start', node.id));
      }
    }

    const canReachEnd = new Set<string>();
    const endNodes = nodes.filter(n => n.type === 'end');
    const reverseQueue = endNodes.map(n => n.id);
    for (const id of reverseQueue) canReachEnd.add(id);
    while (reverseQueue.length > 0) {
      const current = reverseQueue.shift()!;
      for (const edge of edges.filter(e => e.target === current)) {
        if (!canReachEnd.has(edge.source)) {
          canReachEnd.add(edge.source);
          reverseQueue.push(edge.source);
        }
      }
    }

    for (const node of nodes) {
      if (reachable.has(node.id) && !canReachEnd.has(node.id) && node.type !== 'end') {
        problems.push(problem('warning', 'NO_PATH_TO_END', 'Node has no path to any end node', node.id));
      }
    }
  }
}

function validateEdgeConditions(workflow: Workflow, problems: ValidationProblem[]) {
  const edgesBySource = new Map<string, WorkflowEdge[]>();
  for (const edge of workflow.edges) {
    const list = edgesBySource.get(edge.source) || [];
    list.push(edge);
    edgesBySource.set(edge.source, list);
  }

  for (const [sourceId, outgoing] of edgesBySource) {
    if (outgoing.length <= 1) continue;

    const defaults = outgoing.filter(e => e.isDefault);
    if (defaults.length > 1) {
      problems.push(problem('warning', 'MULTIPLE_DEFAULT_EDGES', 'Node has multiple default edges', sourceId));
    }

    const hasConditional = outgoing.some(e => e.condition && e.condition.trim() !== '');
    if (hasConditional && defaults.length === 0) {
      problems.push(problem('warning', 'NO_DEFAULT_EDGE', 'Node has conditional edges but no default fallback', sourceId));
    }

    const allUnconditional = outgoing.every(e => !e.condition || e.condition.trim() === '');
    if (allUnconditional && defaults.length === 0) {
      problems.push(problem('warning', 'UNCONDITIONAL_MULTIPLE_EDGES', 'Node has multiple outgoing edges with no conditions', sourceId));
    }

    const priorityCounts = new Map<number, number>();
    for (const edge of outgoing) {
      priorityCounts.set(edge.priority, (priorityCounts.get(edge.priority) || 0) + 1);
    }
    for (const [priority, count] of priorityCounts) {
      if (count > 1) {
        problems.push(problem('warning', 'DUPLICATE_EDGE_PRIORITY', `Multiple edges from node ${sourceId} share priority ${priority}`, undefined, sourceId));
      }
    }
  }
}

function validateSemantics(workflow: Workflow, problems: ValidationProblem[]) {
  for (const node of workflow.nodes.filter(n => n.type === 'receive-event')) {
    if (!node.config.eventType) {
      problems.push(problem('warning', 'MISSING_EVENT_TYPE', 'Receive-event node has no eventType configured', node.id));
    }
  }

  const receivers = workflow.nodes.filter(n => n.type === 'receive-event' && n.config.eventType);
  for (let i = 0; i < receivers.length; i++) {
    for (let j = i + 1; j < receivers.length; j++) {
      if (receivers[i].config.eventType === receivers[j].config.eventType &&
          JSON.stringify(receivers[i].config.match) === JSON.stringify(receivers[j].config.match)) {
        problems.push(problem('warning', 'DUPLICATE_EVENT_RECEIVER', 'Multiple receive-event nodes match the same events', receivers[j].id));
      }
    }
  }

  const startNode = workflow.nodes.find(n => n.type === 'start');
  if (startNode && !startNode.config.inputs) {
    problems.push(problem('warning', 'MISSING_START_INPUTS', 'Start node has no inputs defined', startNode.id));
  }

  detectAutomatedCycles(workflow, problems);
}

function detectAutomatedCycles(workflow: Workflow, problems: ValidationProblem[]) {
  const actionNodeIds = new Set(workflow.nodes.filter(n => n.type === 'action').map(n => n.id));
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const edge of workflow.edges.filter(e => e.source === nodeId)) {
      if (!actionNodeIds.has(edge.target)) continue;
      if (inStack.has(edge.target)) return true;
      if (!visited.has(edge.target) && dfs(edge.target)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }

  for (const nodeId of actionNodeIds) {
    if (!visited.has(nodeId) && dfs(nodeId)) {
      problems.push(problem('warning', 'AUTOMATED_CYCLE', 'Cycle detected containing only action nodes', nodeId));
      return;
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd ui && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add ui/src/validation/
git commit -m "feat(ui): add TypeScript workflow validator with 23 rules"
```

---

### Task 6: Validation UI — Inline Indicators + Problems Panel

**Files:**
- Create: `ui/src/components/panels/ProblemsPanel.tsx`, `ProblemsPanel.css`
- Modify: `ui/src/components/WorkflowEditor.tsx` (integrate validation and problems panel)

**Interfaces:**
- Consumes: `validateWorkflow` from Task 5, `ValidationProblem` types from Task 1
- Produces: Live validation in the editor: inline node indicators, problems panel, `onValidationChange` callback

- [ ] **Step 1: Create ProblemsPanel**

`ui/src/components/panels/ProblemsPanel.css`:
```css
.problems-panel {
  border-top: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
  background: var(--pf-t--global--background--color--primary--default, #fff);
  max-height: 200px;
  overflow-y: auto;
}
.problems-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  background: var(--pf-t--global--background--color--secondary--default, #f0f0f0);
  border-bottom: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
  cursor: pointer;
  user-select: none;
}
.problems-panel__count {
  display: flex;
  gap: 8px;
}
.problems-panel__count-error {
  color: var(--pf-t--global--color--status--danger--default, #c9190b);
}
.problems-panel__count-warning {
  color: var(--pf-t--global--color--status--warning--default, #f0ab00);
}
.problems-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.problems-panel__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--pf-t--global--border--color--default, #d2d2d2);
}
.problems-panel__item:hover {
  background: var(--pf-t--global--background--color--secondary--default, #f0f0f0);
}
.problems-panel__severity-error {
  color: var(--pf-t--global--color--status--danger--default, #c9190b);
  font-weight: 600;
}
.problems-panel__severity-warning {
  color: var(--pf-t--global--color--status--warning--default, #f0ab00);
  font-weight: 600;
}
.problems-panel__code {
  font-family: monospace;
  color: var(--pf-t--global--text--color--subtle, #6a6e73);
}
```

`ui/src/components/panels/ProblemsPanel.tsx`:
```typescript
import { useState } from 'react';
import { type ValidationProblem } from '../../types/validation.ts';
import './ProblemsPanel.css';

interface ProblemsPanelProps {
  problems: ValidationProblem[];
  onProblemClick: (problem: ValidationProblem) => void;
}

export function ProblemsPanel({ problems, onProblemClick }: ProblemsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const errors = problems.filter(p => p.severity === 'error');
  const warnings = problems.filter(p => p.severity === 'warning');
  const sorted = [...errors, ...warnings];

  return (
    <div className="problems-panel">
      <div className="problems-panel__header" onClick={() => setCollapsed(!collapsed)}>
        <span>Problems</span>
        <div className="problems-panel__count">
          {errors.length > 0 && <span className="problems-panel__count-error">{errors.length} errors</span>}
          {warnings.length > 0 && <span className="problems-panel__count-warning">{warnings.length} warnings</span>}
          {problems.length === 0 && <span>No problems</span>}
        </div>
      </div>
      {!collapsed && sorted.length > 0 && (
        <ul className="problems-panel__list">
          {sorted.map((p, i) => (
            <li key={`${p.code}-${p.nodeId ?? p.edgeId ?? i}`} className="problems-panel__item" onClick={() => onProblemClick(p)}>
              <span className={p.severity === 'error' ? 'problems-panel__severity-error' : 'problems-panel__severity-warning'}>
                {p.severity === 'error' ? 'E' : 'W'}
              </span>
              <span className="problems-panel__code">{p.code}</span>
              <span>{p.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Integrate validation into WorkflowEditor**

Add to `WorkflowEditorInner` in `WorkflowEditor.tsx`:

```typescript
import { validateWorkflow } from '../validation/validateWorkflow.ts';
import { ProblemsPanel } from './panels/ProblemsPanel.tsx';

// Inside component, after nodes/edges state:
const currentWorkflow = useMemo(
  () => toWorkflow(workflow.id, workflow.name, nodes, edges),
  [workflow.id, workflow.name, nodes, edges],
);

const validationProblems = useMemo(
  () => validateWorkflow(currentWorkflow),
  [currentWorkflow],
);

// Fire onValidationChange callback
useEffect(() => {
  onValidationChange?.(validationProblems);
}, [validationProblems, onValidationChange]);

// Problem click handler — select and center the affected node/edge
const onProblemClick = useCallback((problem: ValidationProblem) => {
  if (problem.nodeId) {
    setSelectedNodeId(problem.nodeId);
    setSelectedEdgeId(null);
    const node = nodes.find(n => n.id === problem.nodeId);
    if (node) {
      fitView({ nodes: [node], duration: 300 });
    }
  } else if (problem.edgeId) {
    setSelectedEdgeId(problem.edgeId);
    setSelectedNodeId(null);
  }
}, [nodes, fitView]);
```

Add `ProblemsPanel` below the editor body:
```tsx
<div className="workflow-editor">
  <NodePalette />
  <div className="workflow-editor__body">
    <div className="workflow-editor__canvas">
      <ReactFlow ...>...</ReactFlow>
    </div>
    <PropertiesPanel ... />
  </div>
  <ProblemsPanel problems={validationProblems} onProblemClick={onProblemClick} />
</div>
```

Update `nodesWithValidation` to use the locally computed `validationProblems` instead of the prop.

- [ ] **Step 3: Verify validation works in dev app**

Run: `cd ui && npm run dev`
Expected: Problems panel at the bottom shows validation issues. Add a disconnected node — error appears. Click a problem — selects the node.

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/
git commit -m "feat(ui): add live validation with inline indicators and problems panel"
```

---

### Task 7: WorkflowViewer

**Files:**
- Create: `ui/src/components/WorkflowViewer.tsx`, `WorkflowViewer.css`
- Modify: `ui/src/index.ts` (add export)
- Modify: `ui/src/dev/App.tsx` (render viewer with sample instance)

**Interfaces:**
- Consumes: `nodeTypes` (Task 2), `edgeTypes` (Task 2), conversion utils (Task 1), types (Task 1)
- Produces: `WorkflowViewer` component with props `{ workflow: Workflow, instance: WorkflowInstance }`

- [ ] **Step 1: Create WorkflowViewer**

`ui/src/components/WorkflowViewer.css`:
```css
.workflow-viewer {
  height: 100%;
  width: 100%;
}
.flow-node-visited { opacity: 1; }
.flow-node-unvisited { opacity: 0.4; }
.flow-node-current { box-shadow: 0 0 0 3px var(--pf-t--global--color--status--warning--default, #f0ab00); }
```

`ui/src/components/WorkflowViewer.tsx`:
```typescript
import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap, ReactFlowProvider } from '@xyflow/react';
import { type Workflow } from '../types/workflow.ts';
import { type WorkflowInstance } from '../types/instance.ts';
import { toReactFlowNodes, toReactFlowEdges } from '../utils/conversion.ts';
import { nodeTypes } from './nodes/nodeTypes.ts';
import { edgeTypes } from './edges/edgeTypes.ts';
import './WorkflowViewer.css';

export interface WorkflowViewerProps {
  workflow: Workflow;
  instance: WorkflowInstance;
}

function WorkflowViewerInner({ workflow, instance }: WorkflowViewerProps) {
  const visitedNodeIds = useMemo(
    () => new Set(instance.history.map(h => h.nodeId)),
    [instance.history],
  );

  const visitedEdgeIds = useMemo(
    () => new Set(instance.history.filter(h => h.edgeId).map(h => h.edgeId!)),
    [instance.history],
  );

  const nodes = useMemo(() => {
    return toReactFlowNodes(workflow.nodes).map(node => {
      const isCurrent = node.id === instance.currentNodeId;
      const isVisited = visitedNodeIds.has(node.id);
      return {
        ...node,
        className: isCurrent ? 'flow-node-current' : isVisited ? 'flow-node-visited' : 'flow-node-unvisited',
        draggable: false,
        selectable: false,
      };
    });
  }, [workflow.nodes, instance.currentNodeId, visitedNodeIds]);

  const edges = useMemo(() => {
    return toReactFlowEdges(workflow.edges).map(edge => {
      const isVisited = visitedEdgeIds.has(edge.id);
      return {
        ...edge,
        style: {
          ...edge.style,
          strokeWidth: isVisited ? 2.5 : 1,
          stroke: isVisited ? 'var(--pf-t--global--color--status--success--default, #3e8635)' : undefined,
          opacity: isVisited ? 1 : 0.3,
        },
        animated: edge.id === instance.history[instance.history.length - 1]?.edgeId,
      };
    });
  }, [workflow.edges, visitedEdgeIds, instance.history]);

  return (
    <div className="workflow-viewer">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

export function WorkflowViewer(props: WorkflowViewerProps) {
  return (
    <ReactFlowProvider>
      <WorkflowViewerInner {...props} />
    </ReactFlowProvider>
  );
}
```

- [ ] **Step 2: Update index.ts exports**

Add to `ui/src/index.ts`:
```typescript
export { WorkflowViewer, type WorkflowViewerProps } from './components/WorkflowViewer.tsx';
```

- [ ] **Step 3: Update dev app to render WorkflowViewer**

Update `ui/src/dev/App.tsx` to render the viewer tab with sample data:
```typescript
import { WorkflowViewer } from '../components/WorkflowViewer.tsx';
import { cveTriage, triageInstance } from './sampleWorkflows.ts';

// In the viewer tab:
{tab === 'viewer' && (
  <WorkflowViewer workflow={cveTriage} instance={triageInstance} />
)}
```

- [ ] **Step 4: Verify viewer renders**

Run: `cd ui && npm run dev`
Expected: Viewer tab shows the CVE triage workflow. The "Triage Decision" node is highlighted as current. Start, Analyze CVE, and their edges are styled as visited. Remaining nodes are dimmed.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/WorkflowViewer.tsx ui/src/components/WorkflowViewer.css ui/src/index.ts ui/src/dev/
git commit -m "feat(ui): add WorkflowViewer with instance state visualization"
```

---

## Self-Review

**Spec coverage:**
- Stack (React 19, TS, Vite, @xyflow/react, PatternFly 6) → Task 1 ✓
- Exported components (WorkflowEditor, WorkflowViewer) → Tasks 3, 7 ✓
- Component structure matches spec → File map ✓
- Canvas with drag-and-drop → Task 3 ✓
- Node palette with 5 node types → Task 3 ✓
- Edge creation (source → target) → Task 3 ✓
- Properties panel for node config → Task 4 ✓
- Properties panel for edge config → Task 4 ✓
- Custom nodes per type (icon, color, shape) → Task 2 ✓
- Custom edges with condition badge → Task 2 ✓
- Live validation on every change → Task 6 ✓
- Inline indicators (red/amber borders) → Task 2 (CSS) + Task 6 (wiring) ✓
- Problems panel with click-to-navigate → Task 6 ✓
- onValidationChange callback → Task 6 ✓
- Read-only viewer → Task 7 ✓
- Current node highlight → Task 7 ✓
- Path taken visualization → Task 7 ✓
- TypeScript types (definition, runtime, validation) → Task 1 ✓
- Validation module (23 rules, skips INVALID_CONDITION) → Task 5 ✓

**Placeholder scan:** No TBD/TODO found. All steps have code.

**Type consistency:** `Workflow`, `WorkflowNode`, `WorkflowEdge` types consistent across all tasks. `FlowNodeData` interface consistent. `validateWorkflow` signature consistent. `WorkflowEditorProps` and `WorkflowViewerProps` consistent.
