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

    /** Executor that parks (PENDING) every call. */
    static NodeExecutor pending(AtomicInteger calls) {
        return new NodeExecutor() {
            @Override public String actionType() { return "flaky"; }
            @Override public NodeResult execute(NodeExecutionContext context) {
                calls.incrementAndGet();
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };
    }

    @Test
    void retryNodeRunsParkedRetryAndClearsRetryAt() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowEngine engine = engine(flaky(1, calls), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3, "delay", "PT30S"), null);
        WorkflowInstance parked = engine.startWorkflow(workflow, Map.of());

        assertEquals(List.of(new RetryInfo("act", "root", 2, NOW.plusSeconds(30))),
            engine.getPendingRetries(parked));
        assertNull(engine.getActionInfo(workflow, parked, "act"), "a scheduled retry is not pending async work");
        assertThrows(IllegalStateException.class, () -> engine.completeNode(workflow, parked, "act",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of())));

        WorkflowInstance done = engine.retryNode(workflow, parked, "act");
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals(2, calls.get());
        assertEquals(2, actEntry(done).attempt());
        assertNull(actEntry(done).retryAt());
        assertEquals(List.of(), engine.getPendingRetries(done));
    }

    @Test
    void lateOrDuplicateRetryNodeIsNoOp() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowEngine engine = engine(flaky(1, calls), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3, "delay", "PT30S"), null);
        WorkflowInstance done = engine.retryNode(workflow, engine.startWorkflow(workflow, Map.of()), "act");
        assertSame(done, engine.retryNode(workflow, done, "act"));
        assertEquals(2, calls.get());
    }

    @Test
    void retryNodeIgnoresAsyncPendingAction() {
        WorkflowEngine engine = engine(pending(new AtomicInteger()), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3), null);
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        assertSame(waiting, engine.retryNode(workflow, waiting, "act"));
    }

    @Test
    void attemptCountSurvivesAsyncResumes() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowEngine engine = engine(pending(calls), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3), null);
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        NodeResult failed = new NodeResult(NodeResultStatus.FAILED, Map.of("error", "boom"));

        instance = engine.completeNode(workflow, instance, "act", failed); // attempt 1 fails -> runs attempt 2
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals(2, actEntry(instance).attempt());
        instance = engine.completeNode(workflow, instance, "act", failed); // attempt 2 fails -> runs attempt 3
        assertEquals(3, actEntry(instance).attempt());
        instance = engine.completeNode(workflow, instance, "act", failed); // attempt 3 fails -> exhausted
        assertEquals(InstanceStatus.FAILED, instance.status());
        assertTrue(instance.failureReason().startsWith("Exceeded retry limit (2): "), instance.failureReason());
        assertEquals(3, calls.get());
    }

    @Test
    void asyncFailureWithDelayParksForRetry() {
        WorkflowEngine engine = engine(pending(new AtomicInteger()), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3, "delay", "PT5S"), null);
        WorkflowInstance instance = engine.completeNode(workflow, engine.startWorkflow(workflow, Map.of()), "act",
            new NodeResult(NodeResultStatus.FAILED, Map.of()));
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals(List.of(new RetryInfo("act", "root", 2, NOW.plusSeconds(5))),
            engine.getPendingRetries(instance));
    }

    @Test
    void legacyHandlerSeesCallLocalAttemptNumbers() {
        List<Integer> seen = new ArrayList<>();
        WorkflowErrorHandler handler = new WorkflowErrorHandler() {
            @Override public ErrorResolution handleError(WorkflowInstance i, WorkflowNode n, NodeResult r,
                                                         WorkflowError e, RetryContext retry) {
                seen.add(retry.attempt());
                return retry.attempt() < 3 ? ErrorResolution.retry() : ErrorResolution.fail();
            }
            @Override public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n, NodeResult r,
                                                             Exception e) { return ErrorResolution.fail(); }
            @Override public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };
        WorkflowInstance instance = engine(flaky(Integer.MAX_VALUE, new AtomicInteger()), handler)
            .startWorkflow(workflow(null, null), Map.of());
        assertEquals(List.of(1, 2, 3), seen);
        assertEquals(InstanceStatus.FAILED, instance.status());
    }
    /** Executor for {@code type} that fails the first {@code failures} calls and then completes. */
    static NodeExecutor typed(String type, int failures, AtomicInteger calls) {
        return new NodeExecutor() {
            @Override public String actionType() { return type; }
            @Override public NodeResult execute(NodeExecutionContext context) {
                if (calls.incrementAndGet() <= failures) throw new IllegalStateException(type + " boom");
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            }
        };
    }

    static WorkflowNode retryAction(String id, String type, Map<String, Object> retry) {
        Map<String, Object> config = new HashMap<>(Map.of("actionType", type));
        if (retry != null) config.put("retry", retry);
        return new WorkflowNode(id, NodeType.ACTION, id, config, new Position(100, 0));
    }

    /** start forks to A and B, which join at "j" and then reach end. */
    static Workflow forkJoin(Map<String, Object> retryA, Map<String, Object> retryB) {
        return new Workflow("wf-fj", "FJ", null, null,
            List.of(startNode("start"), retryAction("A", "ta", retryA), retryAction("B", "tb", retryB),
                actionNode("j", "tj"), endNode("end")),
            List.of(edge("e1", "start", "A"), edge("e2", "start", "B"),
                edge("e3", "A", "j"), edge("e4", "B", "j"), edge("e5", "j", "end")));
    }

    static WorkflowEngine multiEngine(NodeExecutor... executors) {
        return new WorkflowEngine(NodeExecutorProvider.fromList(executors), List.of(),
            alwaysRetry(new ArrayList<>()), CLOCK, new SplittableRandom(7));
    }

    @Test
    void parallelBranchParksWhileSiblingCompletesThenJoins() {
        AtomicInteger aCalls = new AtomicInteger();
        AtomicInteger bCalls = new AtomicInteger();
        AtomicInteger jCalls = new AtomicInteger();
        WorkflowEngine engine = multiEngine(typed("ta", 1, aCalls), typed("tb", 0, bCalls),
            typed("tj", 0, jCalls));
        Workflow workflow = forkJoin(Map.of("maxAttempts", 3, "delay", "PT30S"), null);

        WorkflowInstance parked = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, parked.status());
        List<RetryInfo> retries = engine.getPendingRetries(parked);
        assertEquals(1, retries.size());
        assertEquals("A", retries.get(0).nodeId());
        assertEquals(NOW.plusSeconds(30), retries.get(0).retryAt());
        assertEquals(1, bCalls.get());
        assertEquals(0, jCalls.get(), "join must not fire while A is parked");

        WorkflowInstance done = engine.retryNode(workflow, parked, "A");
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals(2, aCalls.get());
        assertEquals(1, jCalls.get());
    }

    @Test
    void twoBranchesParkedSimultaneously() {
        AtomicInteger aCalls = new AtomicInteger();
        AtomicInteger bCalls = new AtomicInteger();
        AtomicInteger jCalls = new AtomicInteger();
        WorkflowEngine engine = multiEngine(typed("ta", 1, aCalls), typed("tb", 1, bCalls),
            typed("tj", 0, jCalls));
        Map<String, Object> policy = Map.of("maxAttempts", 3, "delay", "PT30S");
        Workflow workflow = forkJoin(policy, policy);

        WorkflowInstance parked = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, parked.status());
        assertEquals(List.of("A", "B"),
            engine.getPendingRetries(parked).stream().map(RetryInfo::nodeId).sorted().toList());

        WorkflowInstance half = engine.retryNode(workflow, parked, "A");
        assertEquals(InstanceStatus.WAITING, half.status());
        assertEquals(List.of("B"), engine.getPendingRetries(half).stream().map(RetryInfo::nodeId).toList());
        assertEquals(0, jCalls.get());

        WorkflowInstance done = engine.retryNode(workflow, half, "B");
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals(1, jCalls.get());
        assertEquals(2, aCalls.get());
        assertEquals(2, bCalls.get());
    }

    @Test
    void retryAfterCancelIsNoOp() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowEngine engine = engine(flaky(1, calls), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3, "delay", "PT30S"), null);
        WorkflowInstance cancelled = engine.cancelWorkflow(workflow, engine.startWorkflow(workflow, Map.of()));
        assertEquals(InstanceStatus.CANCELLED, cancelled.status());
        assertSame(cancelled, engine.retryNode(workflow, cancelled, "act"));
        assertEquals(List.of(), engine.getPendingRetries(cancelled));
        assertEquals(1, calls.get());
    }

    @Test
    void nodePolicyOverridesWorkflowDefault() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(Map.of("maxAttempts", 2), Map.of("maxAttempts", 5)), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(2, calls.get());
    }

    @Test
    void exponentialBackoffGrowsDelay() {
        WorkflowEngine engine = engine(flaky(99, new AtomicInteger()), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 4, "delay", "PT1S", "backoff", "exponential",
            "multiplier", 3), null);
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        assertEquals(NOW.plusSeconds(1), actEntry(instance).retryAt());
        instance = engine.retryNode(workflow, instance, "act");
        assertEquals(NOW.plusSeconds(3), actEntry(instance).retryAt());
        instance = engine.retryNode(workflow, instance, "act");
        assertEquals(NOW.plusSeconds(9), actEntry(instance).retryAt());
    }

    @Test
    void jitterKeepsRetryAtWithinDelay() {
        WorkflowInstance instance = engine(flaky(99, new AtomicInteger()), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(Map.of("maxAttempts", 2, "delay", "PT10S", "jitter", true), null), Map.of());
        assertEquals(InstanceStatus.WAITING, instance.status());
        Instant retryAt = actEntry(instance).retryAt();
        assertNotNull(retryAt);
        assertFalse(retryAt.isBefore(NOW), retryAt.toString());
        assertFalse(retryAt.isAfter(NOW.plusSeconds(10)), retryAt.toString());
    }

    @Test
    void inlineRetryThenPendingThenFailedCompletion() {
        AtomicInteger calls = new AtomicInteger();
        NodeExecutor executor = new NodeExecutor() {
            @Override public String actionType() { return "flaky"; }
            @Override public NodeResult execute(NodeExecutionContext context) {
                if (calls.incrementAndGet() == 1) throw new IllegalStateException("first");
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };
        WorkflowEngine engine = engine(executor, alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3), null);
        NodeResult failed = new NodeResult(NodeResultStatus.FAILED, Map.of("error", "boom"));

        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals(2, actEntry(instance).attempt());

        instance = engine.completeNode(workflow, instance, "act", failed);
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals(3, actEntry(instance).attempt());
        assertEquals(3, calls.get());

        instance = engine.completeNode(workflow, instance, "act", failed);
        assertEquals(InstanceStatus.FAILED, instance.status());
        assertTrue(instance.failureReason().startsWith("Exceeded retry limit (2): "), instance.failureReason());
        assertEquals(3, calls.get());
    }
}
