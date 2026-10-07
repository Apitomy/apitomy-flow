package io.apitomy.flow.model;

import java.util.List;

/**
 * Describes a parked receive-event node so hosts can correlate incoming events.
 *
 * @param nodeId           the receive-event node's id
 * @param nodeName         the receive-event node's name
 * @param eventType        the event type the node waits for
 * @param matchExpressions the node's match expressions
 * @param outputMappings   the node's output mappings
 * @param subscriptionKey  the evaluated correlation subscription key, or {@code null} when the node has no
 *                         correlation key configured (or it evaluated to null)
 */
public record ReceiveEventInfo(
    String nodeId,
    String nodeName,
    String eventType,
    List<String> matchExpressions,
    List<EventOutputMapping> outputMappings,
    String subscriptionKey
) {
    /**
     * Backward-compatible constructor for callers built before {@code subscriptionKey} was added;
     * defaults it to {@code null}.
     *
     * @param nodeId           the receive-event node's id
     * @param nodeName         the receive-event node's name
     * @param eventType        the event type the node waits for
     * @param matchExpressions the node's match expressions
     * @param outputMappings   the node's output mappings
     */
    public ReceiveEventInfo(String nodeId, String nodeName, String eventType, List<String> matchExpressions,
                            List<EventOutputMapping> outputMappings) {
        this(nodeId, nodeName, eventType, matchExpressions, outputMappings, null);
    }

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
        this(nodeId, nodeName, eventType, matchExpressions, List.of(), null);
    }
}
