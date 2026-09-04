package io.apitomy.flow.engine;

import io.apitomy.flow.model.Workflow;
import org.junit.jupiter.api.Test;

import java.util.List;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class ParallelRegionsTest {

    /** start → (fork) → a1, a2 → (join) j → end */
    private Workflow diamond() {
        return new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a1", "t1"), actionNode("a2", "t2"),
                actionNode("j", "tj"), endNode("end")),
            List.of(edge("e1", "start", "a1"), edge("e2", "start", "a2"),
                edge("e3", "a1", "j"), edge("e4", "a2", "j"), edge("e5", "j", "end")));
    }

    @Test
    void classifiesForkAndJoin() {
        ParallelRegions regions = ParallelRegions.analyze(diamond());
        assertTrue(regions.isFork("start"));
        assertTrue(regions.isJoin("j"));
        assertEquals("j", regions.joinFor("start"));
        assertTrue(regions.problems().isEmpty());
    }

    @Test
    void joinIncomingEdgesAreAllIncoming() {
        ParallelRegions regions = ParallelRegions.analyze(diamond());
        assertEquals(java.util.Set.of("e3", "e4"), regions.incomingEdgeIds("j"));
    }

    @Test
    void exclusiveChoiceIsNotAFork() {
        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "t"), actionNode("b", "t2"), endNode("end")),
            List.of(edge("e1", "start", "a", "context.x == 1", 1), defaultEdge("e2", "start", "b"),
                edge("e3", "a", "end"), edge("e4", "b", "end")));
        ParallelRegions regions = ParallelRegions.analyze(wf);
        assertFalse(regions.isFork("start"));
        assertTrue(regions.problems().isEmpty());
    }

    @Test
    void mixedForkEdgesReported() {
        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "t"), actionNode("b", "t2"), endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "start", "b", "context.x == 1", 1),
                edge("e3", "a", "end"), edge("e4", "b", "end")));
        ParallelRegions regions = ParallelRegions.analyze(wf);
        assertFalse(regions.isFork("start"));
        assertTrue(regions.problems().stream().anyMatch(p -> p.code().equals("MIXED_FORK_EDGES")));
    }

    @Test
    void forkWithoutJoinReported() {
        // both branches run straight to their own end — never re-converge
        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a1", "t1"), actionNode("a2", "t2"),
                endNode("end1"), endNode("end2")),
            List.of(edge("e1", "start", "a1"), edge("e2", "start", "a2"),
                edge("e3", "a1", "end1"), edge("e4", "a2", "end2")));
        ParallelRegions regions = ParallelRegions.analyze(wf);
        assertTrue(regions.problems().stream()
            .anyMatch(p -> p.code().equals("FORK_WITHOUT_JOIN") || p.code().equals("PARALLEL_BRANCH_REACHES_END")));
    }
}
