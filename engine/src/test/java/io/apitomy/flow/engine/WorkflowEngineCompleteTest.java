package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowEngineCompleteTest {

    private WorkflowEngine engine(NodeExecutor... executors) {
        return new WorkflowEngine(List.of(executors), List.of(), null);
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
        Workflow workflow = new Workflow("w", "W", null,
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
        WorkflowEngine engine = new WorkflowEngine(List.of(), List.of(listener), null);
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
