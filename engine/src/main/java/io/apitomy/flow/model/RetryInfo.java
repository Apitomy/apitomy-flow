package io.apitomy.flow.model;

import java.time.Instant;

/**
 * An action node parked for a delayed retry. Hosts schedule a timer for {@code retryAt} and then call
 * {@code WorkflowEngine.retryNode}.
 *
 * @param nodeId   the parked action node
 * @param branchId the branch it belongs to
 * @param attempt  the 1-based attempt that will run next
 * @param retryAt  when the retry is due
 */
public record RetryInfo(String nodeId, String branchId, int attempt, Instant retryAt) {}
