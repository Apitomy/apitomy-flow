package io.apitomy.flow.spi;

import io.apitomy.flow.model.JsonSnapshots;

import java.util.Map;

/**
 * Host result. Status must be non-null; output may be null (no values) and may contain null values but only
 * non-null string keys. The engine validates this boundary before merging. COMPLETED action results must
 * provide non-null required outputs; PENDING may be partial; FAILED output is diagnostic and is not merged.
 * The record remains permissive for source/wire compatibility; malformed responses enter engine recovery.
 */
public record NodeResult(
    NodeResultStatus status,
    Map<String, Object> output
) {
    /** Owns output before it is shared with the engine, error handlers, or event listeners. */
    public NodeResult {
        output = JsonSnapshots.map(output);
    }
}
