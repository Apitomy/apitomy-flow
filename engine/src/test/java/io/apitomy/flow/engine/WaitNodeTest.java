package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests the Wait node type: the engine pauses at wait nodes, getWaitInfo
 * returns duration and node metadata, completeCurrentNode resumes execution,
 * and null is returned for non-wait wait states.
 */
class WaitNodeTest {

    private final WorkflowEngine engine = new WorkflowEngine(
        NodeExecutorProvider.fromList(), List.of(), null);

    private Workflow waitWorkflow(String duration) {
        return new Workflow("w", "W", null,
            List.of(
                startNode("start", List.of(inputDef("input", "string", true))),
                waitNode("delay", duration),
                endNode("end")),
            List.of(edge("e1", "start", "delay"), edge("e2", "delay", "end")));
    }

    @Test
    void enginePausesAtWaitNode() {
        WorkflowInstance instance = engine.startWorkflow(
            waitWorkflow("PT30M"), Map.of("input", "test"));
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals("delay", instance.currentNodeId());
    }

    @Test
    void getWaitInfoReturnsDuration() {
        Workflow workflow = waitWorkflow("PT2H");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("input", "test"));

        WaitInfo info = engine.getWaitInfo(workflow, instance);
        assertNotNull(info);
        assertEquals("delay", info.nodeId());
        assertEquals("delay", info.nodeName());
        assertEquals(Duration.ofHours(2), info.duration());
    }

    @Test
    void completeWaitNodeResumesExecution() {
        Workflow workflow = waitWorkflow("PT30M");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("input", "test"));

        WorkflowInstance completed = engine.completeCurrentNode(workflow, instance,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));
        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("end", completed.currentNodeId());
    }

    @Test
    void getWaitInfoReturnsNullForHumanTask() {
        Workflow workflow = new Workflow("w", "W", null,
            List.of(startNode("start"), humanTaskNode("ht"), endNode("end")),
            List.of(edge("e1", "start", "ht"), edge("e2", "ht", "end")));
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        assertNull(engine.getWaitInfo(workflow, instance));
    }

    @Test
    void getWaitInfoReturnsNullForCompletedInstance() {
        Workflow workflow = waitWorkflow("PT1M");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("input", "test"));
        instance = engine.completeCurrentNode(workflow, instance,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));
        assertEquals(InstanceStatus.COMPLETED, instance.status());
        assertNull(engine.getWaitInfo(workflow, instance));
    }

    @Test
    void waitNodeChainedWithActions() {
        NodeExecutor executor = new NodeExecutor() {
            public String actionType() { return "process"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED,
                    Map.of("processed", true));
            }
        };
        WorkflowEngine eng = new WorkflowEngine(
            NodeExecutorProvider.fromList(executor), List.of(), null);

        Workflow workflow = new Workflow("w", "W", null,
            List.of(
                startNode("start", List.of(inputDef("input", "string", true))),
                actionNode("act", "process"),
                waitNode("delay", "P1D"),
                endNode("end")),
            List.of(
                edge("e1", "start", "act"),
                edge("e2", "act", "delay"),
                edge("e3", "delay", "end")));

        WorkflowInstance instance = eng.startWorkflow(workflow, Map.of("input", "test"));
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals("delay", instance.currentNodeId());
        assertTrue((Boolean) instance.context().get("processed"));

        WaitInfo info = eng.getWaitInfo(workflow, instance);
        assertEquals(Duration.ofDays(1), info.duration());

        instance = eng.completeCurrentNode(workflow, instance,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));
        assertEquals(InstanceStatus.COMPLETED, instance.status());
    }
}
