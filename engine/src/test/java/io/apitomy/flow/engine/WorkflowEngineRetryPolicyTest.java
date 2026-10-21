package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.SplittableRandom;
import java.util.concurrent.atomic.AtomicInteger;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/** Tests declarative retry policies for action nodes. */
class WorkflowEngineRetryPolicyTest {

    static final Instant NOW = Instant.parse("2026-10-21T10:00:00Z");
    static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    /** Executor that fails the first {@code failures} calls and then completes. */
    static NodeExecutor flaky(int failures, AtomicInteger calls) {
        return new NodeExecutor() {
            @Override public String actionType() { return "flaky"; }
            @Override public NodeResult execute(NodeExecutionContext context) {
                if (calls.incrementAndGet() <= failures) throw new IllegalStateException("boom " + calls.get());
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            }
        };
    }

    /** Handler that always asks to retry, recording each RetryContext it sees. */
    static WorkflowErrorHandler alwaysRetry(List<RetryContext> seen) {
        return new WorkflowErrorHandler() {
            @Override public ErrorResolution handleError(WorkflowInstance i, WorkflowNode n, NodeResult r,
                                                         WorkflowError e, RetryContext retry) {
                seen.add(retry);
                return ErrorResolution.retry();
            }
            @Override public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n, NodeResult r,
                                                             Exception e) { return ErrorResolution.retry(); }
            @Override public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };
    }

    static Workflow workflow(Map<String, Object> nodeRetry, Map<String, Object> defaultRetry) {
        Map<String, Object> config = new HashMap<>(Map.of("actionType", "flaky", "inputs", Map.of(),
            "outputs", List.of()));
        if (nodeRetry != null) config.put("retry", nodeRetry);
        return new Workflow("w", "W", null, null,
            List.of(startNode("start"), new WorkflowNode("act", NodeType.ACTION, "act", config,
                new Position(100, 0)), endNode("end")),
            List.of(edge("e1", "start", "act"), edge("e2", "act", "end")),
            defaultRetry == null ? null : Map.of("retry", defaultRetry));
    }

    static WorkflowEngine engine(NodeExecutor executor, WorkflowErrorHandler handler) {
        return new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(), handler, CLOCK,
            new SplittableRandom(7));
    }

    static HistoryEntry actEntry(WorkflowInstance instance) {
        return instance.history().stream().filter(h -> h.nodeId().equals("act")).reduce((a, b) -> b).orElseThrow();
    }

    @Test
    void zeroDelayPolicyRetriesInlineUntilSuccess() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(2, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(Map.of("maxAttempts", 3), null), Map.of());
        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(3, calls.get());
        assertEquals(3, actEntry(result).attempt());
        assertNull(actEntry(result).retryAt());
    }

    @Test
    void exhaustionFailsWithRetryCount() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(Map.of("maxAttempts", 3), null), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(3, calls.get());
        assertTrue(result.failureReason().startsWith("Exceeded retry limit (2): "), result.failureReason());
    }

    @Test
    void maxAttemptsOneNeverRetries() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(Map.of("maxAttempts", 1), null), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(1, calls.get());
    }

    @Test
    void delayedRetryParksWithRetryAt() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(Map.of("maxAttempts", 3, "delay", "PT30S"), null), Map.of());
        assertEquals(InstanceStatus.WAITING, result.status());
        assertEquals(1, calls.get());
        assertEquals(2, actEntry(result).attempt());
        assertEquals(NOW.plusSeconds(30), actEntry(result).retryAt());
        assertNull(actEntry(result).completedOn());
    }

    @Test
    void workflowDefaultAppliesWhenNodeHasNoPolicy() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(null, Map.of("maxAttempts", 2)), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(2, calls.get());
    }

    @Test
    void legacyBehaviorUnchangedWithoutPolicy() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(null, null), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(11, calls.get());
        assertTrue(result.failureReason().startsWith("Exceeded retry limit (10): "), result.failureReason());
    }

    @Test
    void handlerReceivesAttemptAndPolicy() {
        List<RetryContext> seen = new ArrayList<>();
        engine(flaky(99, new AtomicInteger()), alwaysRetry(seen))
            .startWorkflow(workflow(Map.of("maxAttempts", 3), null), Map.of());
        assertEquals(List.of(1, 2, 3), seen.stream().map(RetryContext::attempt).toList());
        assertTrue(seen.stream().allMatch(c -> c.policy().orElseThrow().maxAttempts() == 3));
    }
}
