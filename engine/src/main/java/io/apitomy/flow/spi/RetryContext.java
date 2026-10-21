package io.apitomy.flow.spi;

import io.apitomy.flow.model.RetryPolicy;

import java.util.Objects;
import java.util.Optional;

/**
 * Retry bookkeeping passed to {@link WorkflowErrorHandler} for action-node failures. Non-action failures
 * receive {@link #NONE}.
 *
 * <p>With a declared policy, {@link #attempt()} is durable across async resumes. Without a policy, the
 * inline retry loop reports a count local to one synchronous execution, and a failed external completion
 * ({@code completeNode}) always reports attempt 1.
 *
 * @param attempt the 1-based attempt that just failed; durable across async resumes when a policy is
 *                declared, otherwise counted only within one synchronous execution (not durable)
 * @param policy  the node's effective declared retry policy, or empty for the legacy policy
 */
public record RetryContext(int attempt, Optional<RetryPolicy> policy) {
    /** Context for failures outside action execution (attempt 1, no policy). */
    public static final RetryContext NONE = new RetryContext(1, Optional.empty());

    /** Rejects a null policy holder. */
    public RetryContext {
        Objects.requireNonNull(policy, "policy");
    }
}
