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
     * Handles a structured failure with retry bookkeeping. The engine always calls this overload; the default
     * delegates to {@link #handleError(WorkflowInstance, WorkflowNode, NodeResult, WorkflowError)} so existing
     * handlers are unaffected. RETRY is shaped by the declared policy: it decides delay and ceiling, the
     * handler decides whether to retry at all.
     *
     * <p>Non-action failures receive {@link RetryContext#NONE}. Without a policy, the inline retry loop
     * reports a call-local attempt count, while a failed external completion ({@code completeNode}) always
     * reports attempt 1.
     *
     * @param retry the failed attempt number and effective policy; {@link RetryContext#NONE} outside actions
     * @return a non-null recovery decision
     */
    default ErrorResolution handleError(WorkflowInstance instance, WorkflowNode node, NodeResult result,
                                        WorkflowError error, RetryContext retry) {
        return handleError(instance, node, result, error);
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
