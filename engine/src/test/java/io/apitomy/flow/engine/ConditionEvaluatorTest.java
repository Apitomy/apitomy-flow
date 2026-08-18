package io.apitomy.flow.engine;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests the JUEL-based condition evaluator used for edge routing decisions,
 * covering equality checks, nested map access, numeric comparisons, boolean
 * logic, null-safe property access, invalid expressions, and event-based evaluation.
 */
class ConditionEvaluatorTest {

    private ConditionEvaluator evaluator;

    @BeforeEach
    void setUp() {
        evaluator = new ConditionEvaluator();
    }

    @Test
    void nullConditionReturnsTrue() {
        assertTrue(evaluator.evaluate(null, Map.of()));
    }

    @Test
    void emptyConditionReturnsTrue() {
        assertTrue(evaluator.evaluate("", Map.of()));
    }

    @Test
    void blankConditionReturnsTrue() {
        assertTrue(evaluator.evaluate("   ", Map.of()));
    }

    @Test
    void simpleEquality() {
        Map<String, Object> context = Map.of("status", "active");
        assertTrue(evaluator.evaluate("context.status == 'active'", context));
        assertFalse(evaluator.evaluate("context.status == 'inactive'", context));
    }

    @Test
    void nestedMapAccess() {
        Map<String, Object> context = Map.of("result", Map.of("status", "affected"));
        assertTrue(evaluator.evaluate("context.result.status == 'affected'", context));
        assertFalse(evaluator.evaluate("context.result.status == 'clean'", context));
    }

    @Test
    void numericComparison() {
        Map<String, Object> context = Map.of("score", 85);
        assertTrue(evaluator.evaluate("context.score > 80", context));
        assertFalse(evaluator.evaluate("context.score > 90", context));
    }

    @Test
    void booleanLogic() {
        Map<String, Object> context = Map.of("a", true, "b", false);
        assertTrue(evaluator.evaluate("context.a && !context.b", context));
        assertFalse(evaluator.evaluate("context.a && context.b", context));
    }

    @Test
    void nullSafeAccess() {
        Map<String, Object> context = Map.of("key", "value");
        assertFalse(evaluator.evaluate("context.missing != null", context));
    }

    @Test
    void invalidExpressionThrows() {
        assertThrows(ConditionEvaluationException.class, () ->
            evaluator.evaluate("this is not valid EL !!!", Map.of()));
    }

    @Test
    void evaluateWithContextAndEvent() {
        Map<String, Object> context = Map.of("repository", "apitomy/axiom");
        Map<String, Object> event = Map.of("repository", "apitomy/axiom", "action", "merged");
        assertTrue(evaluator.evaluate("event.repository == context.repository", context, event));
        assertTrue(evaluator.evaluate("event.action == 'merged'", context, event));
        assertFalse(evaluator.evaluate("event.action == 'closed'", context, event));
    }

    @Test
    void evaluateWithNestedEvent() {
        Map<String, Object> context = Map.of("prNumber", 42);
        Map<String, Object> event = Map.of("pull_request", Map.of("number", 42));
        assertTrue(evaluator.evaluate("event.pull_request.number == context.prNumber", context, event));
    }
}
