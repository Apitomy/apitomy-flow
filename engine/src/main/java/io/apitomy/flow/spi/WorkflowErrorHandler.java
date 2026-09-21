package io.apitomy.flow.spi;

import io.apitomy.flow.model.WorkflowInstance;
import io.apitomy.flow.model.WorkflowNode;

/**
 * Synchronous recovery policy, invoked before recovery side effects. Responses must have a non-null action;
 * only TRANSITION accepts a target (a nonblank id of an existing non-START node). Null/malformed responses or
 * thrown Exceptions fail the workflow once, retaining the triggering diagnostic; the handler is not called
 * recursively. Retries can repeat executor side effects: hosts must arrange idempotency and durable scheduling.
 */
public interface WorkflowErrorHandler {
    /**
     * Handles a structured failure. Override to inspect phase and identity without replacing this SPI.
     * The default adapter preserves legacy exception identity for executor/edge/mapping exceptions and the
     * null exception on FAILED results. Newly diagnosed validation/input failures supply the diagnostic itself.
     * All arguments except result are non-null; result is absent before an executor returns.
     *
     * @return a non-null recovery decision
     */
    default ErrorResolution handleError(WorkflowInstance instance, WorkflowNode node, NodeResult result,
                                       WorkflowError error) {
        if (error.phase() == WorkflowError.Phase.EDGE_SELECTION) {
            return handleNoMatchingEdge(instance, node);
        }
        Exception legacyError = switch (error.phase()) {
            case EXECUTION -> (Exception) error.getCause();
            case EDGE_CONDITION, OUTPUT_MAPPING -> error.getCause() instanceof Exception cause ? cause : error;
            default -> error;
        };
        return handleNodeError(instance, node, result, legacyError);
    }

    /**
     * Legacy node callback. Instance/node are non-null; result is null before a result exists, and error is
     * null for an explicit FAILED result. A non-null result may accompany an output-validation/mapping error.
     * Return a valid resolution; throwing an Exception fails the workflow.
     */
    ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node, NodeResult result, Exception error);
    /** Handles no matching outgoing edge with non-null instance/node; returns a valid recovery decision. */
    ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node);
}
