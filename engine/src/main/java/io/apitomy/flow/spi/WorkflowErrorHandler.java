package io.apitomy.flow.spi;

import io.apitomy.flow.model.WorkflowInstance;
import io.apitomy.flow.model.WorkflowNode;

public interface WorkflowErrorHandler {
    ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node, NodeResult result, Exception error);
    ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node);
}
