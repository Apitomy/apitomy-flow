# Quick Start

This guide walks through creating a simple workflow, executing it with the engine, and displaying it in the visual editor.

## Define a Workflow

A workflow is a directed graph of nodes connected by edges:

```java
Workflow workflow = new Workflow("my-workflow", "Review Process", null,
    List.of(
        new WorkflowNode("start", NodeType.START, "Start",
            Map.of("inputs", List.of(Map.of("name", "itemId", "type", "string", "required", true))),
            new Position(0, 100)),
        new WorkflowNode("review", NodeType.HUMAN_TASK, "Review Item",
            Map.of("title", "Please review this item"),
            new Position(250, 100)),
        new WorkflowNode("end-approved", NodeType.END, "Approved",
            Map.of("outcome", "approved"),
            new Position(500, 50)),
        new WorkflowNode("end-rejected", NodeType.END, "Rejected",
            Map.of("outcome", "rejected"),
            new Position(500, 150))
    ),
    List.of(
        new WorkflowEdge("e1", "start", "review", null, 0, false, null),
        new WorkflowEdge("e2", "review", "end-approved",
            "context.decision == 'approve'", 1, false, "Approved"),
        new WorkflowEdge("e3", "review", "end-rejected",
            null, 2, true, "Rejected")
    )
);
```

## Start the Engine

```java
// Implement a NodeExecutor for each action type you use
// (this example has no action nodes, so none needed)

WorkflowEngine engine = new WorkflowEngine(
    List.of(),    // no action executors
    List.of(),    // no event listeners
    null          // default error handler
);

// Start the workflow with initial context
WorkflowInstance instance = engine.startWorkflow(workflow,
    Map.of("itemId", "ITEM-42"));

// The instance is now WAITING at the "review" node
System.out.println(instance.status());        // WAITING
System.out.println(instance.currentNodeId()); // review
```

## Complete a Human Task

```java
// Simulate a human approving the item
WorkflowInstance completed = engine.completeCurrentNode(workflow, instance,
    new NodeResult(NodeResultStatus.COMPLETED, Map.of("decision", "approve")));

System.out.println(completed.status());        // COMPLETED
System.out.println(completed.currentNodeId()); // end-approved
```

## Display in the Visual Editor

```tsx
import { WorkflowEditor, WorkflowViewer } from '@apitomy/flow-ui';

// Edit mode — drag-and-drop workflow builder
function MyEditor() {
  const [workflow, setWorkflow] = useState(myWorkflow);

  return (
    <WorkflowEditor
      workflow={workflow}
      onChange={setWorkflow}
      onValidationChange={(problems) => {
        console.log('Validation:', problems);
      }}
    />
  );
}

// View mode — read-only instance visualization
function MyViewer() {
  return (
    <WorkflowViewer
      workflow={myWorkflow}
      instance={myInstance}
    />
  );
}
```

## Next Steps

- [Workflow Model](../user-guide/workflow-model.md) — understand nodes, edges, and conditions
- [Engine Usage](../user-guide/engine-usage.md) — full API reference
- [Node Executors](../user-guide/node-executors.md) — implement automated action nodes
- [Visual Editor](../user-guide/visual-editor.md) — editor component props and features
