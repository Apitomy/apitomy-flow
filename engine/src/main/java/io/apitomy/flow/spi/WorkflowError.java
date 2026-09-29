package io.apitomy.flow.spi;

import java.util.Objects;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;

/**
 * Call-local diagnostic delivered to error handlers and failure listeners. This is not persisted as a new
 * workflow field: {@code failureReason} retains its string wire format. Identity fields are null when inapplicable.
 */
public final class WorkflowError extends RuntimeException {
    /** The engine operation that failed. */
    public enum Phase {
        INPUT_RESOLUTION, EXECUTOR_LOOKUP, EXECUTION, RESULT_VALIDATION, OUTPUT_VALIDATION,
        OUTPUT_MAPPING, EDGE_CONDITION, EDGE_SELECTION, ERROR_HANDLER
    }

    private final Phase phase;
    private final String nodeId;
    private final String edgeId;
    private final String expression;
    private final String field;

    /** Creates a diagnostic with a non-null phase/message and optional identity and original cause. */
    public WorkflowError(Phase phase, String nodeId, String edgeId, String expression, String field,
                         String message, Exception cause) {
        super(Objects.requireNonNull(message), cause);
        this.phase = Objects.requireNonNull(phase);
        this.nodeId = nodeId;
        this.edgeId = edgeId;
        this.expression = expression;
        this.field = field;
    }

    /** Returns the failing operation. */
    public Phase phase() { return phase; }
    /** Returns the failing node id, or null when unavailable. */
    public String nodeId() { return nodeId; }
    /** Returns the failing edge id, or null for non-edge failures. */
    public String edgeId() { return edgeId; }
    /** Returns the failing expression, or null for non-expression failures. */
    public String expression() { return expression; }
    /** Returns the input/output field identity, or null when inapplicable. */
    public String field() { return field; }

    /** Formats actionable context for the existing string failureReason field; not a machine-readable format. */
    public String diagnostic() {
        String identity = phase + (nodeId == null ? "" : " node=" + nodeId)
            + (edgeId == null ? "" : " edge=" + edgeId)
            + (field == null ? "" : " field=" + field)
            + (expression == null ? "" : " expression=" + expression)
            + ": " + getMessage();
        StringBuilder diagnostic = new StringBuilder(identity);
        Set<Throwable> visited = Collections.newSetFromMap(new IdentityHashMap<>());
        visited.add(this);
        for (Throwable cause = getCause(); cause != null && visited.add(cause); cause = cause.getCause()) {
            diagnostic.append("; cause: ").append(cause);
        }
        return diagnostic.toString();
    }
}
