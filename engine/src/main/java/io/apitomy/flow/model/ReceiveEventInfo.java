package io.apitomy.flow.model;

import java.util.List;

/**
 * Host-facing description of a parked receive-event node.
 *
 * @param nodeId           the receive-event node's id
 * @param nodeName         the receive-event node's name
 * @param eventType        the event type the node waits for
 * @param matchExpressions the node's match expressions
 * @param outputMappings   the node's output mappings
 * @param lookback         how far back the host should search stored events; never {@code null}
 *                         (defaults to {@link EventLookback#RUN_START})
 */
public record ReceiveEventInfo(
    String nodeId,
    String nodeName,
    String eventType,
    List<String> matchExpressions,
    List<EventOutputMapping> outputMappings,
    EventLookback lookback
) {
    /**
     * Canonical constructor; a {@code null} lookback defaults to {@link EventLookback#RUN_START}.
     *
     * @param nodeId           the receive-event node's id
     * @param nodeName         the receive-event node's name
     * @param eventType        the event type the node waits for
     * @param matchExpressions the node's match expressions
     * @param outputMappings   the node's output mappings
     * @param lookback         the parsed look-back, or {@code null} for the default
     */
    public ReceiveEventInfo {
        if (lookback == null) {
            lookback = EventLookback.RUN_START;
        }
    }

    /**
     * Backward-compatible constructor for callers built before {@code lookback} was added; defaults it to
     * {@link EventLookback#RUN_START}.
     *
     * @param nodeId           the receive-event node's id
     * @param nodeName         the receive-event node's name
     * @param eventType        the event type the node waits for
     * @param matchExpressions the node's match expressions
     * @param outputMappings   the node's output mappings
     */
    public ReceiveEventInfo(String nodeId, String nodeName, String eventType, List<String> matchExpressions,
                            List<EventOutputMapping> outputMappings) {
        this(nodeId, nodeName, eventType, matchExpressions, outputMappings, EventLookback.RUN_START);
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
        this(nodeId, nodeName, eventType, matchExpressions, List.of());
    }
}
