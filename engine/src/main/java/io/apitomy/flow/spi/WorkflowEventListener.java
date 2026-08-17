package io.apitomy.flow.spi;

import io.apitomy.flow.model.WorkflowEdge;
import io.apitomy.flow.model.WorkflowInstance;
import io.apitomy.flow.model.WorkflowNode;

public interface WorkflowEventListener {
    default void onWorkflowStarted(WorkflowInstance instance) {}
    default void onNodeEntered(WorkflowInstance instance, WorkflowNode node) {}
    default void onNodeCompleted(WorkflowInstance instance, WorkflowNode node, NodeResult result) {}
    default void onEdgeFollowed(WorkflowInstance instance, WorkflowEdge edge) {}
    default void onWorkflowCompleted(WorkflowInstance instance) {}
    default void onWorkflowFailed(WorkflowInstance instance, Exception error) {}
    default void onWorkflowCancelled(WorkflowInstance instance) {}
}
