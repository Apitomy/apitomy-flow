package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import io.apitomy.flow.validation.ValidationProblem;
import io.apitomy.flow.validation.WorkflowValidator;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests receive-event timeouts: the dedicated timeout edge, {@link ReceiveEventInfo#timeout()},
 * {@link WorkflowEngine#onReceiveEventTimeout}, validation, parallel branches, and loops.
 */
class ReceiveEventTimeoutTest {

    private final WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
    private final WorkflowValidator validator = new WorkflowValidator();

    private static final NodeResult EVENT = new NodeResult(NodeResultStatus.COMPLETED, Map.of("paid", true));

    /** start → recv(timeout) → done | timeout → expired. */
    private Workflow timeoutWorkflow(String timeout) {
        return new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNodeWithTimeout("recv", "payment", timeout),
                endNode("done"), endNode("expired")),
            List.of(edge("e1", "start", "recv"), edge("e2", "recv", "done"),
                timeoutEdge("t1", "recv", "expired")));
    }

    private List<String> codes(Workflow workflow) {
        return validator.validate(workflow).stream().map(ValidationProblem::code).toList();
    }

    @Test
    void receiveEventInfoExposesTimeout() {
        Workflow workflow = timeoutWorkflow("PT1H");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        ReceiveEventInfo info = engine.getReceiveEventInfo(workflow, instance, "recv");
        assertNotNull(info);
        assertEquals(Duration.ofHours(1), info.timeout());
    }

    @Test
    void receiveEventInfoTimeoutIsNullWhenNotConfigured() {
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNode("recv", "payment"), endNode("end")),
            List.of(edge("e1", "start", "recv"), edge("e2", "recv", "end")));
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        assertNull(engine.getReceiveEventInfo(workflow, instance, "recv").timeout());
    }

    @Test
    void eventDeliveryFollowsNormalEdgeNotTimeoutEdge() {
        Workflow workflow = timeoutWorkflow("PT1H");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance done = engine.completeNode(workflow, instance, "recv", EVENT);
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals("done", done.currentNodeId());
    }

    @Test
    void timeoutFollowsTimeoutEdge() {
        Workflow workflow = timeoutWorkflow("PT1H");
        List<String> followed = new ArrayList<>();
        WorkflowEngine listening = new WorkflowEngine(NodeExecutorProvider.fromList(),
            List.of(new WorkflowEventListener() {
                @Override
                public void onEdgeFollowed(WorkflowInstance instance, WorkflowEdge edge) {
                    followed.add(edge.id());
                }
            }), null);
        WorkflowInstance instance = listening.startWorkflow(workflow, Map.of());
        WorkflowInstance expired = listening.onReceiveEventTimeout(workflow, instance, "recv");
        assertEquals(InstanceStatus.COMPLETED, expired.status());
        assertEquals("expired", expired.currentNodeId());
        assertEquals(List.of("e1", "t1"), followed);
        assertFalse(expired.context().containsKey("paid"));
    }

    @Test
    void timeoutAfterEventDeliveryIsNoOp() {
        Workflow workflow = timeoutWorkflow("PT1H");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance done = engine.completeNode(workflow, instance, "recv", EVENT);
        assertSame(done, engine.onReceiveEventTimeout(workflow, done, "recv"));
    }

    @Test
    void timeoutForNonParkedOrUnknownNodeIsNoOp() {
        Workflow workflow = timeoutWorkflow("PT1H");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        assertSame(instance, engine.onReceiveEventTimeout(workflow, instance, "done"));
        assertSame(instance, engine.onReceiveEventTimeout(workflow, instance, "missing"));
        WorkflowInstance cancelled = engine.cancelWorkflow(workflow, instance);
        assertSame(cancelled, engine.onReceiveEventTimeout(workflow, cancelled, "recv"));
    }

    @Test
    void timeoutForNonReceiveEventParkedNodeIsNoOp() {
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), waitNode("delay", "PT1M"), endNode("end")),
            List.of(edge("e1", "start", "delay"), edge("e2", "delay", "end")));
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        assertSame(instance, engine.onReceiveEventTimeout(workflow, instance, "delay"));
    }

    @Test
    void timeoutOnParkedNodeWithoutTimeoutEdgeThrows() {
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNode("recv", "payment"), endNode("end")),
            List.of(edge("e1", "start", "recv"), edge("e2", "recv", "end")));
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        assertThrows(IllegalStateException.class, () -> engine.onReceiveEventTimeout(workflow, instance, "recv"));
    }

    @Test
    void timeoutInsideParallelBranchLeavesSiblingParked() {
        // start forks → recv(timeout) and delay; recv → onTime | timeout → late; both → merge → join → end
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNodeWithTimeout("recv", "payment", "PT5M"),
                waitNode("delay", "PT1M"), humanTaskNode("onTime"), humanTaskNode("late"),
                actionNode("merge", "noop"), actionNode("join", "noop"), endNode("end")),
            List.of(edge("f1", "start", "recv"), edge("f2", "start", "delay"),
                edge("r1", "recv", "onTime"), timeoutEdge("rt", "recv", "late"),
                edge("o1", "onTime", "merge"), edge("l1", "late", "merge"),
                edge("m1", "merge", "join"), edge("d1", "delay", "join"), edge("j1", "join", "end")));
        assertFalse(validator.hasErrors(validator.validate(workflow)), () -> validator.validate(workflow).toString());
        WorkflowEngine parallel = new WorkflowEngine(NodeExecutorProvider.fromList(new NodeExecutor() {
            public String actionType() { return "noop"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            }
        }), List.of(), null);

        WorkflowInstance instance = parallel.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals(2, instance.activeBranches().size());
        assertNull(instance.currentNodeId());
        assertEquals(Duration.ofMinutes(5), parallel.getReceiveEventInfo(workflow, instance).timeout());

        WorkflowInstance afterTimeout = parallel.onReceiveEventTimeout(workflow, instance, "recv");
        assertEquals(InstanceStatus.WAITING, afterTimeout.status());
        assertTrue(afterTimeout.activeBranches().stream().anyMatch(b -> b.nodeId().equals("late")));
        assertTrue(afterTimeout.activeBranches().stream().anyMatch(b -> b.nodeId().equals("delay")));
        assertNull(parallel.getReceiveEventInfo(workflow, afterTimeout, "recv"));
        assertSame(afterTimeout, parallel.onReceiveEventTimeout(workflow, afterTimeout, "recv"));

        WorkflowInstance afterLate = parallel.completeNode(workflow, afterTimeout, "late", EVENT);
        assertEquals(InstanceStatus.WAITING, afterLate.status());
        WorkflowInstance done = parallel.completeNode(workflow, afterLate, "delay", EVENT);
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertTrue(done.history().stream().noneMatch(h -> h.nodeId().equals("onTime")));
    }

    @Test
    void timeoutsOnConcurrentReceiveEventsAreIndependent() {
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNodeWithTimeout("a", "evA", "PT1M"),
                receiveEventNodeWithTimeout("b", "evB", "PT2M"),
                actionNode("aMerge", "noop"), actionNode("bMerge", "noop"),
                actionNode("join", "noop"), endNode("end")),
            List.of(edge("f1", "start", "a"), edge("f2", "start", "b"),
                edge("a1", "a", "aMerge"), timeoutEdge("at", "a", "aMerge"),
                edge("b1", "b", "bMerge"), timeoutEdge("bt", "b", "bMerge"),
                edge("am", "aMerge", "join"), edge("bm", "bMerge", "join"), edge("j1", "join", "end")));
        assertFalse(validator.hasErrors(validator.validate(workflow)), () -> validator.validate(workflow).toString());
        WorkflowEngine parallel = new WorkflowEngine(NodeExecutorProvider.fromList(new NodeExecutor() {
            public String actionType() { return "noop"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            }
        }), List.of(), null);
        WorkflowInstance instance = parallel.startWorkflow(workflow, Map.of());
        WorkflowInstance afterA = parallel.onReceiveEventTimeout(workflow, instance, "a");
        assertEquals(InstanceStatus.WAITING, afterA.status());
        assertEquals(Duration.ofMinutes(2), parallel.getReceiveEventInfo(workflow, afterA, "b").timeout());
        WorkflowInstance done = parallel.completeNode(workflow, afterA, "b", EVENT);
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals(true, done.context().get("paid"));
    }

    @Test
    void receiveEventWithTimeoutIsNotTreatedAsFork() {
        Workflow workflow = timeoutWorkflow("PT1H");
        assertFalse(ParallelRegions.analyze(workflow).isFork("recv"));
        assertTrue(ParallelRegions.analyze(workflow).problems().isEmpty());
    }

    @Test
    void timeoutInsideLoopOnlyAffectsCurrentActivation() {
        // start → recv(timeout) → done ; recv timeout → retry(human task) → recv
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNodeWithTimeout("recv", "payment", "PT10M"),
                humanTaskNode("retry"), endNode("done")),
            List.of(edge("e1", "start", "recv"), edge("e2", "recv", "done"),
                timeoutEdge("t1", "recv", "retry"), edge("e3", "retry", "recv")));
        assertFalse(validator.hasErrors(validator.validate(workflow)), () -> validator.validate(workflow).toString());

        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        for (int pass = 0; pass < 3; pass++) {
            assertNotNull(engine.getReceiveEventInfo(workflow, instance, "recv"));
            instance = engine.onReceiveEventTimeout(workflow, instance, "recv");
            assertEquals("retry", instance.currentNodeId());
            // A stale timer firing while the branch sits at "retry" is a no-op.
            assertSame(instance, engine.onReceiveEventTimeout(workflow, instance, "recv"));
            instance = engine.completeNode(workflow, instance, "retry", new NodeResult(NodeResultStatus.COMPLETED, Map.of()));
            assertEquals("recv", instance.currentNodeId());
        }
        WorkflowInstance done = engine.completeNode(workflow, instance, "recv", EVENT);
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals(3, done.history().stream().filter(h -> h.nodeId().equals("retry")).count());
        assertEquals(4, done.history().stream().filter(h -> h.nodeId().equals("recv")).count());
    }

    @Test
    void validWorkflowHasNoTimeoutProblems() {
        assertTrue(codes(timeoutWorkflow("PT1H")).stream().noneMatch(c -> c.contains("TIMEOUT")));
    }

    @Test
    void invalidAndNonPositiveTimeoutsAreRejected() {
        for (String bad : List.of("PT0S", "-PT1M", "P1M", "soon")) {
            assertTrue(codes(timeoutWorkflow(bad)).contains("INVALID_RECEIVE_EVENT_TIMEOUT"), bad);
        }
    }

    @Test
    void nonStringTimeoutIsAShapeError() {
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), new WorkflowNode("recv", NodeType.RECEIVE_EVENT, "recv",
                Map.of("eventType", "payment", "timeout", 5), new Position(0, 0)), endNode("done")),
            List.of(edge("e1", "start", "recv"), edge("e2", "recv", "done")));
        assertTrue(codes(workflow).contains("INVALID_RECEIVE_EVENT_TIMEOUT"));
    }

    @Test
    void timeoutRequiresExactlyOneTimeoutEdge() {
        Workflow missing = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNodeWithTimeout("recv", "payment", "PT1H"), endNode("done")),
            List.of(edge("e1", "start", "recv"), edge("e2", "recv", "done")));
        assertTrue(codes(missing).contains("MISSING_TIMEOUT_EDGE"));

        Workflow multiple = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNodeWithTimeout("recv", "payment", "PT1H"),
                endNode("done"), endNode("a"), endNode("b")),
            List.of(edge("e1", "start", "recv"), edge("e2", "recv", "done"),
                timeoutEdge("t1", "recv", "a"), timeoutEdge("t2", "recv", "b")));
        assertTrue(codes(multiple).contains("MULTIPLE_TIMEOUT_EDGES"));

        Workflow onlyTimeout = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNodeWithTimeout("recv", "payment", "PT1H"), endNode("a")),
            List.of(edge("e1", "start", "recv"), timeoutEdge("t1", "recv", "a")));
        assertTrue(codes(onlyTimeout).contains("MISSING_EVENT_EDGE"));
    }

    @Test
    void timeoutEdgeFromInvalidSourceIsRejected() {
        Workflow noTimeout = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receiveEventNode("recv", "payment"), endNode("done"), endNode("a")),
            List.of(edge("e1", "start", "recv"), edge("e2", "recv", "done"), timeoutEdge("t1", "recv", "a")));
        assertTrue(codes(noTimeout).contains("INVALID_TIMEOUT_EDGE"));

        Workflow fromStart = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("done"), endNode("a")),
            List.of(edge("e1", "start", "done"), timeoutEdge("t1", "start", "a")));
        assertTrue(codes(fromStart).contains("INVALID_TIMEOUT_EDGE"));
    }

    @Test
    void timeoutEdgeRoundTripsThroughJson() throws Exception {
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        Workflow workflow = timeoutWorkflow("PT1H");
        String json = mapper.writeValueAsString(workflow);
        Workflow read = mapper.readValue(json, Workflow.class);
        assertTrue(read.edges().stream().filter(e -> e.id().equals("t1")).findFirst().orElseThrow().isTimeout());
        assertFalse(mapper.writeValueAsString(read.edges().get(0)).contains("isTimeout"));
        assertEquals("PT1H", ((NodeConfig.ReceiveEvent) read.findNodeById("recv").orElseThrow().typedConfig()).timeout());
    }
}
