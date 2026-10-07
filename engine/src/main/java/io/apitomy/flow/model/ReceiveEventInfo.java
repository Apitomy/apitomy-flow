package io.apitomy.flow.model;

import java.time.Duration;
import java.util.List;

/**
 * Host-facing description of a parked RECEIVE_EVENT node.
 *
 * @param nodeId           the receive-event node's id
 * @param nodeName         the receive-event node's name
 * @param eventType        the event type the node waits for
 * @param matchExpressions the node's match expressions
 * @param outputMappings   the node's event output mappings
 * @param timeout          the configured timeout the host should schedule, or {@code null} when the node
 *                         waits indefinitely (or the configured value is invalid)
 */
public record ReceiveEventInfo(
    String nodeId,
    String nodeName,
    String eventType,
    List<String> matchExpressions,
    List<EventOutputMapping> outputMappings,
    Duration timeout
) {
    /**
     * Backward-compatible constructor for callers built before {@code timeout} was added; defaults it to
     * {@code null}.
     *
     * @param nodeId           the receive-event node's id
     * @param nodeName         the receive-event node's name
     * @param eventType        the event type the node waits for
     * @param matchExpressions the node's match expressions
     * @param outputMappings   the node's event output mappings
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
