package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class AsyncActionNodeTest {

    @ParameterizedTest
    @ValueSource(strings = {"omitted", "null", "context-key"})
    void asyncRequiredOutputUsesSameValidationAsSync(String invalidOutput) {
        Map<String, Object> output = switch (invalidOutput) {
            case "null" -> Collections.singletonMap("answer", null);
            case "context-key" -> Map.of("savedAnswer", "wrong-key");
            default -> Map.of("unrelated", "must-not-merge");
        };
        Workflow workflow = requiredOutputWorkflow();
        WorkflowEngine sync = engine(resultExecutor(() -> new NodeResult(NodeResultStatus.COMPLETED, output)));
        WorkflowInstance syncResult = sync.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.FAILED, syncResult.status());

        List<String> completedNodes = new ArrayList<>();
        WorkflowEventListener listener = new WorkflowEventListener() {
            /** Records successful completion notifications. */
            public void onNodeCompleted(WorkflowInstance instance, WorkflowNode node, NodeResult result) {
                completedNodes.add(node.id());
            }
        };
        WorkflowEngine async = new WorkflowEngine(NodeExecutorProvider.fromList(pendingExecutor("test")),
            List.of(listener), null);
        // Existing context must not substitute for required values in the completion payload.
        WorkflowInstance waiting = async.startWorkflow(workflow, Map.of("answer", "old", "savedAnswer", "old"));
        WorkflowInstance result = async.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, output));

        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(syncResult.failureReason(), result.failureReason());
        assertEquals(waiting.context(), result.context());
        assertEquals(waiting.history(), result.history());
        assertFalse(completedNodes.contains("action"));
    }

    @Test
    void partialPendingOutputRemainsAllowedAndValidCompletionUsesDeclaredNames() {
        Workflow workflow = requiredOutputWorkflow();
        WorkflowEngine engine = engine(pendingExecutor("test"));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, waiting.status());
        WorkflowInstance partial = engine.completeNode(workflow, waiting, "action",
            new NodeResult(NodeResultStatus.PENDING, Map.of("progress", 50)));
        assertEquals(InstanceStatus.WAITING, partial.status());
        assertEquals(50, partial.context().get("progress"));
        assertEquals(waiting.history(), partial.history());
        assertEquals(waiting.activeBranches(), partial.activeBranches());

        WorkflowInstance completed = engine.completeNode(workflow, partial, "action",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("answer", "done")));
        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("done", completed.context().get("savedAnswer"));
        assertFalse(completed.context().containsKey("answer"));
        assertEquals(Map.of("savedAnswer", "done"), completed.history().get(1).output());
    }

    @ParameterizedTest
    @ValueSource(strings = {"retry-pending", "retry-success", "retry-exhausted", "transition", "cycle", "throw"})
    void invalidAsyncOutputUsesBoundedRecoveryAndPreservesParkedSibling(String recovery) {
        AtomicInteger attempts = new AtomicInteger();
        AtomicInteger errors = new AtomicInteger();
        NodeResult invalid = new NodeResult(NodeResultStatus.COMPLETED, Map.of("unrelated", "rejected"));
        NodeExecutor executor = resultExecutor(() -> {
            int attempt = attempts.incrementAndGet();
            if (attempt == 1 || recovery.equals("retry-pending")) {
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
            return recovery.equals("retry-success")
                ? new NodeResult(NodeResultStatus.COMPLETED, Map.of("answer", "recovered")) : invalid;
        });
        WorkflowErrorHandler handler = new WorkflowErrorHandler() {
            /** Recovers invalid results using the same result/exception contract as synchronous validation. */
            public ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node,
                                                    NodeResult result, Exception error) {
                assertSame(invalid, result);
                WorkflowError diagnostic = assertInstanceOf(WorkflowError.class, error);
                assertEquals(WorkflowError.Phase.OUTPUT_VALIDATION, diagnostic.phase());
                assertEquals("answer", diagnostic.field());
                assertEquals("action", node.id());
                int count = errors.incrementAndGet();
                if (count >= 150) return ErrorResolution.fail(); // Probe fail-safe for a broken budget.
                return switch (recovery) {
                    case "transition" -> ErrorResolution.transitionTo("repair");
                    case "cycle" -> ErrorResolution.transitionTo("action");
                    case "throw" -> throw new IllegalStateException("handler exploded");
                    default -> ErrorResolution.retry();
                };
            }
            /** Fails unexpected routing errors. */
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node) {
                return ErrorResolution.fail();
            }
        };
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), requiredOutputNode(), humanTaskNode("sibling"),
                humanTaskNode("repair"), endNode("end")),
            List.of(edge("start-action", "start", "action"), edge("start-sibling", "start", "sibling"),
                edge("action-repair", "action", "repair"), edge("repair-end", "repair", "end"),
                edge("sibling-end", "sibling", "end")));
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(), handler);
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        HistoryEntry sibling = waiting.history().getLast();
        WorkflowInstance result = engine.completeNode(workflow, waiting, "action", invalid);

        assertTrue(errors.get() > 0, "Invalid async output must reach the error handler");
        assertFalse(result.context().containsKey("unrelated"));
        assertTrue(result.activeBranches().contains(new ActiveBranch(sibling.branchId(), "sibling")));
        assertEquals(sibling, result.history().stream().filter(h -> h.nodeId().equals("sibling")).findFirst().orElseThrow());
        assertNull(sibling.completedOn());
        if (recovery.equals("cycle") || recovery.equals("retry-exhausted") || recovery.equals("throw")) {
            assertEquals(InstanceStatus.FAILED, result.status());
            String reason = recovery.equals("cycle") ? "transition limit"
                : recovery.equals("retry-exhausted") ? "retry limit" : "Error handler threw";
            assertTrue(result.failureReason().contains(reason), result.failureReason());
            assertTrue(errors.get() < 150);
        } else {
            assertEquals(InstanceStatus.WAITING, result.status());
            assertEquals(1, errors.get());
            assertEquals(recovery.equals("transition") ? 1 : 2, attempts.get());
            assertNotNull(engine.getHumanTaskInfo(workflow, result, "sibling"));
            if (recovery.equals("retry-pending")) {
                assertEquals(waiting.history(), result.history());
                assertNotNull(engine.getActionInfo(workflow, result, "action"));
            } else {
                assertNotNull(engine.getHumanTaskInfo(workflow, result, "repair"));
                assertNotNull(result.history().get(1).completedOn());
            }
        }
    }

    private WorkflowNode requiredOutputNode() {
        return actionNode("action", "test", Map.of(),
            List.of(Map.of("name", "answer", "type", "string", "required", true, "contextKey", "savedAnswer")));
    }

    private Workflow requiredOutputWorkflow() {
        return new Workflow("w", "W", null, null,
            List.of(startNode("start"), requiredOutputNode(), endNode("end")),
            List.of(edge("start-action", "start", "action"), edge("action-end", "action", "end")));
    }

    private NodeExecutor resultExecutor(Supplier<NodeResult> result) {
        return new NodeExecutor() {
            /** Identifies the test action. */
            public String actionType() { return "test"; }
            /** Returns the next test result. */
            public NodeResult execute(NodeExecutionContext context) { return result.get(); }
        };
    }

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
