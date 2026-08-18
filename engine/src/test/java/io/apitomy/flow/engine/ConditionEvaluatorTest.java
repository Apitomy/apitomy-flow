package io.apitomy.flow.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

    @Test
    void resolveReturnsValue() {
        Map<String, Object> context = Map.of("name", "Alice", "score", 95);
        assertEquals("Alice", evaluator.resolve("context.name", context));
        assertEquals(95, evaluator.resolve("context.score", context));
    }

    @Test
    void resolveNestedValue() {
        Map<String, Object> context = Map.of("loan", Map.of("amount", 50000, "currency", "USD"));
        assertEquals(50000, evaluator.resolve("context.loan.amount", context));
        assertEquals("USD", evaluator.resolve("context.loan.currency", context));
    }

    @Test
    void resolveNullOrBlankReturnsNull() {
        assertNull(evaluator.resolve(null, Map.of()));
        assertNull(evaluator.resolve("", Map.of()));
        assertNull(evaluator.resolve("   ", Map.of()));
    }

    @Test
    void resolveInvalidExpressionThrows() {
        assertThrows(ConditionEvaluationException.class, () ->
            evaluator.resolve("this is not valid !!!", Map.of()));
    }

    @Test
    void jacksonObjectNodeNestedAccess() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode payload = mapper.readTree("""
            {
                "repository": "apitomy/flow",
                "pull_request": {
                    "number": 42,
                    "author": { "login": "alice" },
                    "merged": true
                },
                "labels": ["bug", "urgent"]
            }
            """);
        Map<String, Object> context = Map.of("eventPayload", payload);

        assertTrue(evaluator.evaluate("context.eventPayload.repository == 'apitomy/flow'", context));
        assertTrue(evaluator.evaluate("context.eventPayload.pull_request.number == 42", context));
        assertTrue(evaluator.evaluate("context.eventPayload.pull_request.author.login == 'alice'", context));
        assertTrue(evaluator.evaluate("context.eventPayload.pull_request.merged", context));
    }
}
