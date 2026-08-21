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
    Map<String, Object> output
) {}
