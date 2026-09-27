package io.apitomy.flow.engine;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowEngineOwnershipTest {
    @Test
    void initialAndCompletionPayloadsCannotChangeReturnedSnapshots() {
        Workflow workflow = new Workflow("wf", "Workflow", null, null,
            List.of(startNode("start"), humanTaskNode("task", "Task", Map.of(), List.of()), endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "end")));
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
        Map<String, Object> nested = new LinkedHashMap<>(Map.of("value", 1));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of("nested", nested));
        nested.put("value", 2);
        assertEquals(1, ((Map<?, ?>) waiting.context().get("nested")).get("value"));
        Map<String, Object> output = new LinkedHashMap<>(Map.of("answer", nested));
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, output));
        nested.put("value", 3);
        output.clear();
        assertEquals(2, ((Map<?, ?>) completed.context().get("answer")).get("value"));
        HistoryEntry task = completed.history().stream().filter(entry -> entry.nodeId().equals("task"))
            .findFirst().orElseThrow();
        assertEquals(2, ((Map<?, ?>) task.output().get("answer")).get("value"));
        assertFalse(waiting.context().containsKey("answer"));
    }

    @Test
    void executorAndListenersCannotMutateEachOthersSnapshots() {
        ObjectNode tree = JsonNodeFactory.instance.objectNode().put("value", 1);
        Map<String, Object> output = new LinkedHashMap<>(Map.of("answer", tree));
        List<WorkflowInstance> observed = new ArrayList<>();
        AtomicReference<NodeExecutionContext> captured = new AtomicReference<>();
        NodeExecutor executor = new NodeExecutor() {
            /** Returns the fixture action type. */
            public String actionType() { return "process"; }
            /** Attempts to alter input and definition trees before returning host-owned output. */
            public NodeResult execute(NodeExecutionContext context) {
                captured.set(context);
                ((ObjectNode) context.inputs().get("payload")).put("value", 8);
                ((ObjectNode) context.nodeConfig().get("extension")).put("value", 8);
                return new NodeResult(NodeResultStatus.COMPLETED, output);
            }
        };
        WorkflowNode action = new WorkflowNode("action", NodeType.ACTION, "Action",
            Map.of("actionType", "process", "inputs", Map.of("payload", "context.tree"), "extension", tree), null);
        Workflow workflow = new Workflow("wf", "Workflow", null, null,
            List.of(startNode("start"), action, endNode("end")),
            List.of(edge("e1", "start", "action"), edge("e2", "action", "end")));
        WorkflowEventListener mutating = new WorkflowEventListener() {
            /** Attempts to alter a listener snapshot. */
            public void onWorkflowStarted(WorkflowInstance instance) {
                observed.add(instance);
                ((ObjectNode) instance.context().get("tree")).put("value", 9);
            }
            /** Attempts to alter the result before the next listener sees it. */
            public void onNodeCompleted(WorkflowInstance instance, WorkflowNode node, NodeResult result) {
                if (node.id().equals("action")) {
                    ((ObjectNode) result.output().get("answer")).put("value", 9);
                }
            }
        };
        WorkflowEventListener observing = new WorkflowEventListener() {
            /** Records the snapshot delivered after the mutating listener. */
            public void onWorkflowStarted(WorkflowInstance instance) { observed.add(instance); }
            /** Verifies that a preceding listener cannot alter the executor result. */
            public void onNodeCompleted(WorkflowInstance instance, WorkflowNode node, NodeResult result) {
                if (node.id().equals("action")) {
                    assertEquals(1, ((ObjectNode) result.output().get("answer")).path("value").asInt());
                }
            }
        };
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor),
            List.of(mutating, observing), null);
        WorkflowInstance completed = engine.startWorkflow(workflow, Map.of("tree", tree));
        tree.put("value", 10);
        output.clear();
        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals(2, observed.size());
        for (WorkflowInstance snapshot : observed) {
            assertEquals(1, ((ObjectNode) snapshot.context().get("tree")).path("value").asInt());
        }
        assertEquals(1, ((ObjectNode) completed.context().get("answer")).path("value").asInt());
        assertEquals(1, ((ObjectNode) captured.get().inputs().get("payload")).path("value").asInt());
        assertEquals(1, ((ObjectNode) action.config().get("extension")).path("value").asInt());
    }
}
