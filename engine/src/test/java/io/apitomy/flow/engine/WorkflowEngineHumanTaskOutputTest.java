package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests the optional rich output-field metadata (label, description, widget, defaultValue, options)
 * mapped by {@link WorkflowEngine#getHumanTaskInfo}. Verifies documented defaults are applied
 * (label falls back to name, widget is inferred from type) and that explicit metadata passes
 * through, while minimal {name, type, required} outputs remain backward-compatible.
 */
class WorkflowEngineHumanTaskOutputTest {

    private WorkflowEngine engine() {
        return new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
    }

    private WorkflowNode taskWithOutputs(List<Map<String, Object>> outputs) {
        return new WorkflowNode("task", NodeType.HUMAN_TASK, "task",
            Map.of("description", "Do it", "outputs", outputs),
            new Position(200, 0));
    }

    private Workflow workflowWith(WorkflowNode task) {
        return new Workflow("wf", "WF", null, null,
            List.of(startNode("start"), task, endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "end")));
    }

    private HumanTaskInfo infoFor(List<Map<String, Object>> outputs) {
        WorkflowEngine engine = engine();
        Workflow workflow = workflowWith(taskWithOutputs(outputs));
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, instance.status());
        return engine.getHumanTaskInfo(workflow, instance);
    }

    @Test
    void minimalOutputAppliesDefaults() {
        HumanTaskInfo info = infoFor(List.of(
            Map.of("name", "decision", "type", "string", "required", true)));

        OutputDefinition out = info.outputs().get(0);
        assertEquals("decision", out.name());
        assertEquals("string", out.type());
        assertTrue(out.required());
        assertEquals("decision", out.label(), "label defaults to name");
        assertEquals("text", out.widget(), "string widget defaults to text");
        assertNull(out.description());
        assertNull(out.defaultValue());
        assertNull(out.options());
    }

    @Test
    void widgetInferredFromType() {
        HumanTaskInfo info = infoFor(List.of(
            Map.of("name", "amount", "type", "number"),
            Map.of("name", "active", "type", "boolean"),
            Map.of("name", "payload", "type", "object")));

        assertEquals("number", info.outputs().get(0).widget());
        assertEquals("checkbox", info.outputs().get(1).widget());
        assertEquals("textarea", info.outputs().get(2).widget());
    }

    @Test
    void explicitMetadataPassesThrough() {
        HumanTaskInfo info = infoFor(List.of(Map.of(
            "name", "notes",
            "type", "string",
            "label", "Reviewer Notes",
            "description", "Explain your decision",
            "widget", "textarea",
            "defaultValue", "n/a")));

        OutputDefinition out = info.outputs().get(0);
        assertEquals("Reviewer Notes", out.label());
        assertEquals("Explain your decision", out.description());
        assertEquals("textarea", out.widget());
        assertEquals("n/a", out.defaultValue());
    }

    @Test
    void selectOptionsAreParsed() {
        HumanTaskInfo info = infoFor(List.of(Map.of(
            "name", "category",
            "type", "string",
            "widget", "select",
            "defaultValue", "a",
            "options", List.of(
                Map.of("label", "Alpha", "value", "a"),
                Map.of("label", "Beta", "value", "b")))));

        OutputDefinition out = info.outputs().get(0);
        assertEquals("select", out.widget());
        assertEquals("a", out.defaultValue());
        assertNotNull(out.options());
        assertEquals(2, out.options().size());
        assertEquals("Alpha", out.options().get(0).label());
        assertEquals("a", out.options().get(0).value());
        assertEquals("Beta", out.options().get(1).label());
        assertEquals("b", out.options().get(1).value());
    }
}
