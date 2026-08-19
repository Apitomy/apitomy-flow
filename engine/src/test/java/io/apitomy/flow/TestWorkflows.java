package io.apitomy.flow;

import io.apitomy.flow.model.*;
import java.util.List;
import java.util.Map;

public class TestWorkflows {

    public static WorkflowNode startNode(String id) {
        return new WorkflowNode(id, NodeType.START, "Start", Map.of(), new Position(0, 0));
    }

    public static WorkflowNode startNode(String id, List<Map<String, Object>> inputs) {
        return new WorkflowNode(id, NodeType.START, "Start", Map.of("inputs", inputs), new Position(0, 0));
    }

    public static WorkflowNode actionNode(String id, String actionType) {
        return new WorkflowNode(id, NodeType.ACTION, id, Map.of("actionType", actionType), new Position(100, 0));
    }

    public static WorkflowNode actionNode(String id, String actionType,
                                           Map<String, String> inputs, List<Map<String, Object>> outputs) {
        return new WorkflowNode(id, NodeType.ACTION, id,
            Map.of("actionType", actionType, "inputs", inputs, "outputs", outputs),
            new Position(100, 0));
    }

    public static WorkflowNode humanTaskNode(String id) {
        return new WorkflowNode(id, NodeType.HUMAN_TASK, id, Map.of(), new Position(200, 0));
    }

    public static WorkflowNode humanTaskNode(String id, String description,
                                              Map<String, String> inputs, List<Map<String, Object>> outputs) {
        return new WorkflowNode(id, NodeType.HUMAN_TASK, id,
            Map.of("description", description, "inputs", inputs, "outputs", outputs),
            new Position(200, 0));
    }

    public static WorkflowNode receiveEventNode(String id, String eventType) {
        return new WorkflowNode(id, NodeType.RECEIVE_EVENT, id,
            Map.of("eventType", eventType), new Position(200, 0));
    }

    public static WorkflowNode receiveEventNode(String id, String eventType, List<String> matchExpressions) {
        return new WorkflowNode(id, NodeType.RECEIVE_EVENT, id,
            Map.of("eventType", eventType, "match", matchExpressions), new Position(200, 0));
    }

    public static WorkflowNode waitNode(String id, String duration) {
        return new WorkflowNode(id, NodeType.WAIT, id,
            Map.of("duration", duration), new Position(200, 0));
    }

    public static WorkflowNode endNode(String id) {
        return new WorkflowNode(id, NodeType.END, "End", Map.of(), new Position(300, 0));
    }

    public static WorkflowEdge edge(String id, String source, String target) {
        return new WorkflowEdge(id, source, target, null, 0, false, null);
    }

    public static WorkflowEdge edge(String id, String source, String target, String condition, int priority) {
        return new WorkflowEdge(id, source, target, condition, priority, false, null);
    }

    public static WorkflowEdge defaultEdge(String id, String source, String target) {
        return new WorkflowEdge(id, source, target, null, Integer.MAX_VALUE, true, null);
    }

    public static Map<String, Object> inputDef(String name, String type, boolean required) {
        return Map.of("name", name, "type", type, "required", required);
    }

    /** Start → Action → End */
    public static Workflow simpleActionWorkflow(String actionType) {
        return new Workflow("wf-1", "Simple", null, null,
            List.of(startNode("start"), actionNode("action", actionType), endNode("end")),
            List.of(edge("e1", "start", "action"), edge("e2", "action", "end")));
    }

    /** Start → HumanTask → End */
    public static Workflow simpleHumanTaskWorkflow() {
        return new Workflow("wf-2", "HumanTask", null, null,
            List.of(startNode("start"), humanTaskNode("task"), endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "end")));
    }
}
