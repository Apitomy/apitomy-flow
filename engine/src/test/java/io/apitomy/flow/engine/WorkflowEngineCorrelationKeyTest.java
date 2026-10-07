package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.NodeExecutorProvider;
import io.apitomy.flow.validation.ValidationProblem;
import io.apitomy.flow.validation.WorkflowValidator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests the optional explicit {@code correlationKey} on receive-event nodes: model access, validation,
 * subscription-key exposure through {@link ReceiveEventInfo}, the event-key helper, and matching.
 */
class WorkflowEngineCorrelationKeyTest {

    private WorkflowEngine engine;

    @BeforeEach
    void setUp() {
        engine = new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
    }

    private static Workflow keyedWorkflow(Object correlationKey, List<String> match) {
        Map<String, Object> config = new HashMap<>();
        config.put("eventType", "order-shipped");
        config.put("match", match);
        if (correlationKey != null) {
            config.put("correlationKey", correlationKey);
        }
        WorkflowNode wait = new WorkflowNode("wait", NodeType.RECEIVE_EVENT, "wait", config, new Position(200, 0));
        return new Workflow("w", "W", null, null,
            List.of(startNode("start"), wait, endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
    }

    private static Map<String, Object> key(String subscriptionKey, String eventKey) {
        Map<String, Object> key = new HashMap<>();
        key.put("subscriptionKey", subscriptionKey);
        key.put("eventKey", eventKey);
        return key;
    }

    private static Map<String, Object> event(String orderId, String region) {
        return Map.of("type", "order-shipped", "data", Map.of("orderId", orderId, "region", region));
    }

    @Test
    void exposesEvaluatedSubscriptionKey() {
        Workflow workflow = keyedWorkflow(key("context.orderId", "event.data.orderId"), List.of());
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("orderId", "o-1"));

        ReceiveEventInfo info = engine.getReceiveEventInfo(workflow, instance);
        assertEquals("o-1", info.subscriptionKey());
    }

    @Test
    void subscriptionKeyIsNullWithoutCorrelationKey() {
        Workflow workflow = keyedWorkflow(null, List.of());
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("orderId", "o-1"));

        assertNull(engine.getReceiveEventInfo(workflow, instance).subscriptionKey());
        assertNull(engine.evaluateEventKey(workflow, "wait", event("o-1", "eu")));
    }

    @Test
    void evaluatesEventKey() {
        Workflow workflow = keyedWorkflow(key("context.orderId", "event.data.orderId"), List.of());
        assertEquals("o-7", engine.evaluateEventKey(workflow, "wait", event("o-7", "eu")));
        assertNull(engine.evaluateEventKey(workflow, "missing", event("o-7", "eu")));
    }

    @Test
    void supportsCompositeKeysViaConcatenation() {
        Workflow workflow = keyedWorkflow(
            key("context.orderId += ':' += context.region", "event.data.orderId += ':' += event.data.region"),
            List.of());
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("orderId", "o-1", "region", "eu"));

        assertEquals("o-1:eu", engine.getReceiveEventInfo(workflow, instance).subscriptionKey());
        assertEquals("o-1:eu", engine.evaluateEventKey(workflow, "wait", event("o-1", "eu")));
        assertTrue(engine.matchesEvent(workflow, instance, event("o-1", "eu")));
        assertFalse(engine.matchesEvent(workflow, instance, event("o-1", "us")));
    }

    @Test
    void matchesEventRequiresEqualKeys() {
        Workflow workflow = keyedWorkflow(key("context.orderId", "event.data.orderId"), List.of());
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("orderId", "o-1"));

        assertTrue(engine.matchesEvent(workflow, instance, event("o-1", "eu")));
        assertFalse(engine.matchesEvent(workflow, instance, event("o-2", "eu")));
        assertFalse(engine.matchesEvent(workflow, instance, Map.of("type", "order-shipped")));
    }

    @Test
    void matchExpressionsStillApplyAsExtraFilter() {
        Workflow workflow = keyedWorkflow(key("context.orderId", "event.data.orderId"),
            List.of("event.data.region == 'eu'"));
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("orderId", "o-1"));

        assertTrue(engine.matchesEvent(workflow, instance, event("o-1", "eu")));
        assertFalse(engine.matchesEvent(workflow, instance, event("o-1", "us")));
    }

    @Test
    void nullSubscriptionKeyNeverMatches() {
        Workflow workflow = keyedWorkflow(key("context.orderId", "event.data.missing"), List.of());
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertFalse(engine.matchesEvent(workflow, instance, event("o-1", "eu")));
    }

    @Test
    void validatorRequiresBothExpressions() {
        WorkflowValidator validator = new WorkflowValidator();
        List<ValidationProblem> problems = validator.validate(
            keyedWorkflow(key("context.orderId", null), List.of()));
        assertTrue(problems.stream().anyMatch(p -> p.code().equals("MISSING_CORRELATION_KEY_EXPRESSION")));
        assertTrue(validator.hasErrors(problems));
    }

    @Test
    void validatorRejectsUnparseableExpressions() {
        WorkflowValidator validator = new WorkflowValidator();
        List<ValidationProblem> problems = validator.validate(
            keyedWorkflow(key("context.orderId ==", "event.data.orderId"), List.of()));
        assertTrue(problems.stream().anyMatch(p -> p.code().equals("INVALID_CORRELATION_KEY_EXPRESSION")));
    }

    @Test
    void validatorAcceptsValidKey() {
        WorkflowValidator validator = new WorkflowValidator();
        List<ValidationProblem> problems = validator.validate(
            keyedWorkflow(key("context.orderId", "event.data.orderId"), List.of()));
        assertFalse(problems.stream().anyMatch(p -> p.code().contains("CORRELATION")));
    }

    @Test
    void shapeRejectsNonObjectKey() {
        WorkflowValidator validator = new WorkflowValidator();
        List<ValidationProblem> problems = validator.validate(keyedWorkflow("context.orderId", List.of()));
        assertTrue(problems.stream().anyMatch(p -> p.code().equals("INVALID_CORRELATION_KEY")));
    }
}
