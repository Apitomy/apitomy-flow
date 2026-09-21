package io.apitomy.flow.validation;

import io.apitomy.flow.model.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Structural preflight for model data, including untyped nested config values. */
final class WorkflowShape {
    private WorkflowShape() {
    }

    static List<ValidationProblem> validate(Workflow workflow) {
        List<ValidationProblem> problems = new ArrayList<>();
        if (workflow == null) {
            problems.add(ValidationProblem.error("INVALID_WORKFLOW", "Workflow must be an object"));
            return problems;
        }
        // Iterate as Object so malformed raw collections also produce diagnostics rather than casts.
        for (Object entry : workflow.nodes()) {
            if (!(entry instanceof WorkflowNode node)) {
                problems.add(ValidationProblem.error("INVALID_NODE", "Node must be an object"));
                continue;
            }
            check(node.id() != null && !node.id().isBlank(), "MISSING_NODE_ID", "id",
                "a non-blank string", node.id(), problems);
            check(node.type() != null, "INVALID_NODE_TYPE", "type", "a supported node kind", node.id(), problems);
            check(node.position() == null || (Double.isFinite(node.position().x()) && Double.isFinite(node.position().y())),
                "INVALID_NODE_POSITION", "position", "finite coordinates", node.id(), problems);
            validateConfig(node, problems);
        }
        for (Object entry : workflow.edges()) {
            if (!(entry instanceof WorkflowEdge edge)) {
                problems.add(ValidationProblem.error("INVALID_EDGE", "Edge must be an object"));
                continue;
            }
            if (edge.id() == null || edge.id().isBlank()) {
                problems.add(ValidationProblem.edgeError("MISSING_EDGE_ID", "Edge must have an ID", edge.id()));
            }
            if (edge.source() == null || edge.source().isBlank()) {
                problems.add(ValidationProblem.edgeError("MISSING_EDGE_SOURCE", "Edge must have a source", edge.id()));
            }
            if (edge.target() == null || edge.target().isBlank()) {
                problems.add(ValidationProblem.edgeError("MISSING_EDGE_TARGET", "Edge must have a target", edge.id()));
            }
        }
        return problems;
    }

    private static void validateConfig(WorkflowNode node, List<ValidationProblem> problems) {
        Map<String, Object> config = node.config();
        NodeType type = node.type();
        if (type == NodeType.ACTION) optionalString(config, "actionType", "INVALID_ACTION_TYPE_VALUE", node.id(), problems);
        if (type == NodeType.HUMAN_TASK) optionalString(config, "description", "INVALID_TASK_DESCRIPTION", node.id(), problems);
        if (type == NodeType.WAIT) optionalString(config, "duration", "INVALID_WAIT_DURATION", node.id(), problems);
        if (type == NodeType.RECEIVE_EVENT) {
            optionalString(config, "eventType", "INVALID_EVENT_TYPE_VALUE", node.id(), problems);
            Object match = config.get("match");
            check(match == null || (match instanceof List<?> list && list.stream().allMatch(String.class::isInstance)),
                "INVALID_MATCH_TYPE", "config.match", "a list of strings", node.id(), problems);
        }
        if (type == NodeType.ACTION || type == NodeType.HUMAN_TASK) {
            Object inputs = config.get("inputs");
            check(inputs == null || (inputs instanceof Map<?, ?> map && map.keySet().stream().allMatch(String.class::isInstance)),
                "INVALID_INPUTS_TYPE", "config.inputs", "a map with string keys", node.id(), problems);
        }
        if (type == NodeType.START) {
            definitions(config.get("inputs"), "inputs", "INVALID_INPUT_DEFINITION", false, node.id(), problems);
        }
        if (type == NodeType.ACTION || type == NodeType.HUMAN_TASK || type == NodeType.RECEIVE_EVENT) {
            definitions(config.get("outputs"), "outputs", "INVALID_OUTPUT_DEFINITION",
                type == NodeType.RECEIVE_EVENT, node.id(), problems);
        }
    }

    private static void definitions(Object value, String key, String code, boolean eventMappings,
                                    String nodeId, List<ValidationProblem> problems) {
        if (value == null) return;
        if (!(value instanceof List<?> list)) {
            check(false, key.equals("inputs") ? "INVALID_INPUTS_TYPE" : "INVALID_OUTPUTS_TYPE",
                "config." + key, "a list", nodeId, problems);
            return;
        }
        for (int i = 0; i < list.size(); i++) {
            String path = "config." + key + "[" + i + "]";
            if (!(list.get(i) instanceof Map<?, ?> def)) {
                check(false, eventMappings ? "MISSING_OUTPUT_CONTEXT_KEY" : code, path, "an object", nodeId, problems);
                continue;
            }
            if (eventMappings) {
                check(def.get("contextKey") == null || def.get("contextKey") instanceof String,
                    "MISSING_OUTPUT_CONTEXT_KEY", path + ".contextKey", "a string", nodeId, problems);
                check(def.get("expression") == null || def.get("expression") instanceof String,
                    "MISSING_OUTPUT_EXPRESSION", path + ".expression", "a string", nodeId, problems);
                continue;
            }
            check(def.get("name") instanceof String, code, path + ".name", "a string", nodeId, problems);
            for (String field : List.of("type", "description", "label", "widget", "contextKey")) {
                check(def.get(field) == null || def.get(field) instanceof String,
                    code, path + "." + field, "a string", nodeId, problems);
            }
            check(def.get("required") == null || def.get("required") instanceof Boolean,
                code, path + ".required", "a boolean", nodeId, problems);
            Object options = def.get("options");
            check(options == null || options instanceof List<?>, code, path + ".options", "a list", nodeId, problems);
            if (options instanceof List<?> optionList) {
                for (int j = 0; j < optionList.size(); j++) {
                    Object option = optionList.get(j);
                    check(option instanceof Map<?, ?> opt
                        && (opt.get("label") == null || opt.get("label") instanceof String)
                        && (opt.get("value") == null || opt.get("value") instanceof String),
                        "MALFORMED_OUTPUT_OPTION", path + ".options[" + j + "]",
                        "an object with string label/value", nodeId, problems);
                }
            }
        }
    }

    private static void optionalString(Map<String, Object> config, String key, String code,
                                       String nodeId, List<ValidationProblem> problems) {
        check(config.get(key) == null || config.get(key) instanceof String,
            code, "config." + key, "a string", nodeId, problems);
    }

    private static void check(boolean valid, String code, String path, String expected,
                              String nodeId, List<ValidationProblem> problems) {
        if (!valid) problems.add(ValidationProblem.error(code, path + " must be " + expected, nodeId));
    }
}
