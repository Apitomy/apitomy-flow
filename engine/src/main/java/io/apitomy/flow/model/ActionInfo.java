package io.apitomy.flow.model;

import java.util.List;
import java.util.Map;

public record ActionInfo(
    String nodeId,
    String nodeName,
    String actionType,
    Map<String, Object> resolvedInputs,
    List<OutputDefinition> expectedOutputs
) {

    public record OutputDefinition(
        String name,
        String type,
        boolean required
    ) {}
}
