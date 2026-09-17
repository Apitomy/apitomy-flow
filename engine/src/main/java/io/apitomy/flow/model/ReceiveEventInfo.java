package io.apitomy.flow.model;

import java.util.List;

public record ReceiveEventInfo(
    String nodeId,
    String nodeName,
    String eventType,
    List<String> matchExpressions,
    List<EventOutputMapping> outputMappings
) {
    /**
     * Backward-compatible constructor for callers built before {@code outputMappings} was added;
     * defaults it to an empty list.
     *
     * @param nodeId           the receive-event node's id
     * @param nodeName         the receive-event node's name
     * @param eventType        the event type the node waits for
     * @param matchExpressions the node's match expressions
     */
    public ReceiveEventInfo(String nodeId, String nodeName, String eventType, List<String> matchExpressions) {
        this(nodeId, nodeName, eventType, matchExpressions, List.of());
    }
}
