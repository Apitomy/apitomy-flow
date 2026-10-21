package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonValue;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * Immutable view of a declarative retry policy ({@code config.retry} on an action node or
 * {@code defaults.retry} on a workflow). Accessors apply defaults without rewriting {@link #wire()}.
 * Validation should run first; malformed fields throw {@link IllegalArgumentException}.
 */
public record RetryPolicy(@JsonValue Map<String, Object> wire) {
    /** Constant delay between attempts. */
    public static final String FIXED = "fixed";
    /** Delay multiplied by {@link #multiplier()} after each attempt. */
    public static final String EXPONENTIAL = "exponential";
    /** Upper bound applied when exponential growth has no {@code maxDelay}. */
    public static final Duration MAX_UNCAPPED_DELAY = Duration.ofDays(365);

    /** Snapshots caller-owned policy data. */
    public RetryPolicy {
        wire = JsonSnapshots.map(wire == null ? Map.of() : wire);
    }

    /**
     * Resolves the policy governing an action node: its own {@code config.retry}, else the workflow default.
     *
     * @param workflow the workflow definition
     * @param node     the node
     * @return the effective declared policy, or empty for legacy behavior or non-action nodes
     */
    public static Optional<RetryPolicy> effective(Workflow workflow, WorkflowNode node) {
        if (node.type() != NodeType.ACTION) return Optional.empty();
        Optional<RetryPolicy> own = ((NodeConfig.Action) node.typedConfig()).retry();
        return own.isPresent() ? own : workflow.defaultRetryPolicy();
    }

    /** Returns the total attempt ceiling, including the first attempt. */
    public int maxAttempts() {
        Object value = wire.get("maxAttempts");
        if (value instanceof Number number && number.doubleValue() == Math.rint(number.doubleValue())) {
            return number.intValue();
        }
        throw new IllegalArgumentException("retry.maxAttempts must be an integer");
    }

    /** Returns the base delay, defaulting to zero. */
    public Duration delay() {
        Duration value = duration("delay");
        return value == null ? Duration.ZERO : value;
    }

    /** Returns {@link #FIXED} or {@link #EXPONENTIAL}, defaulting to fixed. */
    public String backoff() {
        Object value = wire.get("backoff");
        if (value == null) return FIXED;
        if (value instanceof String text) return text;
        throw new IllegalArgumentException("retry.backoff must be a string");
    }

    /** Returns the exponential multiplier, defaulting to 2. */
    public double multiplier() {
        Object value = wire.get("multiplier");
        if (value == null) return 2.0;
        if (value instanceof Number number) return number.doubleValue();
        throw new IllegalArgumentException("retry.multiplier must be a number");
    }

    /** Returns the delay cap, or {@code null} when uncapped. */
    public Duration maxDelay() {
        return duration("maxDelay");
    }

    /** Returns whether full jitter applies, defaulting to false. */
    public boolean jitter() {
        Object value = wire.get("jitter");
        if (value == null) return false;
        if (value instanceof Boolean flag) return flag;
        throw new IllegalArgumentException("retry.jitter must be a boolean");
    }

    /**
     * Computes the delay to wait after failed attempt {@code attempt} (1-based) before the next attempt.
     * Millisecond precision; overflow saturates at the cap.
     *
     * @param attempt the attempt that just failed
     * @param random  randomness source for jitter
     * @return a non-negative delay; zero means retry inline
     */
    public Duration delayFor(int attempt, RandomGenerator random) {
        long baseMillis = delay().toMillis();
        if (baseMillis <= 0) return Duration.ZERO;
        double factor = EXPONENTIAL.equals(backoff()) ? Math.pow(multiplier(), Math.max(0, attempt - 1)) : 1.0;
        Duration cap = maxDelay() != null ? maxDelay() : MAX_UNCAPPED_DELAY;
        double millis = Math.min(baseMillis * factor, (double) cap.toMillis());
        long computed = (long) millis;
        if (jitter()) computed = random.nextLong(computed + 1);
        return Duration.ofMillis(computed);
    }

    private Duration duration(String key) {
        Object value = wire.get(key);
        if (value == null) return null;
        if (value instanceof String text) return Duration.parse(text);
        throw new IllegalArgumentException("retry." + key + " must be an ISO-8601 duration string");
    }
}
