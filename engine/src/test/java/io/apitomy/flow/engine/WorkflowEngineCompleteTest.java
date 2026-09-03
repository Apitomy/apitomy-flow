package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests workflow completion and cancellation scenarios: advancing past human tasks,
 * chaining action nodes after completion, rejecting completion on non-waiting instances,
 * cancelling workflows, and verifying instance immutability.
 */
class WorkflowEngineCompleteTest {

    private WorkflowEngine engine(NodeExecutor... executors) {
        return new WorkflowEngine(NodeExecutorProvider.fromList(executors), List.of(), null);
    }

    @Test
    void completeHumanTaskAdvancesToEnd() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, waiting.status());

        NodeResult result = new NodeResult(NodeResultStatus.COMPLETED, Map.of("approved", true));
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting, result);

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertTrue((Boolean) completed.context().get("approved"));
    }

    @Test
    void completeNodeChainsActions() {
        NodeExecutor executor = new NodeExecutor() {
            public String actionType() { return "process"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("processed", true));
            }
        };
        WorkflowEngine engine = engine(executor);
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), humanTaskNode("task"), actionNode("process", "process"), endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "process"), edge("e3", "process", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("input", "data")));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertTrue((Boolean) completed.context().get("processed"));
    }

    @Test
    void completeNonWaitingThrows() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));

        assertThrows(IllegalStateException.class, () ->
            engine.completeCurrentNode(workflow, completed,
                new NodeResult(NodeResultStatus.COMPLETED, Map.of())));
    }

    @Test
    void cancelWaitingWorkflow() {
        List<String> events = new ArrayList<>();
        WorkflowEventListener listener = new WorkflowEventListener() {
            public void onWorkflowCancelled(WorkflowInstance i) { events.add("cancelled"); }
        };
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(listener), null);
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        WorkflowInstance cancelled = engine.cancelWorkflow(workflow, waiting);
        assertEquals(InstanceStatus.CANCELLED, cancelled.status());
        assertTrue(events.contains("cancelled"));
    }

    @Test
    void cancelTerminalWorkflowIsNoOp() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));

        WorkflowInstance result = engine.cancelWorkflow(workflow, completed);
        assertEquals(InstanceStatus.COMPLETED, result.status());
    }

    @Test
    void nonStringInputValuesPassedThroughUnchanged() {
        AtomicReference<Map<String, Object>> captured = new AtomicReference<>();
        NodeExecutor executor = new NodeExecutor() {
            public String actionType() { return "capture"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                captured.set(ctx.inputs());
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            }
        };
        WorkflowEngine engine = engine(executor);

        Map<String, Object> nestedMap = Map.of("key", "value");
        List<String> listValue = List.of("a", "b");
        Map<String, Object> inputs = Map.of(
            "mapInput", nestedMap,
            "listInput", listValue,
            "numberInput", 42,
            "boolInput", true,
            "stringExpr", "context.foo"
        );
        WorkflowNode action = new WorkflowNode("action", NodeType.ACTION, "action",
            Map.of("actionType", "capture", "inputs", inputs), new Position(100, 0));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), action, endNode("end")),
            List.of(edge("e1", "start", "action"), edge("e2", "action", "end")));

        engine.startWorkflow(workflow, Map.of("foo", "bar"));

        Map<String, Object> resolved = captured.get();
        assertNotNull(resolved);
        // Non-string values are preserved as-is (not mangled via String.valueOf)
        assertEquals(nestedMap, resolved.get("mapInput"));
        assertEquals(listValue, resolved.get("listInput"));
        assertEquals(42, resolved.get("numberInput"));
        assertEquals(true, resolved.get("boolInput"));
        // String values are still resolved as EL expressions
        assertEquals("bar", resolved.get("stringExpr"));
    }

    @Test
    void inputInstanceNotMutated() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        String originalNodeId = waiting.currentNodeId();

        engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));

        assertEquals(originalNodeId, waiting.currentNodeId());
        assertEquals(InstanceStatus.WAITING, waiting.status());
    }
}
