package io.apitomy.flow.model;

import java.util.Map;

public record WorkflowNode(
    String id,
    NodeType type,
    String name,
    Map<String, Object> config,
    Position position
) {}
