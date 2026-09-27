package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.EnumSource;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;
import java.util.function.Function;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests error handling in the workflow engine: default failure behavior for node errors
 * and executor exceptions, retry resolution, transition-to-error-node resolution,
 * invalid error transitions, error handler exceptions, and verification that the
 * handler receives the correct result or exception.
 */
class WorkflowEngineErrorTest {

    @ParameterizedTest(name = "two-action cycle={0}")
    @ValueSource(booleans = {false, true})
    void recoveryCyclesExhaustTransitionBudget(boolean twoActions) {
        List<String> failures = new ArrayList<>();
        WorkflowErrorHandler handler = new WorkflowErrorHandler() {
            /** Cycles until the engine budget stops recovery, with a probe-only fail-safe. */
            public ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node,
                                                    NodeResult result, Exception error) {
                failures.add(node.id());
                if (failures.size() >= 150) {
                    return ErrorResolution.fail();
                }
                return ErrorResolution.transitionTo(twoActions && node.id().equals("a") ? "b" : "a");
            }
            /** Fails unexpected routing errors. */
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node) {
                return ErrorResolution.fail();
            }
        };
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "fail"), actionNode("b", "fail"), endNode("end")),
            List.of(edge("start-a", "start", "a"), edge("a-b", "a", "b"), edge("b-end", "b", "end")));
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(failingExecutor("fail")),
            List.of(), handler);

        WorkflowInstance result = assertDoesNotThrow(() -> engine.startWorkflow(workflow, Map.of()));

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("transition limit"), result.failureReason());
        assertTrue(failures.size() <= 100, "Recovery must stop within the shared transition budget");
        assertTrue(result.history().stream().allMatch(entry -> entry.branchId().equals("root")));
        if (twoActions) {
            assertEquals(List.of("a", "b", "a", "b"), failures.subList(0, 4));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"exception", "invalid-output", "async-transition", "async-retry",
        "merge-completed", "merge-pending", "edge-error", "no-edge"})
    void everyRecoveryEntryPointUsesTheDriverBudget(String path) {
        AtomicInteger executions = new AtomicInteger();
        AtomicInteger errors = new AtomicInteger();
        NodeExecutor executor = testExecutor(context -> {
            int attempt = executions.incrementAndGet();
            if (path.startsWith("async") && attempt == 1) {
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
            if (path.equals("exception")) {
                throw new IllegalStateException("execution failed");
            }
            return new NodeResult(path.equals("invalid-output")
                ? NodeResultStatus.COMPLETED : NodeResultStatus.FAILED, Map.of());
        });
        WorkflowErrorHandler handler = recoveryHandler((node, count) -> {
            if (count >= 150) return ErrorResolution.fail();
            if (path.equals("async-retry") && count == 1) return ErrorResolution.retry();
            return ErrorResolution.transitionTo("action");
        }, errors);
        WorkflowNode action = actionNode("action", "test", Map.of(),
            path.equals("invalid-output") ? List.of(inputDef("required", "string", true)) : List.of());
        List<WorkflowNode> nodes = new ArrayList<>(List.of(startNode("start"), action, endNode("end")));
        List<WorkflowEdge> edges = new ArrayList<>(List.of(edge("action-end", "action", "end")));
        if (path.startsWith("merge")) {
            nodes.add(receiveEventNode("event", "approved", List.of(),
                List.of(Map.of("contextKey", "mapped", "expression", "event.amount + 1"))));
            edges.add(edge("start-event", "start", "event"));
            edges.add(edge("event-action", "event", "action"));
        } else {
            edges.add(edge("start-action", "start", "action",
                path.equals("edge-error") ? "1 +" : path.equals("no-edge") ? "false" : null, 0));
        }
        Workflow workflow = new Workflow("w", "W", null, null, nodes, edges);
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(), handler);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        if (path.startsWith("async")) {
            assertEquals(InstanceStatus.WAITING, result.status());
            result = engine.completeNode(workflow, result, "action", new NodeResult(NodeResultStatus.FAILED, Map.of()));
        } else if (path.startsWith("merge")) {
            assertEquals(InstanceStatus.WAITING, result.status());
            result = engine.completeNode(workflow, result, "event", new NodeResult(
                path.equals("merge-pending") ? NodeResultStatus.PENDING : NodeResultStatus.COMPLETED,
                Map.of("amount", "not-a-number")));
        }

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("transition limit"), result.failureReason());
        assertTrue(executions.get() <= 101, "At most 100 executions in this call plus an earlier pending call");
        assertTrue(errors.get() < 150, "The engine must stop before the probe's fail-safe");
    }

    @Test
    void recoveryAndOrdinaryEdgesShareOneBudget() {
        AtomicInteger executions = new AtomicInteger();
        NodeExecutor executor = testExecutor(context -> {
            int attempt = executions.incrementAndGet();
            return new NodeResult(attempt <= 60 ? NodeResultStatus.FAILED : NodeResultStatus.COMPLETED,
                Map.of("done", attempt >= 120));
        });
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("action", "test"), endNode("end")),
            List.of(edge("start-action", "start", "action"),
                edge("loop", "action", "action", "!context.done", 0), defaultEdge("end", "action", "end")));
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(),
            recoveryHandler((node, count) -> ErrorResolution.transitionTo("action"), new AtomicInteger()));

        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("transition limit"));
        assertEquals(100, executions.get(), "Recovery entries and normal moves consume the same 100 units");
    }

    @Test
    void eachExternalCompletionStartsAFreshRecoveryBudget() {
        AtomicInteger executions = new AtomicInteger();
        NodeExecutor executor = testExecutor(context -> new NodeResult(
            executions.incrementAndGet() % 60 == 0 ? NodeResultStatus.PENDING : NodeResultStatus.FAILED, Map.of()));
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(),
            recoveryHandler((node, count) -> ErrorResolution.transitionTo("action"), new AtomicInteger()));

        WorkflowInstance first = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, first.status());
        assertEquals(60, executions.get());
        WorkflowInstance second = engine.completeNode(workflow, first, "action",
            new NodeResult(NodeResultStatus.FAILED, Map.of()));

        assertEquals(InstanceStatus.WAITING, second.status());
        assertEquals(120, executions.get());
        assertNull(first.history().getLast().completedOn(), "Earlier immutable snapshot stays parked");
        assertNull(second.history().getLast().completedOn());
        assertEquals(InstanceStatus.COMPLETED, engine.completeNode(workflow, second, "action",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of())).status());
    }

    @ParameterizedTest
    @EnumSource(value = NodeType.class, names = {"HUMAN_TASK", "WAIT", "RECEIVE_EVENT", "ACTION"})
    void directRecoveryTargetsParkUntilExternalCompletion(NodeType targetType) {
        WorkflowNode target = switch (targetType) {
            case HUMAN_TASK -> humanTaskNode("target");
            case WAIT -> waitNode("target", "PT1M");
            case RECEIVE_EVENT -> receiveEventNode("target", "approved");
            case ACTION -> actionNode("target", "test");
            default -> throw new IllegalArgumentException("Unsupported target");
        };
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("action", "test"), target, endNode("end")),
            List.of(edge("start-action", "start", "action"), edge("action-target", "action", "target"),
                edge("target-end", "target", "end")));
        NodeExecutor executor = testExecutor(context -> new NodeResult(
            context.node().id().equals("target") ? NodeResultStatus.PENDING : NodeResultStatus.FAILED, Map.of()));
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(),
            recoveryHandler((node, count) -> ErrorResolution.transitionTo("target"), new AtomicInteger()));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.WAITING, waiting.status());
        assertEquals("target", waiting.currentNodeId());
        assertEquals(List.of(new ActiveBranch("root", "target")), waiting.activeBranches());
        assertEquals(List.of("start", "action", "target"),
            waiting.history().stream().map(HistoryEntry::nodeId).toList());
        assertNotNull(waiting.history().get(1).completedOn());
        assertNull(waiting.history().getLast().completedOn());
        assertNull(waiting.history().getLast().edgeId(), "Recovery entry must not fabricate a followed edge");
        assertEquals(InstanceStatus.COMPLETED, engine.completeNode(workflow, waiting, "target",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of())).status());
    }

    @ParameterizedTest
    @EnumSource(value = NodeType.class, names = {"HUMAN_TASK", "WAIT", "RECEIVE_EVENT", "ACTION", "END"})
    void mergeErrorRecoveryRunsMultiStepChainThenEntersTarget(NodeType targetType) {
        WorkflowNode target = switch (targetType) {
            case HUMAN_TASK -> humanTaskNode("target");
            case WAIT -> waitNode("target", "PT1M");
            case RECEIVE_EVENT -> receiveEventNode("target", "approved");
            case ACTION -> actionNode("target", "test");
            case END -> endNode("target");
            default -> throw new IllegalArgumentException("Unsupported target");
        };
        List<WorkflowNode> nodes = new ArrayList<>(List.of(startNode("start"),
            receiveEventNode("event", "approved", List.of(),
                List.of(Map.of("contextKey", "mapped", "expression", "event.amount + 1"))),
            actionNode("recovery", "test"), actionNode("cleanup", "test"), target));
        List<WorkflowEdge> edges = new ArrayList<>(List.of(edge("start-event", "start", "event"),
            edge("event-recovery", "event", "recovery"), edge("recovery-cleanup", "recovery", "cleanup"),
            edge("cleanup-target", "cleanup", "target")));
        if (targetType != NodeType.END) {
            nodes.add(endNode("end"));
            edges.add(edge("target-end", "target", "end"));
        }
        Workflow workflow = new Workflow("w", "W", null, null, nodes, edges);
        NodeExecutor executor = testExecutor(context -> new NodeResult(
            context.node().id().equals("target") ? NodeResultStatus.PENDING : NodeResultStatus.COMPLETED,
            Map.of(context.node().id(), true)));
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(),
            recoveryHandler((node, count) -> ErrorResolution.transitionTo("recovery"), new AtomicInteger()));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        WorkflowInstance result = engine.completeNode(workflow, waiting, "event",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("amount", "not-a-number")));

        assertEquals(targetType == NodeType.END ? InstanceStatus.COMPLETED : InstanceStatus.WAITING, result.status());
        assertEquals("target", result.currentNodeId());
        assertEquals(true, result.context().get("recovery"));
        assertEquals(true, result.context().get("cleanup"));
        assertEquals(List.of("start", "event", "recovery", "cleanup", "target"),
            result.history().stream().map(HistoryEntry::nodeId).toList());
        assertTrue(result.history().stream().allMatch(entry -> entry.branchId().equals("root")));
        if (targetType != NodeType.END) {
            assertNull(result.history().getLast().completedOn());
            result = engine.completeNode(workflow, result, "target", new NodeResult(NodeResultStatus.COMPLETED, Map.of()));
            assertEquals(InstanceStatus.COMPLETED, result.status());
        }
    }

    private NodeExecutor testExecutor(Function<NodeExecutionContext, NodeResult> execute) {
        return new NodeExecutor() {
            /** Identifies the test action type. */
            public String actionType() { return "test"; }
            /** Supplies the result for this activation. */
            public NodeResult execute(NodeExecutionContext context) { return execute.apply(context); }
        };
    }

    private WorkflowErrorHandler recoveryHandler(BiFunction<WorkflowNode, Integer, ErrorResolution> recover,
                                                  AtomicInteger errors) {
        return new WorkflowErrorHandler() {
            /** Selects recovery for a node failure. */
            public ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node,
                                                    NodeResult result, Exception error) {
                return recover.apply(node, errors.incrementAndGet());
            }
            /** Selects recovery when routing cannot continue. */
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node) {
                return recover.apply(node, errors.incrementAndGet());
            }
        };
    }

    private NodeExecutor failingExecutor(String actionType) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.FAILED, Map.of("error", "something broke"));
            }
        };
    }

    private NodeExecutor throwingExecutor(String actionType) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                throw new RuntimeException("executor exploded");
            }
        };
    }

    @Test
    void defaultHandlerFailsWorkflowOnNodeError() {
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(failingExecutor("test")), List.of(), null);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertNotNull(result.failureReason());
    }

    @Test
    void defaultHandlerFailsWorkflowOnException() {
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(throwingExecutor("test")), List.of(), null);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
    }

    @Test
    void retryReExecutesNode() {
        int[] callCount = {0};
        NodeExecutor retryableExecutor = new NodeExecutor() {
            public String actionType() { return "test"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                callCount[0]++;
                if (callCount[0] < 3) {
                    return new NodeResult(NodeResultStatus.FAILED, Map.of());
                }
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("done", true));
            }
        };

        WorkflowErrorHandler retryHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.retry();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(retryableExecutor), List.of(), retryHandler);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(3, callCount[0]);
    }

    @Test
    void transitionToErrorNode() {
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
            List.of(startNode("start", List.of()), actionNode("a", "fail"), endNode("end"), endNode("error-end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end", "true", 1), defaultEdge("e3", "a", "error-end")));

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("fail")), List.of(), transitionHandler);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals("error-end", result.currentNodeId());
    }

    @Test
    void transitionToInvalidNodeFailsWorkflow() {
        WorkflowErrorHandler badHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("nonexistent");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("test")), List.of(), badHandler);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("not found"));
    }

    @Test
    void errorHandlerExceptionFailsWorkflow() {
        WorkflowErrorHandler explodingHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                throw new RuntimeException("handler exploded");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                throw new RuntimeException("handler exploded");
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("test")), List.of(), explodingHandler);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("Error handler threw"));
    }

    @Test
    void handleNodeErrorReceivesResultOnFailed() {
        NodeResult[] captured = {null};
        Exception[] capturedException = {null};

        WorkflowErrorHandler capturingHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                captured[0] = r;
                capturedException[0] = e;
                return ErrorResolution.fail();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("test")), List.of(), capturingHandler);
        engine.startWorkflow(simpleActionWorkflow("test"), Map.of());

        assertNotNull(captured[0]);
        assertEquals(NodeResultStatus.FAILED, captured[0].status());
        assertNull(capturedException[0]);
    }

    @Test
    void handleNodeErrorReceivesExceptionOnThrow() {
        NodeResult[] captured = {null};
        Exception[] capturedException = {null};

        WorkflowErrorHandler capturingHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                captured[0] = r;
                capturedException[0] = e;
                return ErrorResolution.fail();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(throwingExecutor("test")), List.of(), capturingHandler);
        engine.startWorkflow(simpleActionWorkflow("test"), Map.of());

        assertNull(captured[0]);
        assertNotNull(capturedException[0]);
        assertEquals("executor exploded", capturedException[0].getMessage());
    }

    // --- Bug fix: error handler TRANSITION to ACTION node ---

    @Test
    void transitionToActionNodeExecutesAction() {
        int[] recoveryCount = {0};
        NodeExecutor recoveryExecutor = new NodeExecutor() {
            public String actionType() { return "recover"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                recoveryCount[0]++;
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("recovered", true));
            }
        };

        WorkflowErrorHandler transitionHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("recovery");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("failing", "fail"),
                    actionNode("recovery", "recover"), endNode("end")),
            List.of(edge("e1", "start", "failing"), edge("e2", "failing", "end"),
                    edge("e3", "recovery", "end")));

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("fail"), recoveryExecutor),
            List.of(), transitionHandler);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(1, recoveryCount[0], "Recovery action should have been executed");
        assertEquals(true, result.context().get("recovered"));
    }

    @Test
    void transitionToActionNodeCreatesHistoryEntry() {
        NodeExecutor recoveryExecutor = new NodeExecutor() {
            public String actionType() { return "recover"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            }
        };

        WorkflowErrorHandler transitionHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("recovery");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("failing", "fail"),
                    actionNode("recovery", "recover"), endNode("end")),
            List.of(edge("e1", "start", "failing"), edge("e2", "failing", "end"),
                    edge("e3", "recovery", "end")));

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("fail"), recoveryExecutor),
            List.of(), transitionHandler);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        boolean recoveryInHistory = result.history().stream()
            .anyMatch(h -> h.nodeId().equals("recovery"));
        assertTrue(recoveryInHistory, "Recovery action node should appear in history");
    }

    @Test
    void transitionToEndNodeCreatesHistoryAndFiresEvents() {
        List<String> events = new ArrayList<>();
        WorkflowEventListener listener = new WorkflowEventListener() {
            public void onNodeEntered(WorkflowInstance i, WorkflowNode n) {
                events.add("entered:" + n.id());
            }
            public void onWorkflowCompleted(WorkflowInstance i) {
                events.add("completed");
            }
        };

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
            List.of(startNode("start", List.of()), actionNode("a", "fail"), endNode("end"), endNode("error-end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end", "true", 1), defaultEdge("e3", "a", "error-end")));

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("fail")), List.of(listener), transitionHandler);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertTrue(events.contains("entered:error-end"), "onNodeEntered should fire for error-end");
        assertTrue(events.contains("completed"), "onWorkflowCompleted should fire");

        boolean errorEndInHistory = result.history().stream()
            .anyMatch(h -> h.nodeId().equals("error-end"));
        assertTrue(errorEndInHistory, "Error end node should appear in history");
    }

    @Test
    void transitionToMultiStepRecoveryChainRunsEntireChain() {
        // X (fails) --TRANSITION--> recovery (ACTION) -> cleanup (ACTION) -> end.
        // The recovery target must follow its OWN successor edges, not X's, so cleanup must run.
        int[] recoveryCount = {0};
        int[] cleanupCount = {0};
        NodeExecutor recoveryExecutor = new NodeExecutor() {
            public String actionType() { return "recover"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                recoveryCount[0]++;
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("recovered", true));
            }
        };
        NodeExecutor cleanupExecutor = new NodeExecutor() {
            public String actionType() { return "cleanup"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                cleanupCount[0]++;
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("cleaned", true));
            }
        };

        WorkflowErrorHandler transitionHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("recovery");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("failing", "fail"),
                    actionNode("recovery", "recover"), actionNode("cleanup", "cleanup"),
                    endNode("end")),
            List.of(edge("e1", "start", "failing"), edge("e2", "failing", "end"),
                    edge("e3", "recovery", "cleanup"), edge("e4", "cleanup", "end")));

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("fail"), recoveryExecutor, cleanupExecutor),
            List.of(), transitionHandler);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(1, recoveryCount[0], "Recovery action should have run once");
        assertEquals(1, cleanupCount[0], "Cleanup (recovery's successor) must have run once");
        assertEquals(true, result.context().get("recovered"));
        assertEquals(true, result.context().get("cleaned"));
        assertEquals("end", result.currentNodeId());
    }

    @Test
    void transitionToStartNodeFailsWorkflow() {
        WorkflowErrorHandler transitionHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("start");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("test")), List.of(), transitionHandler);
        WorkflowInstance result = engine.startWorkflow(simpleActionWorkflow("test"), Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("START"));
    }

    // --- Bug fix: condition evaluation failure preserves error context (#50) ---

    @Test
    void conditionEvaluationFailureReportsFailingExpression() {
        Exception[] capturedException = {null};
        WorkflowNode[] capturedNode = {null};

        WorkflowErrorHandler capturingHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                capturedException[0] = e;
                capturedNode[0] = n;
                return ErrorResolution.fail();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        String badCondition = "1 +";
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "end", badCondition, 0)));

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(), List.of(), capturingHandler);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertNotNull(capturedException[0], "Error handler should receive the evaluation exception");
        assertInstanceOf(ConditionEvaluationException.class, capturedException[0]);
        assertEquals(badCondition, ((ConditionEvaluationException) capturedException[0]).expression());
        assertNotNull(capturedNode[0], "Error handler should receive the node context");
        assertEquals("start", capturedNode[0].id());
    }

    // --- Bug fix: infinite retry loop ---

    @Test
    void retryLimitExceededOnFailedResult() {
        int[] callCount = {0};
        NodeExecutor alwaysFailing = new NodeExecutor() {
            public String actionType() { return "test"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                callCount[0]++;
                return new NodeResult(NodeResultStatus.FAILED, Map.of());
            }
        };

        WorkflowErrorHandler alwaysRetry = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.retry();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(alwaysFailing), List.of(), alwaysRetry);
        WorkflowInstance result = engine.startWorkflow(simpleActionWorkflow("test"), Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("retry limit"));
        assertEquals(11, callCount[0], "Should execute 1 initial + 10 retries before failing");
    }

    @Test
    void retryLimitExceededOnException() {
        int[] callCount = {0};
        NodeExecutor alwaysThrowing = new NodeExecutor() {
            public String actionType() { return "test"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                callCount[0]++;
                throw new RuntimeException("always fails");
            }
        };

        WorkflowErrorHandler alwaysRetry = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.retry();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(alwaysThrowing), List.of(), alwaysRetry);
        WorkflowInstance result = engine.startWorkflow(simpleActionWorkflow("test"), Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("retry limit"));
        assertEquals(11, callCount[0], "Should execute 1 initial + 10 retries before failing");
    }
}
