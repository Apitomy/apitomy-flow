package io.apitomy.flow.model;

import java.util.Map;

public record WorkflowNode(
    String id,
    NodeType type,
    String name,
    Map<String, Object> config,
    Position position
) {
    /** Owns nested configuration according to {@link JsonSnapshots}' JSON/opaque value policy. */
    public WorkflowNode {
        config = JsonSnapshots.map(config == null ? Map.of() : config);
    }
}
