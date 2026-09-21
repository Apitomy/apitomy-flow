package io.apitomy.flow.spi;

import io.apitomy.flow.model.JsonSnapshots;

import java.util.Map;

public record NodeResult(
    NodeResultStatus status,
    Map<String, Object> output
) {
    /** Owns output before it is shared with the engine, error handlers, or event listeners. */
    public NodeResult {
        output = JsonSnapshots.map(output);
    }
}
