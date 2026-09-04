package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class AsyncActionNodeTest {

    private WorkflowEngine engine(NodeExecutor... executors) {
        return new WorkflowEngine(NodeExecutorProvider.fromList(executors), List.of(), null);
    }

    private NodeExecutor pendingExecutor(String actionType) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.PENDING, Map.of("correlationId", "req-42"));
            }
        };
    }

    private NodeExecutor syncExecutor(String actionType) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("executed", actionType));
            }
        };
    }

    @Test
    void pendingResultPausesAtActionNode() {
        WorkflowEngine engine = engine(pendingExecutor("agent-call"));
        Workflow workflow = simpleActionWorkflow("agent-call");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals("action", instance.currentNodeId());
    }

    @Test
    void pendingResultMergesOutputIntoContext() {
        WorkflowEngine engine = engine(pendingExecutor("agent-call"));
        Workflow workflow = simpleActionWorkflow("agent-call");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertEquals("req-42", instance.context().get("correlationId"));
    }

    @Test
    void completeCurrentNodeResumesFromPendingAction() {
        WorkflowEngine engine = engine(pendingExecutor("agent-call"));
        Workflow workflow = simpleActionWorkflow("agent-call");
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.WAITING, waiting.status());

        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("agentResult", "done")));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("end", completed.currentNodeId());
        assertEquals("done", completed.context().get("agentResult"));
    }

    @Test
    void getActionInfoReturnsPendingActionDetails() {
        WorkflowEngine engine = engine(pendingExecutor("agent-call"));
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(
                startNode("start"),
                actionNode("a", "agent-call",
                    Map.of("prompt", "context.userPrompt"),
                    List.of(inputDef("response", "string", true))),
                endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));

        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("userPrompt", "Analyze this CVE"));

        ActionInfo info = engine.getActionInfo(workflow, instance);
        assertNotNull(info);
        assertEquals("a", info.nodeId());
        assertEquals("agent-call", info.actionType());
        assertEquals("Analyze this CVE", info.resolvedInputs().get("prompt"));
        assertEquals(1, info.expectedOutputs().size());
        assertEquals("response", info.expectedOutputs().get(0).name());
        assertTrue(info.expectedOutputs().get(0).required());
    }

    @Test
    void getActionInfoReturnsNullForHumanTask() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertNull(engine.getActionInfo(workflow, instance));
    }

    @Test
    void getActionInfoReturnsNullForNonWaiting() {
        WorkflowEngine engine = engine(syncExecutor("test"));
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, instance.status());
        assertNull(engine.getActionInfo(workflow, instance));
    }

    @Test
    void pendingActionThenSyncActionChains() {
        WorkflowEngine engine = engine(pendingExecutor("async-step"), syncExecutor("sync-step"));
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(
                startNode("start"),
                actionNode("a1", "async-step"),
                actionNode("a2", "sync-step"),
                endNode("end")),
            List.of(
                edge("e1", "start", "a1"),
                edge("e2", "a1", "a2"),
                edge("e3", "a2", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, waiting.status());
        assertEquals("a1", waiting.currentNodeId());

        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("step1", "done")));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("end", completed.currentNodeId());
        assertEquals("done", completed.context().get("step1"));
        assertEquals("sync-step", completed.context().get("executed"));
    }

    @Test
    void failedResultFailsWorkflowWithDefaultHandler() {
        boolean[] failed = {false};
        WorkflowEventListener listener = new WorkflowEventListener() {
            public void onWorkflowFailed(WorkflowInstance i, Exception e) {
                failed[0] = true;
            }
        };
        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(pendingExecutor("agent-call")), List.of(listener), null);
        Workflow workflow = simpleActionWorkflow("agent-call");
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.WAITING, waiting.status());

        WorkflowInstance result = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.FAILED, Map.of("error", "boom")));

        assertEquals(InstanceStatus.FAILED, result.status());
        assertNotNull(result.failureReason());
        assertTrue(failed[0], "onWorkflowFailed should fire");
    }

    @Test
    void failedResultRoutesToErrorNodeViaTransition() {
        WorkflowErrorHandler transitionHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("error-end");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start", List.of()), actionNode("action", "agent-call"),
                    endNode("end"), endNode("error-end")),
            List.of(edge("e1", "start", "action"), edge("e2", "action", "end", "true", 1),
                    defaultEdge("e3", "action", "error-end")));

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(pendingExecutor("agent-call")), List.of(), transitionHandler);
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.WAITING, waiting.status());

        WorkflowInstance result = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.FAILED, Map.of()));

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals("error-end", result.currentNodeId());
    }

    @Test
    void failedResultWithRetryReDispatchesAction() {
        WorkflowErrorHandler retryHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.retry();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };
        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(pendingExecutor("agent-call")), List.of(), retryHandler);
        Workflow workflow = simpleActionWorkflow("agent-call");
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        // A FAILED result with a RETRY resolution should re-dispatch the (async) action,
        // which returns PENDING again and re-parks the instance rather than completing it.
        WorkflowInstance result = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.FAILED, Map.of()));

        assertEquals(InstanceStatus.WAITING, result.status());
        assertEquals("action", result.currentNodeId());
    }

    @Test
    void pendingResultDeliveredToCompleteCurrentNodeReparks() {
        WorkflowEngine engine = engine(pendingExecutor("agent-call"));
        Workflow workflow = simpleActionWorkflow("agent-call");
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.WAITING, waiting.status());

        WorkflowInstance result = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.PENDING, Map.of("progress", "50%")));

        assertEquals(InstanceStatus.WAITING, result.status());
        assertEquals("action", result.currentNodeId());
        assertEquals("50%", result.context().get("progress"));
    }

    @Test
    void pendingWithEmptyOutputDoesNotFail() {
        NodeExecutor emptyPending = new NodeExecutor() {
            public String actionType() { return "agent"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };

        WorkflowEngine engine = engine(emptyPending);
        Workflow workflow = simpleActionWorkflow("agent");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.WAITING, instance.status());
    }
}
