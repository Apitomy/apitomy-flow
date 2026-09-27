package io.apitomy.flow.spi;

import io.apitomy.flow.model.JsonSnapshots;
import io.apitomy.flow.model.WorkflowNode;

import java.util.Map;

public record NodeExecutionContext(
    WorkflowNode node,
    Map<String, Object> inputs,
    Map<String, Object> nodeConfig
) {
    /** Owns executor inputs and configuration; tree reads are detached from earlier snapshots. */
    public NodeExecutionContext {
        inputs = JsonSnapshots.map(inputs);
        nodeConfig = JsonSnapshots.map(nodeConfig);
    }
}
