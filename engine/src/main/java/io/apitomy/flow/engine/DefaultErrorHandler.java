package io.apitomy.flow.engine;

import io.apitomy.flow.model.WorkflowInstance;
import io.apitomy.flow.model.WorkflowNode;
import io.apitomy.flow.spi.*;

public class DefaultErrorHandler implements WorkflowErrorHandler {
    /** Fails node errors without discarding the engine's diagnostic. */
    @Override
    public ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node,
                                           NodeResult result, Exception error) {
        return ErrorResolution.fail();
    }

    /** Fails when routing has no matching edge. */
    @Override
    public ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node) {
        return ErrorResolution.fail();
    }
}
