package io.apitomy.flow.spi;

import io.apitomy.flow.model.RetryPolicy;

import java.util.Objects;
import java.util.Optional;

/**
 * Retry bookkeeping passed to {@link WorkflowErrorHandler} for action-node failures.
 *
 * @param attempt the 1-based attempt that just failed
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
