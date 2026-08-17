package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowEngineStartTest {

    private WorkflowEngine engine(NodeExecutor... executors) {
        return new WorkflowEngine(List.of(executors), List.of(), null);
    }

    private WorkflowEngine engine(List<NodeExecutor> executors, List<WorkflowEventListener> listeners) {
        return new WorkflowEngine(executors, listeners, null);
    }

    private NodeExecutor echoExecutor(String actionType) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("executed", actionType));
            }
        };
    }

    @Test
    void startSimpleWorkflowReachesHumanTask() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals("task", instance.currentNodeId());
        assertNotNull(instance.id());
        assertEquals("wf-2", instance.workflowId());
    }

    @Test
    void startWorkflowChainsActionNodes() {
        WorkflowEngine engine = engine(echoExecutor("step1"), echoExecutor("step2"));
        Workflow workflow = new Workflow("w", "W", null,
            List.of(startNode("start"), actionNode("a1", "step1"), actionNode("a2", "step2"), endNode("end")),
            List.of(edge("e1", "start", "a1"), edge("e2", "a1", "a2"), edge("e3", "a2", "end")));

        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, instance.status());
        assertEquals("step2", instance.context().get("executed"));
        assertTrue(instance.history().size() >= 3);
    }

    @Test
    void startWorkflowWithConditionalEdges() {
        WorkflowEngine engine = engine(echoExecutor("left"), echoExecutor("right"));
        Workflow workflow = new Workflow("w", "W", null,
            List.of(
                startNode("start", List.of(inputDef("branch", "string", true))),
                actionNode("left", "left"), actionNode("right", "right"), endNode("end")),
            List.of(
                edge("e1", "start", "left", "context.branch == 'left'", 1),
                defaultEdge("e2", "start", "right"),
                edge("e3", "left", "end"), edge("e4", "right", "end")));

        WorkflowInstance leftResult = engine.startWorkflow(workflow, Map.of("branch", "left"));
        assertEquals("left", leftResult.context().get("executed"));

        WorkflowInstance rightResult = engine.startWorkflow(workflow, Map.of("branch", "right"));
        assertEquals("right", rightResult.context().get("executed"));
    }

    @Test
    void startWorkflowValidatesDefinition() {
        WorkflowEngine engine = engine();
        Workflow invalid = new Workflow("w", "W", null,
            List.of(actionNode("orphan", "test")), List.of());
        assertThrows(Exception.class, () -> engine.startWorkflow(invalid, Map.of()));
    }

    @Test
    void startWorkflowValidatesRequiredInputs() {
        WorkflowEngine engine = engine();
        Workflow workflow = new Workflow("w", "W", null,
            List.of(
                startNode("start", List.of(inputDef("required", "string", true))),
                endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertThrows(Exception.class, () -> engine.startWorkflow(workflow, Map.of()));
    }

    @Test
    void startWorkflowWithCallerProvidedId() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of(), "my-custom-id");
        assertEquals("my-custom-id", instance.id());
    }

    @Test
    void startWorkflowFiresEvents() {
        List<String> events = new ArrayList<>();
        WorkflowEventListener listener = new WorkflowEventListener() {
            public void onWorkflowStarted(WorkflowInstance i) { events.add("started"); }
            public void onNodeEntered(WorkflowInstance i, WorkflowNode n) { events.add("entered:" + n.id()); }
            public void onNodeCompleted(WorkflowInstance i, WorkflowNode n, NodeResult r) { events.add("completed:" + n.id()); }
            public void onEdgeFollowed(WorkflowInstance i, WorkflowEdge e) { events.add("edge:" + e.id()); }
            public void onWorkflowCompleted(WorkflowInstance i) { events.add("workflow-completed"); }
        };
        WorkflowEngine engine = engine(List.of(echoExecutor("test")), List.of(listener));
        Workflow workflow = simpleActionWorkflow("test");
        engine.startWorkflow(workflow, Map.of());

        assertTrue(events.contains("started"));
        assertTrue(events.contains("entered:start"));
        assertTrue(events.contains("entered:action"));
        assertTrue(events.contains("entered:end"));
        assertTrue(events.contains("workflow-completed"));
    }

    @Test
    void safetyLimitPreventsInfiniteLoops() {
        NodeExecutor loopExecutor = new NodeExecutor() {
            private int count = 0;
            public String actionType() { return "loop"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                count++;
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("count", count));
            }
        };
        WorkflowEngine engine = engine(loopExecutor);
        // Create a workflow with a conditional loop that always evaluates to true
        Workflow workflow = new Workflow("w", "W", null,
            List.of(startNode("start"), actionNode("a", "loop"), endNode("end")),
            List.of(edge("e1", "start", "a"),
                    edge("e2", "a", "a", "context.count < 200", 0),
                    defaultEdge("e3", "a", "end")));

        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertNotNull(result.failureReason());
        assertTrue(result.failureReason().contains("transition limit"));
    }

    @Test
    void historyRecordsEdgeInfo() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertTrue(instance.history().size() >= 2);
        HistoryEntry taskEntry = instance.history().stream()
            .filter(h -> h.nodeId().equals("task")).findFirst().orElseThrow();
        assertEquals("e1", taskEntry.edgeId());
    }
}
