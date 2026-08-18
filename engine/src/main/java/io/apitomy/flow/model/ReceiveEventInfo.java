package io.apitomy.flow.model;

import java.util.List;

public record ReceiveEventInfo(
    String nodeId,
    String nodeName,
    String eventType,
    List<String> matchExpressions
) {}
