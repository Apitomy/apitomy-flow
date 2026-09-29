package io.apitomy.flow.spi;

import io.apitomy.flow.model.WorkflowEdge;
import io.apitomy.flow.model.WorkflowInstance;
import io.apitomy.flow.model.WorkflowNode;

/**
 * Observational callbacks, synchronous in registration order on the calling thread. Exceptions are logged and
 * swallowed per listener so later listeners and execution continue; JVM Errors propagate. Arguments are
 * non-null except the documented failure exception and nullable fields inside result/state. Do not mutate
 * supplied data or drive reentrant execution from a callback. Different host calls may run concurrently.
 *
 * <p>Callbacks observe intermediate state before the host has persisted the returned instance. They provide
 * no transaction, veto, acknowledgement, durable ordering, exactly-once delivery or replay guarantee. Hosts
 * must persist returned state and arrange transactional outbox/work scheduling and deduplication themselves;
 * throwing from a listener cannot roll back executor side effects or make persistence reliable.</p>
 */
public interface WorkflowEventListener {
    /** Observes instance creation before start-node entry and advancement. */
    default void onWorkflowStarted(WorkflowInstance instance) {}
    /** Observes entry before execution/parking; start entry precedes its history record, other entries follow it. */
    default void onNodeEntered(WorkflowInstance instance, WorkflowNode node) {}
    /** Observes successful action/external completion after history/context update, before outgoing routing. */
    default void onNodeCompleted(WorkflowInstance instance, WorkflowNode node, NodeResult result) {}
    /** Observes a selected edge before target entry or join-arrival accounting. */
    default void onEdgeFollowed(WorkflowInstance instance, WorkflowEdge edge) {}
    /** Observes terminal completion, including direct recovery entry to END. */
    default void onWorkflowCompleted(WorkflowInstance instance) {}
    /**
     * Observes FAILED state. Error is normally a structured WorkflowError for recoverable failures; it may
     * be null for engine invariants/limits without a triggering error. failureReason is always the diagnostic.
     */
    default void onWorkflowFailed(WorkflowInstance instance, Exception error) {}
    /** Observes a newly cancelled instance; cancelling an already terminal instance emits nothing. */
    default void onWorkflowCancelled(WorkflowInstance instance) {}
}
