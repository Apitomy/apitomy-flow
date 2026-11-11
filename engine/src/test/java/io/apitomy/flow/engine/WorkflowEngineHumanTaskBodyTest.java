package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests the human-task {@code body} markdown template exposed through {@link WorkflowEngine#getHumanTaskInfo}:
 * embedded {@code ${...}} expressions are interpolated against the context, a failing expression becomes an
 * empty string, and an absent, blank or unparseable body falls back to the description.
 */
class WorkflowEngineHumanTaskBodyTest {

    private HumanTaskInfo infoFor(String description, String body, Map<String, Object> context) {
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
        Map<String, Object> config = new HashMap<>();
        if (description != null) config.put("description", description);
        if (body != null) config.put("body", body);
        WorkflowNode task = new WorkflowNode("task", NodeType.HUMAN_TASK, "Review Task", config, new Position(200, 0));
        Workflow workflow = new Workflow("wf", "WF", null, null,
            List.of(startNode("start"), task, endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "end")));
        WorkflowInstance instance = engine.startWorkflow(workflow, context);
        assertEquals(InstanceStatus.WAITING, instance.status());
        return engine.getHumanTaskInfo(workflow, instance);
    }

    @Test
    void interpolatesEmbeddedExpressionsIntoMarkdown() {
        HumanTaskInfo info = infoFor("Do it", "## Review ${context.cveId}\n\nSeverity: **${context.severity}**",
            Map.of("cveId", "CVE-1", "severity", "high"));
        assertEquals("## Review CVE-1\n\nSeverity: **high**", info.body());
        assertEquals("Do it", info.description());
    }

    @Test
    void returnsLiteralBodyUnchanged() {
        assertEquals("# Plain *markdown*", infoFor(null, "# Plain *markdown*", Map.of()).body());
    }

    @Test
    void convertsNonStringResultsToText() {
        assertEquals("Count: 42", infoFor(null, "Count: ${context.count}", Map.of("count", 42)).body());
    }

    @Test
    void handlesBracesAndQuotesInsideExpressions() {
        assertEquals("a}b x", infoFor(null, "${'a}b'} ${context.v}", Map.of("v", "x")).body());
    }

    @Test
    void replacesFailingOrNullExpressionsWithEmptyString() {
        assertEquals("A: , B: ok", infoFor("Do it", "A: ${context.missing}, B: ${context.v}",
            Map.of("v", "ok")).body());
        assertEquals("X  Y", infoFor("Do it", "X ${'a' += context.missing} Y", Map.of()).body());
    }

    @Test
    void fallsBackToDescriptionWhenAbsentOrBlank() {
        assertEquals("Do it", infoFor("Do it", null, Map.of()).body());
        assertEquals("Do it", infoFor("Do it", "   ", Map.of()).body());
        assertNull(infoFor(null, null, Map.of()).body());
    }

    @Test
    void fallsBackToDescriptionWhenTemplateCannotBeParsed() {
        assertEquals("Do it", infoFor("Do it", "Hello ${context.name", Map.of("name", "x")).body());
    }

    @Test
    void legacyConstructorsUseDescriptionAsBody() {
        assertEquals("desc", new HumanTaskInfo("id", "Name", "desc", Map.of(), List.of()).body());
        assertEquals("desc", new HumanTaskInfo("id", "Name", "desc", Map.of(), List.of(), "T").body());
    }

    @Test
    void recordsResolvedBodyOnHistoryOnlyWhenABodyIsConfigured() {
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
        WorkflowNode withBody = new WorkflowNode("withBody", NodeType.HUMAN_TASK, "With",
            Map.of("body", "Item ${context.id}", "description", "d"), new Position(200, 0));
        WorkflowNode withoutBody = new WorkflowNode("withoutBody", NodeType.HUMAN_TASK, "Without",
            Map.of("description", "d"), new Position(300, 0));
        Workflow workflow = new Workflow("wf", "WF", null, null,
            List.of(startNode("start"), withBody, withoutBody, endNode("end")),
            List.of(edge("e1", "start", "withBody"), edge("e2", "withBody", "withoutBody"),
                edge("e3", "withoutBody", "end")));

        WorkflowInstance first = engine.startWorkflow(workflow, Map.of("id", "A-1"));
        WorkflowInstance second = engine.completeCurrentNode(workflow, first,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("id", "B-2")));

        Map<String, String> bodies = new HashMap<>();
        second.history().forEach(entry -> bodies.put(entry.nodeId(), entry.body()));
        assertEquals("Item A-1", bodies.get("withBody"));
        assertNull(bodies.get("withoutBody"));
        assertNull(bodies.get("start"));
    }
}
