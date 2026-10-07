package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests that each history entry records the input values its node received at entry time, so viewers can
 * show per-visit inputs even after later nodes change the context.
 */
class WorkflowEngineHistoryInputTest {

    private static HistoryEntry entry(WorkflowInstance instance, String nodeId) {
        return instance.history().stream().filter(h -> h.nodeId().equals(nodeId)).findFirst().orElseThrow();
    }

    @Test
    void recordsStartAndActionInputsAsOfEntry() {
        NodeExecutor overwrite = new NodeExecutor() {
            public String actionType() { return "overwrite"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("id", "changed"));
            }
        };
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(overwrite), List.of(), null);
        WorkflowNode start = new WorkflowNode("start", NodeType.START, "Start",
            Map.of("inputs", List.of(Map.of("name", "id", "type", "string", "required", true))),
            new Position(0, 0));
        WorkflowNode action = new WorkflowNode("action", NodeType.ACTION, "Action",
            Map.of("actionType", "overwrite", "inputs", Map.of("theId", "context.id", "limit", 5)),
            new Position(100, 0));
        WorkflowNode task = new WorkflowNode("task", NodeType.HUMAN_TASK, "Task",
            Map.of("inputs", Map.of("theId", "context.id")), new Position(200, 0));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(start, action, task, endNode("end")),
            List.of(edge("e1", "start", "action"), edge("e2", "action", "task"), edge("e3", "task", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of("id", "original", "extra", 1));
        WorkflowInstance done = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));

        assertEquals("changed", done.context().get("id"));
        assertEquals(Map.of("id", "original"), entry(done, "start").input());
        assertEquals(Map.of("theId", "original", "limit", 5), entry(done, "action").input());
        assertEquals(Map.of("theId", "changed"), entry(done, "task").input());
        assertNull(entry(done, "end").input());
    }

    @Test
    void unresolvableInputsRecordNothing() {
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
        WorkflowNode task = new WorkflowNode("task", NodeType.HUMAN_TASK, "Task",
            Map.of("inputs", Map.of("bad", "this is not valid !!!")), new Position(100, 0));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), task, endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "end")));

        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertNull(entry(result, "task").input());
        assertNull(entry(result, "start").input());
    }
}
