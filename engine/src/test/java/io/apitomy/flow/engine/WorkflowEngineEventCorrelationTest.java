package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests event correlation for receive-event nodes: matching events by type,
 * matching with EL expressions against context and nested event data, rejecting
 * events for non-waiting or non-receive-event nodes, wildcard matching with empty
 * match lists, and merging event payloads into the workflow context on completion.
 */
class WorkflowEngineEventCorrelationTest {

    private WorkflowEngine engine;

    @BeforeEach
    void setUp() {
        engine = new WorkflowEngine(List.of(), List.of(), null);
    }

    private Workflow receiveEventWorkflow(String eventType) {
        return new Workflow("w", "W", null,
            List.of(startNode("start"), receiveEventNode("wait", eventType), endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
    }

    private Workflow receiveEventWorkflowWithMatch(String eventType, List<String> match) {
        return new Workflow("w", "W", null,
            List.of(startNode("start"), receiveEventNode("wait", eventType, match), endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
    }

    @Test
    void matchesEventByType() {
        Workflow workflow = receiveEventWorkflow("pr-merged");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, instance.status());

        assertTrue(engine.matchesEvent(workflow, instance, Map.of("type", "pr-merged")));
        assertFalse(engine.matchesEvent(workflow, instance, Map.of("type", "pr-opened")));
    }

    @Test
    void matchesEventWithELExpressions() {
        Workflow workflow = receiveEventWorkflowWithMatch("pr-merged", List.of(
            "event.repository == context.repo",
            "event.pr_number == context.prNum"
        ));
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("repo", "apitomy/axiom", "prNum", 42));

        assertTrue(engine.matchesEvent(workflow, instance,
            Map.of("type", "pr-merged", "repository", "apitomy/axiom", "pr_number", 42)));

        assertFalse(engine.matchesEvent(workflow, instance,
            Map.of("type", "pr-merged", "repository", "other/repo", "pr_number", 42)));
    }

    @Test
    void matchesEventWithNestedEventData() {
        Workflow workflow = receiveEventWorkflowWithMatch("pr-merged", List.of(
            "event.pull_request.number == context.prNum"
        ));
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("prNum", 99));

        assertTrue(engine.matchesEvent(workflow, instance,
            Map.of("type", "pr-merged", "pull_request", Map.of("number", 99))));

        assertFalse(engine.matchesEvent(workflow, instance,
            Map.of("type", "pr-merged", "pull_request", Map.of("number", 100))));
    }

    @Test
    void matchesEventReturnsFalseForNonWaiting() {
        Workflow workflow = receiveEventWorkflow("test");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance completed = engine.completeCurrentNode(workflow, instance,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));

        assertFalse(engine.matchesEvent(workflow, completed, Map.of("type", "test")));
    }

    @Test
    void matchesEventReturnsFalseForNonReceiveEventNode() {
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertFalse(engine.matchesEvent(workflow, instance, Map.of("type", "any")));
    }

    @Test
    void matchesEventWithEmptyMatchListMatchesAnyOfType() {
        Workflow workflow = receiveEventWorkflow("deploy");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertTrue(engine.matchesEvent(workflow, instance,
            Map.of("type", "deploy", "extra", "data")));
    }

    @Test
    void completeReceiveEventMergesEventPayload() {
        Workflow workflow = receiveEventWorkflow("notify");
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        Map<String, Object> eventPayload = Map.of("message", "hello", "sender", "system");
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, eventPayload));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("hello", completed.context().get("message"));
        assertEquals("system", completed.context().get("sender"));
    }
}
