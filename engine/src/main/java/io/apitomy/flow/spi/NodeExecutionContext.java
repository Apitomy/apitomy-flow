package io.apitomy.flow.spi;

import io.apitomy.flow.model.WorkflowNode;
import java.util.Map;

public record NodeExecutionContext(
    WorkflowNode node,
    Map<String, Object> inputs,
    Map<String, Object> nodeConfig
) {}
