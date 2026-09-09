package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonFormat;

import java.time.Instant;
import java.util.Map;

public record HistoryEntry(
    String nodeId,
    String nodeName,
    String edgeId,
    String edgeCondition,
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant enteredOn,
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant completedOn,
    Map<String, Object> output,
    String branchId
) {
    /**
     * Back-compat constructor for callers that predate branch attribution; sets {@code branchId} to
     * {@code null} (the root/non-parallel branch).
     */
    public HistoryEntry(String nodeId, String nodeName, String edgeId, String edgeCondition,
                        Instant enteredOn, Instant completedOn, Map<String, Object> output) {
        this(nodeId, nodeName, edgeId, edgeCondition, enteredOn, completedOn, output, null);
    }
}
