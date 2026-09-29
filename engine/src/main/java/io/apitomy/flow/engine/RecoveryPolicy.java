package io.apitomy.flow.engine;

import io.apitomy.flow.model.NodeType;
import io.apitomy.flow.model.Workflow;
import io.apitomy.flow.model.WorkflowInstance;
import io.apitomy.flow.model.WorkflowNode;
import io.apitomy.flow.spi.*;

/**
 * Shared recovery decision and diagnostic policy for execution and external completion.
 * Invokes the host once and validates its response before the driver applies any state changes.
 * Never schedules work, changes history, publishes events or recursively invokes recovery.
 */
final class RecoveryPolicy {
    private final WorkflowErrorHandler handler;

    RecoveryPolicy(WorkflowErrorHandler handler) {
        this.handler = handler != null ? handler : new DefaultErrorHandler();
    }

    /** A validated host decision paired with the diagnostic that must survive retries and failure. */
    record Recovery(ErrorResolution resolution, WorkflowError error) {
        ErrorAction action() { return resolution.action(); }

        /** External mapping retries and non-action retries await another delivery, not executor dispatch. */
        boolean awaitsExternalDelivery(WorkflowNode node) {
            return action() == ErrorAction.RETRY
                && (node.type() != NodeType.ACTION || error.phase() == WorkflowError.Phase.OUTPUT_MAPPING);
        }
    }

    /** Preserves engine diagnostics, but wraps host failures with the actual execution boundary. */
    static WorkflowError contextualError(WorkflowError.Phase phase, WorkflowNode node, Exception error) {
        return phase != WorkflowError.Phase.EXECUTION && phase != WorkflowError.Phase.EXECUTOR_LOOKUP
            && error instanceof WorkflowError diagnostic ? diagnostic : new WorkflowError(
            phase, node.id(), null, null, null,
            error.getMessage() == null ? error.getClass().getName() : error.getMessage(), error);
    }

    /** Resolves once; malformed decisions and handler Exceptions become failures retaining both causes. */
    Recovery resolve(Workflow workflow, WorkflowInstance instance, WorkflowNode node,
                     NodeResult result, WorkflowError error) {
        try {
            ErrorResolution resolution = handler.handleError(instance, node, result, error);
            if (resolution == null || resolution.action() == null) {
                throw new IllegalArgumentException("Error resolution and action must not be null");
            }
            String targetId = resolution.targetNodeId();
            if (resolution.action() == ErrorAction.TRANSITION) {
                if (targetId == null || targetId.isBlank()) {
                    throw new IllegalArgumentException("Error handler TRANSITION target must not be null or blank");
                }
                WorkflowNode target = workflow.findNodeById(targetId).orElseThrow(() ->
                    new IllegalArgumentException("Error handler TRANSITION target not found: " + targetId));
                if (target.type() == NodeType.START) {
                    throw new IllegalArgumentException("Cannot transition to node type: START");
                }
            } else if (targetId != null) {
                throw new IllegalArgumentException("Only TRANSITION accepts targetNodeId");
            }
            return new Recovery(resolution, error);
        } catch (Exception handlerError) {
            WorkflowError failure = new WorkflowError(WorkflowError.Phase.ERROR_HANDLER, node.id(),
                error.edgeId(), error.expression(), error.field(),
                "Error handler threw or returned an invalid resolution: " + handlerError
                    + "; original: " + error.diagnostic(), handlerError);
            failure.addSuppressed(error);
            return new Recovery(ErrorResolution.fail(), failure);
        }
    }
}
