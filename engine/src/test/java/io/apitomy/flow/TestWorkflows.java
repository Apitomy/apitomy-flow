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

    /** start → (fork) a1, a2 → (AND-join) j → end. Actions use the given action types. */
    public static Workflow diamondForkJoinWorkflow(String t1, String t2, String tj) {
        return new Workflow("wf-diamond", "Diamond", null, null,
            List.of(startNode("start"), actionNode("a1", t1), actionNode("a2", t2),
                actionNode("j", tj), endNode("end")),
            List.of(edge("e1", "start", "a1"), edge("e2", "start", "a2"),
                edge("e3", "a1", "j"), edge("e4", "a2", "j"), edge("e5", "j", "end")));
    }

    /**
     * Nested fork/join. The OUTER fork (start) fans out to branch A ("A") and branch B ("B"). Branch A is
     * itself an INNER fork ("A" → "A1", "A2") that re-converges at the inner join ("innerJoin"); the inner
     * join then flows to the outer join ("outerJoin"), where it re-converges with branch B. The outer join
     * flows to a single END.
     *
     * <p>Action types: A="a", B="b", A1="a1", A2="a2", innerJoin="ij", outerJoin="oj".
     */
    public static Workflow nestedForkJoinWorkflow() {
        return new Workflow("wf-nested", "Nested", null, null,
            List.of(startNode("start"),
                actionNode("A", "a"), actionNode("B", "b"),
                actionNode("A1", "a1"), actionNode("A2", "a2"),
                actionNode("innerJoin", "ij"), actionNode("outerJoin", "oj"),
                endNode("end")),
            List.of(edge("e1", "start", "A"), edge("e2", "start", "B"),
                edge("e3", "A", "A1"), edge("e4", "A", "A2"),
                edge("e5", "A1", "innerJoin"), edge("e6", "A2", "innerJoin"),
                edge("e7", "innerJoin", "outerJoin"), edge("e8", "B", "outerJoin"),
                edge("e9", "outerJoin", "end")));
    }
}
