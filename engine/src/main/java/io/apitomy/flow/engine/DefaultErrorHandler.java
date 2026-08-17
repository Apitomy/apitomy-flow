package io.apitomy.flow.engine;

import io.apitomy.flow.model.WorkflowInstance;
import io.apitomy.flow.model.WorkflowNode;
import io.apitomy.flow.spi.*;

public class DefaultErrorHandler implements WorkflowErrorHandler {
    @Override
    public ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node,
                                           NodeResult result, Exception error) {
        return ErrorResolution.fail();
    }

    @Override
    public ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node) {
        return ErrorResolution.fail();
    }
}
