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
}
