package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class GraphReuseTest {
    @Test
    void publishesOneAnalysisAcrossConcurrentCallersAndDoesNotKeyByWorkflowId() {
        Workflow workflow = workflow(List.of(edge("a", "s", "x", 0)));
        List<ParallelRegions> results = java.util.stream.IntStream.range(0, 100).parallel()
            .mapToObj(ignored -> ParallelRegions.analyze(workflow)).toList();
        assertTrue(results.stream().allMatch(result -> result == results.getFirst()));
        Workflow sameId = workflow(List.of(edge("a", "s", "x", 0), edge("b", "s", "y", 0)));
        assertFalse(results.getFirst().isFork("s"));
        assertTrue(ParallelRegions.analyze(sameId).isFork("s"));
    }

    @Test
    void reusesAnalysisOnlyForTheSameImmutableDefinition() {
        List<WorkflowEdge> edges = new ArrayList<>(List.of(edge("a", "s", "x", 0)));
        Workflow original = workflow(edges);
        ParallelRegions first = ParallelRegions.analyze(original);
        assertSame(first, ParallelRegions.analyze(original), "Repeated calls should reuse completed analysis");
        edges.add(edge("b", "s", "y", 0));
        edges.add(edge("c", "x", "j", 0));
        edges.add(edge("d", "y", "j", 0));
        Workflow revised = workflow(edges);
        assertFalse(first.isFork("s"));
        assertTrue(ParallelRegions.analyze(revised).isFork("s"));
        assertEquals("j", ParallelRegions.analyze(revised).joinFor("s"));
        assertSame(first, ParallelRegions.analyze(original));
        assertThrows(UnsupportedOperationException.class,
            () -> ParallelRegions.analyze(revised).incomingEdgeIds("j").clear());
    }

    @Test
    void adjacencyPreservesPriorityTiesAndIncomingDefinitionOrderWithoutRebuilding() {
        Workflow workflow = workflow(List.of(edge("late", "s", "j", 5), edge("first", "s", "x", 1),
            edge("tie", "s", "y", 1), edge("incoming", "x", "j", 0)));
        assertEquals(List.of("first", "tie", "late"), workflow.getOutgoingEdges("s").stream().map(WorkflowEdge::id).toList());
        assertSame(workflow.getOutgoingEdges("s"), workflow.getOutgoingEdges("s"));
        assertEquals(List.of("late", "incoming"), workflow.getIncomingEdges("j").stream().map(WorkflowEdge::id).toList());
        assertThrows(UnsupportedOperationException.class, () -> workflow.getOutgoingEdges("s").clear());
        assertTrue(workflow.getOutgoingEdges(null).isEmpty());
        assertTrue(workflow.findNodeById("missing").isEmpty());
    }

    private Workflow workflow(List<WorkflowEdge> edges) {
        return new Workflow("same-id", "Graph", null, 1, List.of("s", "x", "y", "j").stream()
            .map(id -> new WorkflowNode(id, NodeType.ACTION, id, Map.of(), null)).toList(), edges);
    }

    private WorkflowEdge edge(String id, String source, String target, int priority) {
        return new WorkflowEdge(id, source, target, null, priority, false, null);
    }
}
