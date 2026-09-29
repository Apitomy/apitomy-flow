package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Repeatable diagnostic workload; timings are observations, never CI thresholds. */
@EnabledIfSystemProperty(named = "flow.benchmark", matches = "true")
class ArchitectureBenchmarkTest {
    @Test
    void graphAndLongHistory() {
        List<WorkflowNode> nodes = new ArrayList<>();
        List<WorkflowEdge> edges = new ArrayList<>();
        for (int i = 0; i < 1000; i++) {
            nodes.add(new WorkflowNode("n" + i, i == 0 ? NodeType.START : i == 999 ? NodeType.END : NodeType.WAIT,
                "Node " + i, i == 0 || i == 999 ? Map.of() : Map.of("duration", "PT1S"), null));
            if (i > 0) edges.add(new WorkflowEdge("e" + i, "n" + (i - 1), "n" + i, null, 0, false, null));
        }
        Workflow workflow = new Workflow("benchmark", "Benchmark", null, 1, nodes, edges);
        List<HistoryEntry> history = new ArrayList<>();
        Instant now = Instant.EPOCH;
        history.add(new HistoryEntry("n1", "Node 1", null, null, now, null, null, "parked"));
        for (int i = 0; i < 10000; i++) {
            history.add(new HistoryEntry("n2", "Node 2", null, null, now, now, Map.of("value", i), "other"));
        }
        WorkflowInstance instance = WorkflowInstance.builder().id("bench").workflowId(workflow.id())
            .status(InstanceStatus.WAITING).currentNodeId("n1").history(history)
            .addActiveBranch(new ActiveBranch("parked", "n1")).createdOn(now).updatedOn(now).build();
        WorkflowEngine engine = new WorkflowEngine(null, null, null);
        for (int warmup = 0; warmup < 3; warmup++) run(workflow, instance, engine, false);
        for (int sample = 0; sample < 5; sample++) run(workflow, instance, engine, true);
    }

    private void run(Workflow workflow, WorkflowInstance instance, WorkflowEngine engine, boolean report) {
        long started = System.nanoTime();
        long checksum = 0;
        for (int repeat = 0; repeat < 20; repeat++) {
            for (WorkflowNode node : workflow.nodes()) {
                checksum += workflow.findNodeById(node.id()).isPresent() ? 1 : 0;
                checksum += workflow.getOutgoingEdges(node.id()).size();
                checksum += workflow.getIncomingEdges(node.id()).size();
            }
            checksum += ParallelRegions.analyze(workflow).problems().size();
        }
        long graphNanos = System.nanoTime() - started;
        started = System.nanoTime();
        for (int repeat = 0; repeat < 1000; repeat++) {
            checksum += engine.getWaitInfo(workflow, instance) != null ? 1 : 0;
        }
        long historyNanos = System.nanoTime() - started;
        assertEquals(60960, checksum);
        if (report) System.out.printf("C13 graph_ms=%.3f history_ms=%.3f checksum=%d%n",
            graphNanos / 1_000_000.0, historyNanos / 1_000_000.0, checksum);
    }
}
