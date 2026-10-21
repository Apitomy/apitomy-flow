package io.apitomy.flow.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/** Tests the declarative retry policy view, delay math, and effective-policy resolution. */
class RetryPolicyTest {

    private static RetryPolicy policy(Map<String, Object> wire) {
        return new RetryPolicy(wire);
    }

    @Test
    void appliesDefaults() {
        RetryPolicy p = policy(Map.of("maxAttempts", 3));
        assertEquals(3, p.maxAttempts());
        assertEquals(Duration.ZERO, p.delay());
        assertEquals(RetryPolicy.FIXED, p.backoff());
        assertEquals(2.0, p.multiplier());
        assertNull(p.maxDelay());
        assertFalse(p.jitter());
    }

    @Test
    void fixedDelayIsConstant() {
        RetryPolicy p = policy(Map.of("maxAttempts", 5, "delay", "PT2S"));
        assertEquals(Duration.ofSeconds(2), p.delayFor(1, new SplittableRandom(1)));
        assertEquals(Duration.ofSeconds(2), p.delayFor(4, new SplittableRandom(1)));
    }

    @Test
    void exponentialDelayGrowsAndIsCapped() {
        RetryPolicy p = policy(Map.of("maxAttempts", 10, "delay", "PT1S", "backoff", "exponential",
            "multiplier", 3, "maxDelay", "PT20S"));
        assertEquals(Duration.ofSeconds(1), p.delayFor(1, new SplittableRandom(1)));
        assertEquals(Duration.ofSeconds(3), p.delayFor(2, new SplittableRandom(1)));
        assertEquals(Duration.ofSeconds(9), p.delayFor(3, new SplittableRandom(1)));
        assertEquals(Duration.ofSeconds(20), p.delayFor(4, new SplittableRandom(1)));
        assertEquals(Duration.ofSeconds(20), p.delayFor(5000, new SplittableRandom(1)), "overflow saturates");
    }

    @Test
    void uncappedExponentialSaturatesAtOneYear() {
        RetryPolicy p = policy(Map.of("maxAttempts", 10, "delay", "PT1S", "backoff", "exponential"));
        assertEquals(RetryPolicy.MAX_UNCAPPED_DELAY, p.delayFor(5000, new SplittableRandom(1)));
    }

    @Test
    void jitterStaysWithinBounds() {
        RetryPolicy p = policy(Map.of("maxAttempts", 5, "delay", "PT10S", "jitter", true));
        SplittableRandom random = new SplittableRandom(42);
        for (int i = 0; i < 200; i++) {
            Duration d = p.delayFor(1, random);
            assertFalse(d.isNegative());
            assertTrue(d.compareTo(Duration.ofSeconds(10)) <= 0);
        }
    }

    @Test
    void nodePolicyOverridesWorkflowDefaultWholesale() {
        WorkflowNode own = new WorkflowNode("a", NodeType.ACTION, "a",
            Map.of("actionType", "t", "retry", Map.of("maxAttempts", 2)), new Position(0, 0));
        WorkflowNode inherits = actionNode("b", "t");
        Workflow workflow = new Workflow("w", "W", null, null, List.of(own, inherits), List.of(),
            Map.of("retry", Map.of("maxAttempts", 7, "delay", "PT1S")));
        RetryPolicy ownPolicy = RetryPolicy.effective(workflow, own).orElseThrow();
        assertEquals(2, ownPolicy.maxAttempts());
        assertEquals(Duration.ZERO, ownPolicy.delay());
        assertEquals(7, RetryPolicy.effective(workflow, inherits).orElseThrow().maxAttempts());
    }

    @Test
    void noPolicyAndNonActionNodesAreEmpty() {
        Workflow workflow = new Workflow("w", "W", null, null, List.of(actionNode("a", "t")), List.of());
        assertEquals(Optional.empty(), RetryPolicy.effective(workflow, actionNode("a", "t")));
        Workflow withDefault = new Workflow("w", "W", null, null, List.of(), List.of(),
            Map.of("retry", Map.of("maxAttempts", 3)));
        assertEquals(Optional.empty(), RetryPolicy.effective(withDefault, endNode("end")));
    }

    @Test
    void workflowDefaultsRoundTripAndAreOmittedWhenAbsent() throws Exception {
        ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());
        Workflow without = new Workflow("w", "W", null, null, List.of(), List.of());
        assertFalse(mapper.writeValueAsString(without).contains("defaults"));
        Workflow with = new Workflow("w", "W", null, null, List.of(), List.of(),
            Map.of("retry", Map.of("maxAttempts", 3)));
        Workflow read = mapper.readValue(mapper.writeValueAsString(with), Workflow.class);
        assertEquals(3, read.defaultRetryPolicy().orElseThrow().maxAttempts());
    }
}
