package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A directed edge between two workflow nodes.
 *
 * <p>An edge with {@code isTimeout == true} is a receive-event timeout edge (similar to a BPMN boundary
 * timer). It may only leave a RECEIVE_EVENT node that configures {@code timeout}, is never chosen by normal
 * edge selection, and is followed only when the host calls
 * {@link io.apitomy.flow.engine.WorkflowEngine#onReceiveEventTimeout}.
 *
 * @param id        the edge id
 * @param source    the source node id
 * @param target    the target node id
 * @param condition optional EL condition
 * @param priority  evaluation priority (lower first)
 * @param isDefault whether this edge is the default fallback
 * @param label     optional display label
 * @param isTimeout whether this edge is a receive-event timeout edge
 */
public record WorkflowEdge(
    String id,
    String source,
    String target,
    String condition,
    int priority,
    boolean isDefault,
    String label,
    @JsonInclude(JsonInclude.Include.NON_DEFAULT) boolean isTimeout
) {
    /**
     * Backward-compatible constructor for non-timeout edges.
     *
     * @param id        the edge id
     * @param source    the source node id
     * @param target    the target node id
     * @param condition optional EL condition
     * @param priority  evaluation priority (lower first)
     * @param isDefault whether this edge is the default fallback
     * @param label     optional display label
     */
    public WorkflowEdge(String id, String source, String target, String condition, int priority,
                        boolean isDefault, String label) {
        this(id, source, target, condition, priority, isDefault, label, false);
    }
}
