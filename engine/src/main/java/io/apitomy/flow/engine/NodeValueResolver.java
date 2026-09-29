package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;

import java.util.*;

/**
 * Typed node input/result contract shared by synchronous execution, external completion and introspection.
 * Resolves values and diagnoses failures only; never mutates instances, drives branches or invokes recovery.
 */
final class NodeValueResolver {
    private final ConditionEvaluator evaluator;

    NodeValueResolver(ConditionEvaluator evaluator) {
        this.evaluator = evaluator;
    }

    Map<String, Object> inputs(WorkflowNode node, Map<String, Object> context) {
        Map<String, Object> inputs = switch (node.typedConfig()) {
            case NodeConfig.Action config -> config.inputs();
            case NodeConfig.HumanTask config -> config.inputs();
            default -> Map.of();
        };
        Map<String, Object> resolved = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : inputs.entrySet()) {
            Object value = entry.getValue();
            try {
                resolved.put(entry.getKey(), value instanceof String expression
                    ? evaluator.resolve(expression, context) : value);
            } catch (Exception error) {
                throw new WorkflowError(WorkflowError.Phase.INPUT_RESOLUTION, node.id(), null,
                    value instanceof String expression ? expression : null, entry.getKey(), error.getMessage(), error);
            }
        }
        return Collections.unmodifiableMap(resolved);
    }

    WorkflowError validateResult(WorkflowNode node, NodeResult result) {
        if (result == null || result.status() == null) {
            return new WorkflowError(WorkflowError.Phase.RESULT_VALIDATION, node.id(), null, null,
                result == null ? "result" : "status", "Node result and status must not be null", null);
        }
        if (result.output() != null
                && ((Map<?, ?>) result.output()).keySet().stream().anyMatch(key -> !(key instanceof String))) {
            return new WorkflowError(WorkflowError.Phase.RESULT_VALIDATION, node.id(), null, null,
                "output", "Node result output keys must be non-null strings", null);
        }
        if (result.status() == NodeResultStatus.FAILED) {
            return new WorkflowError(WorkflowError.Phase.EXECUTION, node.id(), null, null, null,
                "Node returned FAILED" + (result.output() == null ? "" : ": " + result.output()), null);
        }
        return null;
    }

    WorkflowError validateOutputs(WorkflowNode node, Map<String, Object> output) {
        for (NodeConfig.Field field : outputFields(node)) {
            String name = field.name();
            if (field.required() && (output == null || !output.containsKey(name) || output.get(name) == null)) {
                return new WorkflowError(WorkflowError.Phase.OUTPUT_VALIDATION, node.id(), null,
                    null, name, "Missing required output: " + name, null);
            }
        }
        return null;
    }

    void validateStartInputs(WorkflowNode node, Map<String, Object> context) {
        for (NodeConfig.Field field : ((NodeConfig.Start) node.typedConfig()).inputs()) {
            if (field.required() && !context.containsKey(field.name())) {
                throw new IllegalArgumentException("Missing required input: " + field.name());
            }
            if (field.required() && context.get(field.name()) == null) {
                throw new IllegalArgumentException("Required input is null: " + field.name());
            }
        }
    }

    /** Event mappings all see the same pre-merge context; a failed mapping publishes no partial output. */
    Map<String, Object> mergeOutput(WorkflowInstance instance, WorkflowNode node, Map<String, Object> output) {
        if (node.typedConfig() instanceof NodeConfig.ReceiveEvent config && !config.outputs().isEmpty()) {
            Map<String, Object> event = output == null ? Map.of() : output;
            Map<String, Object> mapped = new HashMap<>();
            for (NodeConfig.Mapping mapping : config.outputs()) {
                String key = mapping.contextKey();
                String expression = mapping.expression();
                if (key == null || key.isBlank() || expression == null || expression.isBlank()) continue;
                try {
                    mapped.put(key, evaluator.resolve(expression, instance.context(), event));
                } catch (Exception error) {
                    throw new WorkflowError(WorkflowError.Phase.OUTPUT_MAPPING, node.id(), null,
                        expression, key, error.getMessage(), error);
                }
            }
            return mapped;
        }
        return contextKeys(node, output);
    }

    /** Renames declared outputs; undeclared keys and literal null values pass through unchanged. */
    Map<String, Object> contextKeys(WorkflowNode node, Map<String, Object> output) {
        if (output == null || output.isEmpty()) return output;
        Map<String, String> renames = new HashMap<>();
        for (NodeConfig.Field field : outputFields(node)) {
            String name = field.name();
            if (name != null && !name.equals(field.effectiveContextKey())) {
                renames.put(name, field.effectiveContextKey());
            }
        }
        if (renames.isEmpty()) return output;
        Map<String, Object> remapped = new HashMap<>();
        output.forEach((key, value) -> remapped.put(renames.getOrDefault(key, key), value));
        return remapped;
    }

    OutputDefinition humanTaskOutput(NodeConfig.Field field) {
        String name = field.name();
        String type = field.type();
        String label = field.label() != null && !field.label().isBlank() ? field.label() : name;
        String widget = field.widget() != null && !field.widget().isBlank() ? field.widget() : switch (type == null ? "string" : type) {
            case "number" -> "number";
            case "boolean" -> "checkbox";
            case "object" -> "textarea";
            default -> "text";
        };
        String contextKey = field.contextKey() != null && !field.contextKey().isBlank() ? field.contextKey() : null;
        List<OutputOption> options = field.wire().get("options") == null ? null : field.options().stream()
            .map(option -> new OutputOption(option.label(), option.value())).toList();
        return new OutputDefinition(name, type, field.required(), label, field.description(), widget,
            field.defaultValue(), options, contextKey);
    }

    private List<NodeConfig.Field> outputFields(WorkflowNode node) {
        return switch (node.typedConfig()) {
            case NodeConfig.Action config -> config.outputs();
            case NodeConfig.HumanTask config -> config.outputs();
            default -> List.of();
        };
    }
}
