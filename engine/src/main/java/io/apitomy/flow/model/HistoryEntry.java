package io.apitomy.flow.model;

import java.time.Instant;
import java.util.Map;

public record HistoryEntry(
    String nodeId,
    String nodeName,
    String edgeId,
    String edgeCondition,
    Instant enteredOn,
    Instant completedOn,
    Map<String, Object> output
) {}
