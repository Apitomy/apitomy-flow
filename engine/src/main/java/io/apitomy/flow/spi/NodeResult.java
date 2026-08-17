package io.apitomy.flow.spi;

import java.util.Map;

public record NodeResult(
    NodeResultStatus status,
    Map<String, Object> output
) {}
