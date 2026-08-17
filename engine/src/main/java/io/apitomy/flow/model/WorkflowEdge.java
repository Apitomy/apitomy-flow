package io.apitomy.flow.model;

public record WorkflowEdge(
    String id,
    String source,
    String target,
    String condition,
    int priority,
    boolean isDefault,
    String label
) {}
