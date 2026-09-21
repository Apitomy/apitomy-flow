package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import java.util.stream.Stream;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowEngineParallelTest {

    private WorkflowEngine engine(NodeExecutor... executors) {
        return new WorkflowEngine(NodeExecutorProvider.fromList(executors), List.of(), null);
    }

    private NodeExecutor echo(String actionType, String outKey, Object outVal) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of(outKey, outVal));
            }
        };
    }

    @Test
    void forkRunsBothBranchesThenJoinsOnce() {
        AtomicInteger joinRuns = new AtomicInteger();
        NodeExecutor joinExec = new NodeExecutor() {
            public String actionType() { return "tj"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                joinRuns.incrementAndGet();
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("joined", true));
            }
        };
        WorkflowEngine engine = engine(echo("t1", "left", 1), echo("t2", "right", 2), joinExec);
        WorkflowInstance result = engine.startWorkflow(
            diamondForkJoinWorkflow("t1", "t2", "tj"), Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(1, joinRuns.get(), "join must execute exactly once");
        assertEquals(1, result.context().get("left"));
        assertEquals(2, result.context().get("right"));
        assertEquals(true, result.context().get("joined"));
    }

    @Test
    void joinWaitsForBothBranches() {
        // one branch is a human task that parks; the join must not fire until it completes
        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), humanTaskNode("task"), actionNode("a2", "t2"),
                actionNode("j", "tj"), endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "start", "a2"),
                edge("e3", "task", "j"), edge("e4", "a2", "j"), edge("e5", "j", "end")));
        WorkflowEngine engine = engine(echo("t2", "right", 2),
            echo("tj", "joined", true));
        WorkflowInstance waiting = engine.startWorkflow(wf, Map.of());

        // a2 has run, but the join is still waiting on the human task branch
        assertEquals(InstanceStatus.WAITING, waiting.status());
        assertFalse(waiting.context().containsKey("joined"));
        // the sole active branch is parked at the human task
        assertEquals("task", waiting.currentNodeId());

        WorkflowInstance done = engine.completeCurrentNode(wf, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("approved", true)));
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals(true, done.context().get("joined"));
    }

    @Test
    void branchFailureFailsWholeInstance() {
        NodeExecutor failing = new NodeExecutor() {
            public String actionType() { return "t2"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.FAILED, Map.of());
            }
        };
        WorkflowEngine engine = engine(echo("t1", "left", 1), failing, echo("tj", "joined", true));
        WorkflowInstance result = engine.startWorkflow(
            diamondForkJoinWorkflow("t1", "t2", "tj"), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
    }

    @Test
    void historyIsBranchAttributed() {
        WorkflowEngine engine = engine(echo("t1", "left", 1), echo("t2", "right", 2),
            echo("tj", "joined", true));
        WorkflowInstance result = engine.startWorkflow(
            diamondForkJoinWorkflow("t1", "t2", "tj"), Map.of());
        // both a1 and a2 recorded, on distinct branches
        long branches = result.history().stream()
            .filter(h -> h.nodeId().equals("a1") || h.nodeId().equals("a2"))
            .map(HistoryEntry::branchId)
            .distinct().count();
        assertEquals(2, branches);
    }

    @Test
    void resumingOneBranchLeavesSiblingWaiting() {
        // two human tasks fork from start, join at j
        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), humanTaskNode("t1"), humanTaskNode("t2"),
                actionNode("j", "tj"), endNode("end")),
            List.of(edge("e1", "start", "t1"), edge("e2", "start", "t2"),
                edge("e3", "t1", "j"), edge("e4", "t2", "j"), edge("e5", "j", "end")));
        WorkflowEngine engine = engine(new NodeExecutor() {
            public String actionType() { return "tj"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("joined", true));
            }
        });
        WorkflowInstance waiting = engine.startWorkflow(wf, Map.of());
        assertEquals(InstanceStatus.WAITING, waiting.status());
        assertEquals(2, waiting.activeBranches().size());

        // resume t1 only — t2 still parked, join not fired
        WorkflowInstance afterT1 = engine.completeNode(wf, waiting, "t1",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("a", 1)));
        assertEquals(InstanceStatus.WAITING, afterT1.status());
        assertFalse(afterT1.context().containsKey("joined"));

        // resume t2 — join fires, workflow completes
        WorkflowInstance done = engine.completeNode(wf, afterT1, "t2",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("b", 2)));
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals(true, done.context().get("joined"));
    }

    @ParameterizedTest
    @EnumSource(value = NodeType.class, names = {"HUMAN_TASK", "RECEIVE_EVENT", "WAIT", "ACTION"})
    void successfulAsyncRetryLeavesSiblingParked(NodeType siblingType) {
        AtomicInteger attempts = new AtomicInteger();
        NodeExecutor left = executor("left", () -> new NodeResult(
            attempts.incrementAndGet() == 1 ? NodeResultStatus.PENDING : NodeResultStatus.COMPLETED,
            Map.of("leftResult", true)));
        WorkflowEngine engine = recoveryEngine(left, ErrorResolution.retry());
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("left", "left"), parkedNode("sibling", siblingType),
                actionNode("join", "join"), endNode("end")),
            List.of(edge("start-left", "start", "left"), edge("start-sibling", "start", "sibling"),
                edge("left-join", "left", "join"), edge("sibling-join", "sibling", "join"),
                edge("join-end", "join", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, waiting.status());
        assertEquals(2, waiting.activeBranches().size());
        HistoryEntry siblingEntry = latestHistory(waiting, "sibling");

        WorkflowInstance recovered = engine.completeNode(workflow, waiting, "left",
            new NodeResult(NodeResultStatus.FAILED, Map.of()));

        assertSiblingParked(recovered, siblingEntry);
        assertEquals(2, attempts.get());
        assertEquals("sibling", recovered.currentNodeId());
        assertEquals(List.of("left-join"), recovered.joinArrivals().get("join"));
        assertNotNull(latestHistory(recovered, "left").completedOn());
        assertCompletesAfterSibling(engine, workflow, recovered);
    }

    @ParameterizedTest(name = "{0}, blocking recovery={1}, sibling={2}")
    @MethodSource("recoveryCases")
    void recoveryQueuesPreserveParkedBranches(String recoveryPath, boolean blockingRecovery,
                                             NodeType siblingType) {
        AtomicInteger attempts = new AtomicInteger();
        NodeExecutor left = executor("left", () -> new NodeResult(
            attempts.incrementAndGet() == 1 ? NodeResultStatus.PENDING : NodeResultStatus.FAILED, Map.of()));
        AtomicInteger errors = new AtomicInteger();
        WorkflowErrorHandler handler = new WorkflowErrorHandler() {
            /** Selects retry or transition for the failing branch. */
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                if (recoveryPath.equals("retry-transition") && errors.incrementAndGet() == 1) {
                    return ErrorResolution.retry();
                }
                return ErrorResolution.transitionTo("recovery");
            }
            /** Recovers a branch whose condition did not match. */
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.transitionTo("recovery");
            }
        };
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(left,
            executor("pending", () -> new NodeResult(NodeResultStatus.PENDING, Map.of())),
            echo("recover", "recovered", true), echo("join", "joined", true)), List.of(), handler);
        String condition = switch (recoveryPath) {
            case "edge-error" -> "1 +";
            case "no-matching-edge" -> "false";
            default -> null;
        };
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("left", "left"), parkedNode("sibling", siblingType),
                blockingRecovery ? humanTaskNode("recovery") : actionNode("recovery", "recover"),
                actionNode("join", "join"), endNode("end")),
            List.of(edge("start-left", "start", "left"), edge("start-sibling", "start", "sibling"),
                edge("left-recovery", "left", "recovery", condition, 0),
                edge("recovery-join", "recovery", "join"), edge("sibling-join", "sibling", "join"),
                edge("join-end", "join", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, waiting.status());
        assertEquals(2, waiting.activeBranches().size());
        HistoryEntry siblingEntry = latestHistory(waiting, "sibling");
        boolean edgeRecovery = recoveryPath.equals("edge-error") || recoveryPath.equals("no-matching-edge");

        WorkflowInstance recovered = engine.completeNode(workflow, waiting, "left",
            new NodeResult(edgeRecovery ? NodeResultStatus.COMPLETED : NodeResultStatus.FAILED, Map.of()));

        assertSiblingParked(recovered, siblingEntry);
        assertNotNull(latestHistory(recovered, "left").completedOn());
        assertEquals(latestHistory(recovered, "left").branchId(),
            latestHistory(recovered, "recovery").branchId());
        if (blockingRecovery) {
            assertEquals(2, recovered.activeBranches().size());
            assertNull(recovered.currentNodeId());
            assertNull(latestHistory(recovered, "recovery").completedOn());
            assertTrue(recovered.joinArrivals().isEmpty());
            recovered = engine.completeNode(workflow, recovered, "recovery",
                new NodeResult(NodeResultStatus.COMPLETED, Map.of("recovered", true)));
            assertSiblingParked(recovered, siblingEntry);
        }
        assertEquals("sibling", recovered.currentNodeId());
        assertEquals(List.of("recovery-join"), recovered.joinArrivals().get("join"));
        assertEquals(true, recovered.context().get("recovered"));
        assertCompletesAfterSibling(engine, workflow, recovered);
    }

    @ParameterizedTest
    @ValueSource(strings = {"1 +", "false"})
    void edgeRecoveryKeepsAlreadyRunnableSiblings(String condition) {
        WorkflowErrorHandler handler = new WorkflowErrorHandler() {
            /** Recovers the branch whose edge expression failed. */
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("recovery");
            }
            /** Recovers the branch whose edge did not match. */
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.transitionTo("recovery");
            }
        };
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(
            echo("left", "leftResult", true), echo("right", "rightResult", true),
            echo("recover", "recovered", true), echo("join", "joined", true)), List.of(), handler);
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("left", "left"), actionNode("right", "right"),
                humanTaskNode("sibling"), actionNode("recovery", "recover"),
                actionNode("join", "join"), endNode("end")),
            List.of(edge("start-left", "start", "left"), edge("start-right", "start", "right"),
                edge("start-sibling", "start", "sibling"),
                edge("left-recovery", "left", "recovery", condition, 0),
                edge("right-join", "right", "join"), edge("recovery-join", "recovery", "join"),
                edge("sibling-join", "sibling", "join"), edge("join-end", "join", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        assertSiblingParked(waiting, latestHistory(waiting, "sibling"));
        assertEquals("sibling", waiting.currentNodeId());
        assertEquals(Set.of("right-join", "recovery-join"), Set.copyOf(waiting.joinArrivals().get("join")));
        assertCompletesAfterSibling(engine, workflow, waiting);
    }

    private static Stream<Arguments> recoveryCases() {
        return Stream.of("transition", "retry-transition", "edge-error", "no-matching-edge")
            .flatMap(path -> Stream.of(false, true)
                .flatMap(blocking -> Stream.of(NodeType.HUMAN_TASK, NodeType.RECEIVE_EVENT,
                        NodeType.WAIT, NodeType.ACTION)
                    .map(sibling -> Arguments.of(path, blocking, sibling))));
    }

    private WorkflowNode parkedNode(String id, NodeType type) {
        return switch (type) {
            case HUMAN_TASK -> humanTaskNode(id);
            case RECEIVE_EVENT -> receiveEventNode(id, "approved");
            case WAIT -> waitNode(id, "PT1H");
            case ACTION -> actionNode(id, "pending");
            default -> throw new IllegalArgumentException("Not a parked node type: " + type);
        };
    }

    private NodeExecutor executor(String actionType, Supplier<NodeResult> result) {
        return new NodeExecutor() {
            /** Identifies the test action. */
            public String actionType() { return actionType; }
            /** Supplies the next result of the test action. */
            public NodeResult execute(NodeExecutionContext ctx) { return result.get(); }
        };
    }

    private WorkflowEngine recoveryEngine(NodeExecutor left, ErrorResolution resolution) {
        WorkflowErrorHandler handler = new WorkflowErrorHandler() {
            /** Returns the configured recovery for a failed action. */
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return resolution;
            }
            /** Fails unexpected routing errors. */
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };
        return new WorkflowEngine(NodeExecutorProvider.fromList(left,
            executor("pending", () -> new NodeResult(NodeResultStatus.PENDING, Map.of())),
            echo("join", "joined", true)), List.of(), handler);
    }

    private HistoryEntry latestHistory(WorkflowInstance instance, String nodeId) {
        return instance.history().stream().filter(entry -> entry.nodeId().equals(nodeId))
            .reduce((first, second) -> second).orElseThrow();
    }

    private void assertSiblingParked(WorkflowInstance instance, HistoryEntry originalEntry) {
        assertAll(
            () -> assertEquals(InstanceStatus.WAITING, instance.status()),
            () -> assertTrue(instance.activeBranches().contains(
                new ActiveBranch(originalEntry.branchId(), "sibling"))),
            () -> assertEquals(originalEntry, latestHistory(instance, "sibling")),
            () -> assertNull(latestHistory(instance, "sibling").completedOn()),
            () -> assertFalse(instance.context().containsKey("joined")));
    }

    private void assertCompletesAfterSibling(WorkflowEngine engine, Workflow workflow,
                                             WorkflowInstance waiting) {
        WorkflowInstance done = engine.completeNode(workflow, waiting, "sibling",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("approved", true)));
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals(true, done.context().get("joined"));
        assertEquals(true, done.context().get("approved"));
        assertNotNull(latestHistory(done, "sibling").completedOn());
        assertEquals(1, done.history().stream().filter(entry -> entry.nodeId().equals("join")).count());
    }

    // --- FIX 1: TRANSITION recovery targets the ACTUAL failing branch inside a parallel region ---

    @Test
    void recoveryToEndStopsForkBeforeLaterSiblingExecutes() {
        AtomicInteger siblingExecutions = new AtomicInteger();
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(
            executor("fail", () -> new NodeResult(NodeResultStatus.FAILED, Map.of())),
            executor("sibling", () -> {
                siblingExecutions.incrementAndGet();
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            }), echo("join", "joined", true)), List.of(), new WorkflowErrorHandler() {
                /** Terminates immediately through the error END target. */
                public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                        NodeResult r, Exception e) {
                    return ErrorResolution.transitionTo("error-end");
                }
                /** Fails unexpected routing errors. */
                public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                    return ErrorResolution.fail();
                }
            });
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("left", "fail"), actionNode("right", "sibling"),
                actionNode("join", "join"), endNode("end"), endNode("error-end")),
            List.of(edge("start-left", "start", "left"), edge("start-right", "start", "right"),
                edge("left-join", "left", "join"), edge("right-join", "right", "join"),
                edge("join-end", "join", "end", "true", 0),
                defaultEdge("join-error", "join", "error-end")));

        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals("error-end", result.currentNodeId());
        assertEquals(0, siblingExecutions.get());
        assertEquals(List.of("start", "left", "error-end"),
            result.history().stream().map(HistoryEntry::nodeId).toList());
        assertEquals(latestHistory(result, "left").branchId(), latestHistory(result, "error-end").branchId());
        assertTrue(result.activeBranches().isEmpty());
    }

    @Test
    void recoveryBudgetIsSharedAcrossParallelBranches() {
        AtomicInteger leftAttempts = new AtomicInteger();
        AtomicInteger rightAttempts = new AtomicInteger();
        WorkflowErrorHandler handler = new WorkflowErrorHandler() {
            /** Retries entry on the actual failing fork child. */
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo(n.id());
            }
            /** Fails unexpected routing errors. */
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(
            executor("left", () -> new NodeResult(leftAttempts.incrementAndGet() < 60
                ? NodeResultStatus.FAILED : NodeResultStatus.COMPLETED, Map.of("left", true))),
            executor("right", () -> new NodeResult(rightAttempts.incrementAndGet() < 60
                ? NodeResultStatus.FAILED : NodeResultStatus.COMPLETED, Map.of("right", true))),
            echo("join", "joined", true)), List.of(), handler);
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), humanTaskNode("sibling"), actionNode("left", "left"),
                actionNode("right", "right"), actionNode("join", "join"), endNode("end")),
            List.of(edge("start-sibling", "start", "sibling"), edge("start-left", "start", "left"),
                edge("start-right", "start", "right"), edge("sibling-join", "sibling", "join"),
                edge("left-join", "left", "join"), edge("right-join", "right", "join"),
                edge("join-end", "join", "end")));

        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("transition limit"));
        assertEquals(60, leftAttempts.get());
        assertEquals(39, rightAttempts.get(), "One shared budget also counts entry to the parked sibling");
        assertNull(latestHistory(result, "sibling").completedOn());
        assertTrue(result.activeBranches().contains(new ActiveBranch("root.0", "sibling")));
        assertFalse(result.context().containsKey("joined"));
        assertTrue(result.history().stream().filter(entry -> entry.nodeId().equals("left"))
            .allMatch(entry -> entry.branchId().equals("root.1")));
        assertTrue(result.history().stream().filter(entry -> entry.nodeId().equals("right"))
            .allMatch(entry -> entry.branchId().equals("root.2")));
    }

    @Test
    void transitionRecoveryTargetsFailingBranchInsideParallelRegion() {
        // fork start → a1, a2 → join j → end. a2's executor throws; a custom handler transitions the
        // failing branch to a recovery action that routes to a separate error end. The recovery must be
        // attributed to a2's ACTUAL branch (a fork child), never a fabricated "root" branch, and a2's
        // history entry must be closed — no stranded/phantom branch, no silent corruption.
        NodeExecutor throwingA2 = new NodeExecutor() {
            public String actionType() { return "t2"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                throw new RuntimeException("a2 exploded");
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

        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a1", "t1"), actionNode("a2", "t2"),
                actionNode("j", "tj"), actionNode("recovery", "recover"),
                endNode("end"), endNode("error-end")),
            List.of(edge("e1", "start", "a1"), edge("e2", "start", "a2"),
                edge("e3", "a1", "j"), edge("e4", "a2", "j"), edge("e5", "j", "end"),
                edge("e6", "recovery", "error-end")));

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(echo("t1", "left", 1), throwingA2,
                echo("tj", "joined", true), echo("recover", "recovered", true)),
            List.of(), transitionHandler);
        WorkflowInstance result = engine.startWorkflow(wf, Map.of());

        // Reaches a clean terminal state (recovery path completed), not a corrupt/failed one.
        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(true, result.context().get("recovered"));

        // a2's history entry is closed.
        HistoryEntry a2Entry = result.history().stream()
            .filter(h -> h.nodeId().equals("a2"))
            .reduce((first, second) -> second)
            .orElseThrow();
        assertNotNull(a2Entry.completedOn(), "a2 history entry must be closed");

        // The recovery ran on a2's ACTUAL branch (a fork child), not a fabricated "root" branch.
        HistoryEntry recoveryEntry = result.history().stream()
            .filter(h -> h.nodeId().equals("recovery"))
            .reduce((first, second) -> second)
            .orElseThrow();
        assertEquals(a2Entry.branchId(), recoveryEntry.branchId(),
            "recovery must be attributed to the failing branch");
        assertNotEquals("root", recoveryEntry.branchId(),
            "recovery must not be attributed to a fabricated root branch");
        assertTrue(recoveryEntry.branchId().startsWith("root."),
            "failing branch must be a fork child");

        // No stranded/phantom branch remains.
        assertTrue(result.activeBranches().isEmpty(), "no stranded/phantom branch");
    }

    // --- FIX 2: branch-aware info/event accessors during genuine concurrent WAITING ---

    @Test
    void concurrentReceiveEventsAreBranchAddressable() {
        // fork start → two RECEIVE_EVENT nodes → join → end. Both park concurrently.
        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNode("evtA", "TypeA"),
                receiveEventNode("evtB", "TypeB"), actionNode("j", "tj"), endNode("end")),
            List.of(edge("e1", "start", "evtA"), edge("e2", "start", "evtB"),
                edge("e3", "evtA", "j"), edge("e4", "evtB", "j"), edge("e5", "j", "end")));
        WorkflowEngine engine = engine(echo("tj", "joined", true));

        WorkflowInstance waiting = engine.startWorkflow(wf, Map.of());
        assertEquals(InstanceStatus.WAITING, waiting.status());
        assertNull(waiting.currentNodeId(), "two branches parked → no single current node");
        assertEquals(2, waiting.activeBranches().size());

        Map<String, Object> eventA = Map.of("type", "TypeA");

        // matchesEvent is branch-addressable: the matching node matches, the sibling does not.
        assertTrue(engine.matchesEvent(wf, waiting, "evtA", eventA));
        assertFalse(engine.matchesEvent(wf, waiting, "evtB", eventA));
        // no-arg matchesEvent returns true if ANY parked branch matches.
        assertTrue(engine.matchesEvent(wf, waiting, eventA));

        // getReceiveEventInfo by node id returns the addressed node's info.
        ReceiveEventInfo infoA = engine.getReceiveEventInfo(wf, waiting, "evtA");
        assertNotNull(infoA);
        assertEquals("evtA", infoA.nodeId());
        assertEquals("TypeA", infoA.eventType());
        ReceiveEventInfo infoB = engine.getReceiveEventInfo(wf, waiting, "evtB");
        assertNotNull(infoB);
        assertEquals("TypeB", infoB.eventType());

        // Deliver to evtA only — the sibling evtB stays parked/WAITING.
        WorkflowInstance afterA = engine.completeNode(wf, waiting, "evtA",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("a", 1)));
        assertEquals(InstanceStatus.WAITING, afterA.status());
        assertEquals("evtB", afterA.currentNodeId(), "only the sibling remains parked");
        assertFalse(afterA.context().containsKey("joined"), "join must not have fired yet");
    }

    // --- FIX 5: nested fork/join ---

    @Test
    void nestedForkJoinCompletesOnce() {
        AtomicInteger outerJoinRuns = new AtomicInteger();
        AtomicInteger innerJoinRuns = new AtomicInteger();
        NodeExecutor outerJoinExec = new NodeExecutor() {
            public String actionType() { return "oj"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                outerJoinRuns.incrementAndGet();
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("outerJoined", true));
            }
        };
        NodeExecutor innerJoinExec = new NodeExecutor() {
            public String actionType() { return "ij"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                innerJoinRuns.incrementAndGet();
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("innerJoined", true));
            }
        };
        WorkflowEngine engine = engine(
            echo("a", "ranA", true), echo("b", "ranB", true),
            echo("a1", "ranA1", true), echo("a2", "ranA2", true),
            innerJoinExec, outerJoinExec);

        WorkflowInstance result = engine.startWorkflow(nestedForkJoinWorkflow(), Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        // Every leaf action ran.
        assertEquals(true, result.context().get("ranA"));
        assertEquals(true, result.context().get("ranB"));
        assertEquals(true, result.context().get("ranA1"));
        assertEquals(true, result.context().get("ranA2"));
        // Inner join fires exactly once, then the outer join fires exactly once.
        assertEquals(1, innerJoinRuns.get(), "inner join must fire exactly once");
        assertEquals(1, outerJoinRuns.get(), "outer join must fire exactly once");
        assertEquals(true, result.context().get("innerJoined"));
        assertEquals(true, result.context().get("outerJoined"));
    }

    // --- Repro for issue #105: fork into ACTION nodes that PARK (PENDING) only enters first branch ---

    @Test
    void forkIntoPendingActionNodesActivatesBothBranches() {
        NodeExecutor pendingA1 = new NodeExecutor() {
            public String actionType() { return "t1"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };
        NodeExecutor pendingA2 = new NodeExecutor() {
            public String actionType() { return "t2"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };
        WorkflowEngine engine = engine(pendingA1, pendingA2, echo("tj", "joined", true));
        WorkflowInstance result = engine.startWorkflow(
            diamondForkJoinWorkflow("t1", "t2", "tj"), Map.of());

        assertEquals(InstanceStatus.WAITING, result.status());
        assertEquals(2, result.activeBranches().size(),
            "both fork branches must be parked as active, not just the first");
        List<String> parkedNodeIds = result.activeBranches().stream()
            .map(ActiveBranch::nodeId).sorted().toList();
        assertEquals(List.of("a1", "a2"), parkedNodeIds);
    }

    @Test
    void forkWithOnePendingAndOneCompletingBranchLeavesOnlyThePendingOneParked() {
        // a1 completes normally and proceeds to (and is absorbed by) the join; a2 parks as PENDING.
        // The join must not fire (a2 hasn't arrived) and only a2 should remain as an active branch.
        NodeExecutor pendingA2 = new NodeExecutor() {
            public String actionType() { return "t2"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };
        WorkflowEngine engine = engine(echo("t1", "left", 1), pendingA2, echo("tj", "joined", true));
        WorkflowInstance result = engine.startWorkflow(
            diamondForkJoinWorkflow("t1", "t2", "tj"), Map.of());

        assertEquals(InstanceStatus.WAITING, result.status());
        assertEquals(1, result.activeBranches().size());
        assertEquals("a2", result.activeBranches().getFirst().nodeId());
        assertFalse(result.context().containsKey("joined"), "join must not have fired");
    }
}
