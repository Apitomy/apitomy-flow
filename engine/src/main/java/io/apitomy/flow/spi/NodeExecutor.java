package io.apitomy.flow.spi;

/** Host action implementation. Calls and bounded retries are synchronous; side effects must be idempotent. */
public interface NodeExecutor {
    /** Returns a stable, non-null, nonblank registry key; duplicate keys are rejected by fromList. */
    String actionType();
    /**
     * Executes with non-null context, node, inputs and config. Inputs may contain legitimate null values.
     * Return a non-null result/status; null output means empty output. Exceptions and malformed results enter
     * error recovery; Errors propagate. Do not mutate supplied data. PENDING parks the node for host completion;
     * the host owns durable work scheduling, correlation, deduplication and persistence of the returned instance.
     */
    NodeResult execute(NodeExecutionContext context);
}
