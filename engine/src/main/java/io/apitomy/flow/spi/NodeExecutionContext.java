package io.apitomy.flow.spi;

import io.apitomy.flow.model.WorkflowNode;
import java.util.Map;

/**
 * Read-only execution inputs supplied by the engine: node, inputs and nodeConfig are non-null. Input values
 * may be null when legitimately resolved/literal. Hosts must not mutate nested values or retain mutable aliases.
 */
public record NodeExecutionContext(
    WorkflowNode node,
    Map<String, Object> inputs,
    Map<String, Object> nodeConfig
) {}
