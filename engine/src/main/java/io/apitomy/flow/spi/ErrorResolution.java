package io.apitomy.flow.spi;

import java.util.Objects;

/**
 * Recovery decision, validated by the engine. Action must be non-null. Only TRANSITION permits a target,
 * which must name an existing non-START node. Other actions require a null target. Invalid decisions fail once.
 */
public record ErrorResolution(
    ErrorAction action,
    String targetNodeId
) {
    /** Fails with the original diagnostic retained in failureReason. */
    public static ErrorResolution fail() {
        return new ErrorResolution(ErrorAction.FAIL, null);
    }

    /**
     * Retries under engine per-call limits. Action errors re-execute; edge errors reselect; human input errors
     * re-enter; external non-action completion and output-mapping errors stay parked for another delivery.
     */
    public static ErrorResolution retry() {
        return new ErrorResolution(ErrorAction.RETRY, null);
    }

    /** Selects recovery entry at nodeId; rejects null immediately, with remaining validation in the engine. */
    public static ErrorResolution transitionTo(String nodeId) {
        Objects.requireNonNull(nodeId, "targetNodeId must not be null");
        return new ErrorResolution(ErrorAction.TRANSITION, nodeId);
    }
}
