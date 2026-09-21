package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/** Verifies that introspection only exposes active, parked node activations. */
class WorkflowEngineEligibilityTest {

    @ParameterizedTest
    @EnumSource(value = NodeType.class, names = {"ACTION", "HUMAN_TASK", "RECEIVE_EVENT", "WAIT"})
    void futureAndPreviouslyCompletedNodesAreIneligible(NodeType type) {
        WorkflowEngine engine = engine();
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), parkedNode("first", type), parkedNode("future", type), endNode("end")),
            List.of(edge("start-first", "start", "first"), edge("first-future", "first", "future"),
                edge("future-end", "future", "end")));
        WorkflowInstance first = engine.startWorkflow(workflow, Map.of());
        assertEligible(engine, workflow, first, type, "first");
        assertIneligible(engine, workflow, first, "future");
        assertIneligible(engine, workflow, first, "missing");
        assertIneligible(engine, workflow, first, null);
        assertIneligible(engine, workflow, first, "start");

        WorkflowInstance future = engine.completeNode(workflow, first, "first",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));
        assertEligible(engine, workflow, future, type, "future");
        assertIneligible(engine, workflow, future, "first");
    }

    @ParameterizedTest
    @EnumSource(value = NodeType.class, names = {"ACTION", "HUMAN_TASK", "RECEIVE_EVENT", "WAIT"})
    void activeSiblingQueriesRespectNodeTypeAndRemainEligibleAfterOtherBranchCompletes(NodeType type) {
        WorkflowEngine engine = engine();
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), parkedNode("left", type), parkedNode("right", type), endNode("end")),
            List.of(edge("start-left", "start", "left"), edge("start-right", "start", "right"),
                edge("left-end", "left", "end"), edge("right-end", "right", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        assertNull(waiting.currentNodeId());
        assertEligible(engine, workflow, waiting, type, "left");
        assertEligible(engine, workflow, waiting, type, "right");
        WorkflowInstance afterLeft = engine.completeNode(workflow, waiting, "left",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));
        assertEquals(InstanceStatus.WAITING, afterLeft.status());
        assertIneligible(engine, workflow, afterLeft, "left");
        assertEligible(engine, workflow, afterLeft, type, "right");
    }

    @ParameterizedTest
    @EnumSource(value = NodeType.class, names = {"ACTION", "HUMAN_TASK", "RECEIVE_EVENT", "WAIT"})
    void activeMembershipAlsoRequiresLatestHistoryForThatBranchToBeOpen(NodeType type) {
        WorkflowEngine engine = engine();
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), parkedNode("node", type), endNode("end")),
            List.of(edge("start-node", "start", "node"), edge("node-end", "node", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        HistoryEntry open = waiting.history().getLast();
        HistoryEntry closed = new HistoryEntry(open.nodeId(), open.nodeName(), open.edgeId(), open.edgeCondition(),
            open.enteredOn(), Instant.now(), Map.of(), open.branchId());
        assertIneligible(engine, workflow, waiting.toBuilder().addHistory(closed).build(), "node");
        assertIneligible(engine, workflow, waiting.toBuilder().history(List.of()).build(), "node");
        assertIneligible(engine, workflow, waiting.toBuilder()
            .activeBranches(List.of(new ActiveBranch("other", "node"))).build(), "node");
        for (InstanceStatus status : InstanceStatus.values()) {
            if (status != InstanceStatus.WAITING) {
                assertIneligible(engine, workflow, waiting.toBuilder().status(status).build(), "node");
            }
        }
    }

    private void assertEligible(WorkflowEngine engine, Workflow workflow, WorkflowInstance instance,
                                NodeType type, String nodeId) {
        assertEquals(type == NodeType.ACTION, engine.getActionInfo(workflow, instance, nodeId) != null);
        assertEquals(type == NodeType.HUMAN_TASK, engine.getHumanTaskInfo(workflow, instance, nodeId) != null);
        assertEquals(type == NodeType.WAIT, engine.getWaitInfo(workflow, instance, nodeId) != null);
        assertEquals(type == NodeType.RECEIVE_EVENT, engine.getReceiveEventInfo(workflow, instance, nodeId) != null);
        assertEquals(type == NodeType.RECEIVE_EVENT,
            engine.matchesEvent(workflow, instance, nodeId, Map.of("type", "approved")));
        assertEquals(type == NodeType.ACTION, engine.getActionInfo(workflow, instance) != null);
        assertEquals(type == NodeType.HUMAN_TASK, engine.getHumanTaskInfo(workflow, instance) != null);
        assertEquals(type == NodeType.WAIT, engine.getWaitInfo(workflow, instance) != null);
        assertEquals(type == NodeType.RECEIVE_EVENT, engine.getReceiveEventInfo(workflow, instance) != null);
        assertEquals(type == NodeType.RECEIVE_EVENT,
            engine.matchesEvent(workflow, instance, Map.of("type", "approved")));
    }

    private void assertIneligible(WorkflowEngine engine, Workflow workflow, WorkflowInstance instance, String nodeId) {
        assertAll("Ineligible node " + nodeId,
            () -> assertNull(engine.getActionInfo(workflow, instance, nodeId)),
            () -> assertNull(engine.getHumanTaskInfo(workflow, instance, nodeId)),
            () -> assertNull(engine.getWaitInfo(workflow, instance, nodeId)),
            () -> assertNull(engine.getReceiveEventInfo(workflow, instance, nodeId)),
            () -> assertFalse(engine.matchesEvent(workflow, instance, nodeId, Map.of("type", "approved"))));
    }

    private WorkflowNode parkedNode(String id, NodeType type) {
        return switch (type) {
            case ACTION -> actionNode(id, "pending");
            case HUMAN_TASK -> humanTaskNode(id);
            case RECEIVE_EVENT -> receiveEventNode(id, "approved");
            case WAIT -> waitNode(id, "PT1M");
            default -> throw new IllegalArgumentException("Unsupported parked type: " + type);
        };
    }

    private WorkflowEngine engine() {
        NodeExecutor executor = new NodeExecutor() {
            /** Identifies the pending action type. */
            public String actionType() { return "pending"; }
            /** Parks the action for external completion. */
            public NodeResult execute(NodeExecutionContext context) {
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };
        return new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(), null);
    }
}
