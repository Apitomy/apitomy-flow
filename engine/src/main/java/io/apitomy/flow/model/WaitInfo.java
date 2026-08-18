package io.apitomy.flow.model;

import java.time.Duration;

public record WaitInfo(
    String nodeId,
    String nodeName,
    Duration duration
) {}
