package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

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

    // --- FIX 1: TRANSITION recovery targets the ACTUAL failing branch inside a parallel region ---

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
}
