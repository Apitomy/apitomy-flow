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
 * Tests the human-task {@code title} expression exposed through {@link WorkflowEngine#getHumanTaskInfo}: it is
 * resolved against the context, and falls back to the node name when absent, blank, failing or null.
 */
class WorkflowEngineHumanTaskTitleTest {

    private HumanTaskInfo infoFor(Object title, Map<String, Object> context) {
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
        Map<String, Object> config = new HashMap<>(Map.of("description", "Do it"));
        if (title != null) config.put("title", title);
        WorkflowNode task = new WorkflowNode("task", NodeType.HUMAN_TASK, "Review Task", config, new Position(200, 0));
        Workflow workflow = new Workflow("wf", "WF", null, null,
            List.of(startNode("start"), task, endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "end")));
        WorkflowInstance instance = engine.startWorkflow(workflow, context);
        assertEquals(InstanceStatus.WAITING, instance.status());
        return engine.getHumanTaskInfo(workflow, instance);
    }

    @Test
    void resolvesTitleExpressionAgainstContext() {
        HumanTaskInfo info = infoFor("'Review ' += context.cveId", Map.of("cveId", "CVE-2024-1234"));
        assertEquals("Review CVE-2024-1234", info.title());
        assertEquals("Review Task", info.nodeName());
    }

    @Test
    void convertsNonStringResultsToText() {
        assertEquals("42", infoFor("context.count", Map.of("count", 42)).title());
    }

    @Test
    void fallsBackToNodeNameWhenAbsentOrBlank() {
        assertEquals("Review Task", infoFor(null, Map.of()).title());
        assertEquals("Review Task", infoFor("  ", Map.of()).title());
    }

    @Test
    void fallsBackToNodeNameWhenExpressionFailsOrIsNull() {
        assertEquals("Review Task", infoFor("'Review ' += context.missing", Map.of()).title());
        assertEquals("Review Task", infoFor("context.missing", Map.of()).title());
        assertEquals("Review Task", infoFor("'unterminated", Map.of()).title());
    }

    @Test
    void legacyConstructorUsesNodeNameAsTitle() {
        HumanTaskInfo info = new HumanTaskInfo("id", "Name", null, Map.of(), List.of());
        assertEquals("Name", info.title());
    }

    @Test
    void recordsComputedTitleOnTheHumanTaskHistoryEntryOnly() {
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
        WorkflowNode titled = new WorkflowNode("titled", NodeType.HUMAN_TASK, "Titled",
            Map.of("title", "'Review ' += context.id"), new Position(200, 0));
        WorkflowNode untitled = new WorkflowNode("untitled", NodeType.HUMAN_TASK, "Untitled",
            Map.of(), new Position(300, 0));
        Workflow workflow = new Workflow("wf", "WF", null, null,
            List.of(startNode("start"), titled, untitled, endNode("end")),
            List.of(edge("e1", "start", "titled"), edge("e2", "titled", "untitled"), edge("e3", "untitled", "end")));

        WorkflowInstance first = engine.startWorkflow(workflow, Map.of("id", "A-1"));
        WorkflowInstance second = engine.completeCurrentNode(workflow, first,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("id", "B-2")));

        Map<String, String> titles = new HashMap<>();
        second.history().forEach(entry -> titles.put(entry.nodeId(), entry.title()));
        assertEquals("Review A-1", titles.get("titled"));
        assertEquals("Untitled", titles.get("untitled"));
        assertNull(titles.get("start"));
    }
}
