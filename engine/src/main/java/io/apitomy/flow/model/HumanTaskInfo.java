package io.apitomy.flow.model;

import java.util.List;
import java.util.Map;

public record HumanTaskInfo(
    String nodeId,
    String nodeName,
    String description,
    Map<String, Object> inputs,
    List<OutputDefinition> outputs
) {

    public record OutputDefinition(
        String name,
        String type,
        boolean required
    ) {}
}
