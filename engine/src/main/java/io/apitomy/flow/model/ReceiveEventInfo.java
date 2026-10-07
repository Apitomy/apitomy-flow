package io.apitomy.flow.model;

import java.time.Duration;
import java.util.List;

/**
 * Host-facing description of a parked receive-event node, so hosts can correlate incoming events and
 * schedule timeouts.
 *
 * @param nodeId           the receive-event node's id
 * @param nodeName         the receive-event node's name
 * @param eventType        the event type the node waits for
 * @param matchExpressions the node's match expressions
 * @param outputMappings   the node's event output mappings
 * @param lookback         how far back the host should search stored events; never {@code null}
 *                         (defaults to {@link EventLookback#RUN_START})
 * @param subscriptionKey  the evaluated correlation subscription key, or {@code null} when the node has no
 *                         correlation key configured (or it evaluated to null)
 * @param timeout          the configured timeout the host should schedule, or {@code null} when the node
 *                         waits indefinitely (or the configured value is invalid)
 */
public record ReceiveEventInfo(
    String nodeId,
    String nodeName,
    String eventType,
    List<String> matchExpressions,
    List<EventOutputMapping> outputMappings,
    EventLookback lookback,
    String subscriptionKey,
    Duration timeout
) {
    /**
     * Canonical constructor; a {@code null} lookback defaults to {@link EventLookback#RUN_START}.
     *
     * @param nodeId           the receive-event node's id
     * @param nodeName         the receive-event node's name
     * @param eventType        the event type the node waits for
     * @param matchExpressions the node's match expressions
     * @param outputMappings   the node's event output mappings
     * @param lookback         the parsed look-back, or {@code null} for the default
     * @param subscriptionKey  the evaluated correlation subscription key, or {@code null}
     * @param timeout          the configured timeout, or {@code null}
     */
    public ReceiveEventInfo {
        if (lookback == null) {
            lookback = EventLookback.RUN_START;
        }
    }

    /**
     * Backward-compatible constructor for callers built before {@code timeout} was added; defaults it to
     * {@code null}.
     *
     * @param nodeId           the receive-event node's id
     * @param nodeName         the receive-event node's name
     * @param eventType        the event type the node waits for
     * @param matchExpressions the node's match expressions
     * @param outputMappings   the node's event output mappings
     * @param lookback         the parsed look-back, or {@code null} for the default
     * @param subscriptionKey  the evaluated correlation subscription key, or {@code null}
     */
    public ReceiveEventInfo(String nodeId, String nodeName, String eventType, List<String> matchExpressions,
                            List<EventOutputMapping> outputMappings, EventLookback lookback,
                            String subscriptionKey) {
        this(nodeId, nodeName, eventType, matchExpressions, outputMappings, lookback, subscriptionKey, null);
    }

    /**
     * Backward-compatible constructor for callers built before {@code subscriptionKey} was added;
     * defaults it and the timeout to {@code null}.
     *
     * @param nodeId           the receive-event node's id
     * @param nodeName         the receive-event node's name
     * @param eventType        the event type the node waits for
     * @param matchExpressions the node's match expressions
     * @param outputMappings   the node's event output mappings
     * @param lookback         the parsed look-back, or {@code null} for the default
     */
    public ReceiveEventInfo(String nodeId, String nodeName, String eventType, List<String> matchExpressions,
                            List<EventOutputMapping> outputMappings, EventLookback lookback) {
        this(nodeId, nodeName, eventType, matchExpressions, outputMappings, lookback, null, null);
    }

    /**
     * Backward-compatible constructor for callers built before {@code lookback} was added; defaults it to
     * {@link EventLookback#RUN_START} and the subscription key and timeout to {@code null}.
     *
     * @param nodeId           the receive-event node's id
     * @param nodeName         the receive-event node's name
     * @param eventType        the event type the node waits for
     * @param matchExpressions the node's match expressions
     * @param outputMappings   the node's event output mappings
     */
    public ReceiveEventInfo(String nodeId, String nodeName, String eventType, List<String> matchExpressions,
                            List<EventOutputMapping> outputMappings) {
        this(nodeId, nodeName, eventType, matchExpressions, outputMappings, EventLookback.RUN_START, null, null);
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
        this(nodeId, nodeName, eventType, matchExpressions, List.of(), EventLookback.RUN_START, null, null);
    }
}
