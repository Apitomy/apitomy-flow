# Declarative Retry Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Per-node and per-workflow-default declarative retry/backoff policies for action nodes, with attempt
state that survives async resumes, host-scheduled delayed retries, validation parity, and UI support.

**Architecture:** A `RetryPolicy` view record over the wire map is read from `config.retry` or
`workflow.defaults.retry`. The engine keeps `attempt` and `retryAt` on the open `HistoryEntry`. Zero-delay
retries run inline; delayed retries park the node and the host calls `retryNode` when its timer fires. The
host `WorkflowErrorHandler` still decides RETRY/FAIL/TRANSITION; the policy shapes RETRY.

**Tech Stack:** Java 21, Jackson 2.22, JUnit 5 (`engine/`); TypeScript, React 19, vitest (`ui/`).

**Spec:** `docs/superpowers/specs/2026-10-21-declarative-retry-policy-design.md`

## Global Constraints

- No behavior change for definitions without a policy: inline retries, ceiling `MAX_RETRIES = 10`, message
  `Exceeded retry limit (10): <diagnostic>`, counter local to one synchronous execution (not carried across
  async resumes).
- Declared policy exhaustion message: `Exceeded retry limit (<maxAttempts - 1>): <diagnostic>`.
- A node `retry` replaces `defaults.retry` wholesale; no field merging.
- Wire field names are exactly: `maxAttempts`, `delay`, `backoff` (`fixed`|`exponential`), `multiplier`,
  `maxDelay`, `jitter`; workflow top-level `defaults.retry`; history `attempt`, `retryAt`.
- Validation codes (identical in Java and TS): `INVALID_RETRY_POLICY`, `INVALID_RETRY_MAX_ATTEMPTS`,
  `INVALID_RETRY_DELAY`, `INVALID_RETRY_BACKOFF`, `INVALID_RETRY_MULTIPLIER`, `INVALID_RETRY_MAX_DELAY`,
  `INVALID_RETRY_JITTER` (errors), `RETRY_ON_NON_ACTION_NODE` (warning).
- Java: 4-space indent, Javadoc on public members, explicit types (no `var`). Back-compat constructors for
  every record that gains a component.
- Verify: Java `mvn -q test` in `engine/`; UI `npx vitest run` and `npx tsc --noEmit` and `npm run lint` in
  `ui/`.
- Commit messages: imperative sentence, no AI attribution.

---

### Task 1: `RetryPolicy` model, `Workflow.defaults`, `NodeConfig.Action.retry()`

**Files:**
- Create: `engine/src/main/java/io/apitomy/flow/model/RetryPolicy.java`
- Modify: `engine/src/main/java/io/apitomy/flow/model/Workflow.java`
- Modify: `engine/src/main/java/io/apitomy/flow/model/NodeConfig.java` (record `Action`)
- Test: `engine/src/test/java/io/apitomy/flow/model/RetryPolicyTest.java`

**Interfaces:**
- Produces: `RetryPolicy(Map<String,Object> wire)` with `int maxAttempts()`, `Duration delay()`,
  `String backoff()`, `double multiplier()`, `Duration maxDelay()` (nullable), `boolean jitter()`,
  `Duration delayFor(int attempt, RandomGenerator random)`,
  `static Optional<RetryPolicy> effective(Workflow, WorkflowNode)`; constants `FIXED`, `EXPONENTIAL`.
- Produces: `Workflow.defaults()` (`Map<String,Object>`, nullable), `Optional<RetryPolicy>
  Workflow.defaultRetryPolicy()`, 7-arg canonical constructor plus 6-arg back-compat constructor.
- Produces: `Optional<RetryPolicy> NodeConfig.Action.retry()`.

- [ ] **Step 1: Write the failing test**

```java
package io.apitomy.flow.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/** Tests the declarative retry policy view, delay math, and effective-policy resolution. */
class RetryPolicyTest {

    private static RetryPolicy policy(Map<String, Object> wire) {
        return new RetryPolicy(wire);
    }

    @Test
    void appliesDefaults() {
        RetryPolicy p = policy(Map.of("maxAttempts", 3));
        assertEquals(3, p.maxAttempts());
        assertEquals(Duration.ZERO, p.delay());
        assertEquals(RetryPolicy.FIXED, p.backoff());
        assertEquals(2.0, p.multiplier());
        assertNull(p.maxDelay());
        assertFalse(p.jitter());
    }

    @Test
    void fixedDelayIsConstant() {
        RetryPolicy p = policy(Map.of("maxAttempts", 5, "delay", "PT2S"));
        assertEquals(Duration.ofSeconds(2), p.delayFor(1, new SplittableRandom(1)));
        assertEquals(Duration.ofSeconds(2), p.delayFor(4, new SplittableRandom(1)));
    }

    @Test
    void exponentialDelayGrowsAndIsCapped() {
        RetryPolicy p = policy(Map.of("maxAttempts", 10, "delay", "PT1S", "backoff", "exponential",
            "multiplier", 3, "maxDelay", "PT20S"));
        assertEquals(Duration.ofSeconds(1), p.delayFor(1, new SplittableRandom(1)));
        assertEquals(Duration.ofSeconds(3), p.delayFor(2, new SplittableRandom(1)));
        assertEquals(Duration.ofSeconds(9), p.delayFor(3, new SplittableRandom(1)));
        assertEquals(Duration.ofSeconds(20), p.delayFor(4, new SplittableRandom(1)));
        assertEquals(Duration.ofSeconds(20), p.delayFor(5000, new SplittableRandom(1)), "overflow saturates");
    }

    @Test
    void uncappedExponentialSaturatesAtOneYear() {
        RetryPolicy p = policy(Map.of("maxAttempts", 10, "delay", "PT1S", "backoff", "exponential"));
        assertEquals(RetryPolicy.MAX_UNCAPPED_DELAY, p.delayFor(5000, new SplittableRandom(1)));
    }

    @Test
    void jitterStaysWithinBounds() {
        RetryPolicy p = policy(Map.of("maxAttempts", 5, "delay", "PT10S", "jitter", true));
        SplittableRandom random = new SplittableRandom(42);
        for (int i = 0; i < 200; i++) {
            Duration d = p.delayFor(1, random);
            assertFalse(d.isNegative());
            assertTrue(d.compareTo(Duration.ofSeconds(10)) <= 0);
        }
    }

    @Test
    void nodePolicyOverridesWorkflowDefaultWholesale() {
        WorkflowNode own = new WorkflowNode("a", NodeType.ACTION, "a",
            Map.of("actionType", "t", "retry", Map.of("maxAttempts", 2)), new Position(0, 0));
        WorkflowNode inherits = actionNode("b", "t");
        Workflow workflow = new Workflow("w", "W", null, null, List.of(own, inherits), List.of(),
            Map.of("retry", Map.of("maxAttempts", 7, "delay", "PT1S")));
        RetryPolicy ownPolicy = RetryPolicy.effective(workflow, own).orElseThrow();
        assertEquals(2, ownPolicy.maxAttempts());
        assertEquals(Duration.ZERO, ownPolicy.delay());
        assertEquals(7, RetryPolicy.effective(workflow, inherits).orElseThrow().maxAttempts());
    }

    @Test
    void noPolicyAndNonActionNodesAreEmpty() {
        Workflow workflow = new Workflow("w", "W", null, null, List.of(actionNode("a", "t")), List.of());
        assertEquals(Optional.empty(), RetryPolicy.effective(workflow, actionNode("a", "t")));
        Workflow withDefault = new Workflow("w", "W", null, null, List.of(), List.of(),
            Map.of("retry", Map.of("maxAttempts", 3)));
        assertEquals(Optional.empty(), RetryPolicy.effective(withDefault, endNode("end")));
    }

    @Test
    void workflowDefaultsRoundTripAndAreOmittedWhenAbsent() throws Exception {
        ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());
        Workflow without = new Workflow("w", "W", null, null, List.of(), List.of());
        assertFalse(mapper.writeValueAsString(without).contains("defaults"));
        Workflow with = new Workflow("w", "W", null, null, List.of(), List.of(),
            Map.of("retry", Map.of("maxAttempts", 3)));
        Workflow read = mapper.readValue(mapper.writeValueAsString(with), Workflow.class);
        assertEquals(3, read.defaultRetryPolicy().orElseThrow().maxAttempts());
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run (in `engine/`): `mvn -q test -Dtest=RetryPolicyTest`
Expected: compilation failure (`RetryPolicy` not found).

- [ ] **Step 3: Implement `RetryPolicy`**

```java
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
```

- [ ] **Step 4: Add `defaults` to `Workflow`**

Replace the record header and compact constructor in `Workflow.java` (keep all existing methods):

```java
public record Workflow(
    String id,
    String name,
    String description,
    Integer version,
    List<WorkflowNode> nodes,
    List<WorkflowEdge> edges,
    @JsonInclude(JsonInclude.Include.NON_NULL) Map<String, Object> defaults
) {
    /** Owns definition collections, including when constructed directly or deserialized. */
    public Workflow {
        nodes = JsonSnapshots.list(nodes == null ? List.of() : nodes);
        edges = JsonSnapshots.list(edges == null ? List.of() : edges);
        defaults = defaults == null ? null : JsonSnapshots.map(defaults);
    }

    /** Back-compat constructor for definitions without workflow-level defaults. */
    public Workflow(String id, String name, String description, Integer version,
                    List<WorkflowNode> nodes, List<WorkflowEdge> edges) {
        this(id, name, description, version, nodes, edges, null);
    }

    /**
     * Returns the workflow-level default retry policy ({@code defaults.retry}), if declared.
     *
     * @return the default policy, or empty
     * @throws IllegalArgumentException if {@code defaults.retry} is present but not an object
     */
    @SuppressWarnings("unchecked")
    public Optional<RetryPolicy> defaultRetryPolicy() {
        Object retry = defaults == null ? null : defaults.get("retry");
        if (retry == null) return Optional.empty();
        if (retry instanceof Map<?, ?> map) return Optional.of(new RetryPolicy((Map<String, Object>) map));
        throw new IllegalArgumentException("defaults.retry must be an object");
    }
```

Add imports `com.fasterxml.jackson.annotation.JsonInclude` and `java.util.Map`.

- [ ] **Step 5: Add `retry()` to `NodeConfig.Action`**

Inside `record Action`, after `outputs()`:

```java
        /** Returns the node's own declared retry policy, or empty to inherit the workflow default. */
        public java.util.Optional<RetryPolicy> retry() {
            Object value = wire.get("retry");
            return value == null ? java.util.Optional.empty() : java.util.Optional.of(new RetryPolicy(object(value)));
        }
```

- [ ] **Step 6: Run tests**

Run: `mvn -q test -Dtest=RetryPolicyTest,WorkflowSerializationTest,NodeConfigTest`
Expected: PASS. Then run the full suite `mvn -q test` — the 6-arg constructor keeps all ~200 call sites
compiling. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/model engine/src/test/java/io/apitomy/flow/model/RetryPolicyTest.java
git commit -m "Add declarative RetryPolicy model and workflow defaults (#86)"
```

---

### Task 2: Durable attempt state on `HistoryEntry`

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/model/HistoryEntry.java`
- Modify: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java` (`completeHistoryEntry`)
- Test: `engine/src/test/java/io/apitomy/flow/model/WorkflowInstanceModelTest.java`

**Interfaces:**
- Produces: `HistoryEntry` components `Integer attempt`, `Instant retryAt` (both `NON_NULL`), 10-arg
  back-compat constructor, `int effectiveAttempt()` (null → 1), `HistoryEntry withRetry(Integer attempt,
  Instant retryAt)`.

- [ ] **Step 1: Write the failing test** (append to `WorkflowInstanceModelTest`)

```java
    @Test
    void historyEntryRetryFieldsRoundTripAndAreOmittedWhenAbsent() throws Exception {
        ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());
        Instant now = Instant.parse("2026-10-21T10:00:00Z");
        HistoryEntry plain = new HistoryEntry("a", "A", null, null, now, null, null, "root", null, null);
        String plainJson = mapper.writeValueAsString(plain);
        assertFalse(plainJson.contains("attempt"));
        assertFalse(plainJson.contains("retryAt"));
        assertEquals(1, plain.effectiveAttempt());

        HistoryEntry retrying = plain.withRetry(3, now.plusSeconds(5));
        HistoryEntry read = mapper.readValue(mapper.writeValueAsString(retrying), HistoryEntry.class);
        assertEquals(3, read.attempt());
        assertEquals(now.plusSeconds(5), read.retryAt());
        assertEquals(3, read.effectiveAttempt());
    }
```

(Add imports for `ObjectMapper`, `JavaTimeModule`, `Instant` if missing.)

- [ ] **Step 2: Run to verify it fails**

Run: `mvn -q test -Dtest=WorkflowInstanceModelTest`
Expected: compilation failure (`withRetry` not found).

- [ ] **Step 3: Implement**

In `HistoryEntry.java`, add two components after `title`, document them in the record Javadoc
(`attempt`: 1-based attempt number of the open visit, absent means 1; `retryAt`: set only while parked for a
delayed retry), and add helpers plus a back-compat constructor:

```java
    @JsonInclude(JsonInclude.Include.NON_NULL) String title,
    @JsonInclude(JsonInclude.Include.NON_NULL) Integer attempt,
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant retryAt
) {
```

```java
    /**
     * Back-compat constructor for callers that predate retry recording; sets {@code attempt} and
     * {@code retryAt} to {@code null}.
     */
    public HistoryEntry(String nodeId, String nodeName, String edgeId, String edgeCondition,
                        Instant enteredOn, Instant completedOn, Map<String, Object> output, String branchId,
                        Map<String, Object> input, String title) {
        this(nodeId, nodeName, edgeId, edgeCondition, enteredOn, completedOn, output, branchId, input, title,
            null, null);
    }

    /** Returns the 1-based attempt number, treating an absent value as the first attempt. */
    public int effectiveAttempt() {
        return attempt == null ? 1 : attempt;
    }

    /**
     * Returns a copy with the given retry bookkeeping.
     *
     * @param attempt the attempt number to record
     * @param retryAt when a parked retry is due, or {@code null} when not parked for retry
     * @return the updated entry
     */
    public HistoryEntry withRetry(Integer attempt, Instant retryAt) {
        return new HistoryEntry(nodeId, nodeName, edgeId, edgeCondition, enteredOn, completedOn, output,
            branchId, input, title, attempt, retryAt);
    }
```

Change the existing 9-arg back-compat constructor to delegate to the 10-arg one (it already does — keep it).

In `WorkflowEngine.completeHistoryEntry`, preserve `attempt` and clear `retryAt`:

```java
                history.set(i, new HistoryEntry(h.nodeId(), h.nodeName(), h.edgeId(), h.edgeCondition(),
                    h.enteredOn(), completedOn, output != null ? output : h.output(), h.branchId(), h.input(),
                    h.title(), h.attempt(), null));
```

- [ ] **Step 4: Run all tests**

Run: `mvn -q test`
Expected: PASS (existing `assertEquals` on history entries still hold: new fields are null).

- [ ] **Step 5: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/model/HistoryEntry.java engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java engine/src/test/java/io/apitomy/flow/model/WorkflowInstanceModelTest.java
git commit -m "Record retry attempt state on history entries (#86)"
```

---

### Task 3: `RetryContext` for the error handler

**Files:**
- Create: `engine/src/main/java/io/apitomy/flow/spi/RetryContext.java`
- Modify: `engine/src/main/java/io/apitomy/flow/spi/WorkflowErrorHandler.java`
- Modify: `engine/src/main/java/io/apitomy/flow/engine/RecoveryPolicy.java`
- Test: covered in Task 4 (`WorkflowEngineRetryPolicyTest.handlerReceivesAttemptAndPolicy`)

**Interfaces:**
- Produces: `record RetryContext(int attempt, Optional<RetryPolicy> policy)` with `static final RetryContext
  NONE = new RetryContext(1, Optional.empty())`.
- Produces: `default ErrorResolution WorkflowErrorHandler.handleError(WorkflowInstance, WorkflowNode,
  NodeResult, WorkflowError, RetryContext)` delegating to the 4-arg `handleError`.
- Produces: `RecoveryPolicy.resolve(Workflow, WorkflowInstance, WorkflowNode, NodeResult, WorkflowError,
  RetryContext)`; existing 5-arg `resolve` delegates with `RetryContext.NONE`.

- [ ] **Step 1: Create `RetryContext`**

```java
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
```

- [ ] **Step 2: Add the handler overload** (in `WorkflowErrorHandler`, after the 4-arg `handleError`)

```java
    /**
     * Handles a structured failure with retry bookkeeping. The engine always calls this overload; the default
     * delegates to {@link #handleError(WorkflowInstance, WorkflowNode, NodeResult, WorkflowError)} so existing
     * handlers are unaffected. RETRY is shaped by the declared policy: it decides delay and ceiling, the
     * handler decides whether to retry at all.
     *
     * @param retry the failed attempt number and effective policy; {@link RetryContext#NONE} outside actions
     * @return a non-null recovery decision
     */
    default ErrorResolution handleError(WorkflowInstance instance, WorkflowNode node, NodeResult result,
                                        WorkflowError error, RetryContext retry) {
        return handleError(instance, node, result, error);
    }
```

- [ ] **Step 3: Thread it through `RecoveryPolicy`**

Rename the existing `resolve` body into the 6-arg overload and call the new handler method:

```java
    /** Resolves a non-action (or attempt-agnostic) failure. */
    Recovery resolve(Workflow workflow, WorkflowInstance instance, WorkflowNode node,
                     NodeResult result, WorkflowError error) {
        return resolve(workflow, instance, node, result, error, RetryContext.NONE);
    }

    /** Resolves once; malformed decisions and handler Exceptions become failures retaining both causes. */
    Recovery resolve(Workflow workflow, WorkflowInstance instance, WorkflowNode node,
                     NodeResult result, WorkflowError error, RetryContext retry) {
        try {
            ErrorResolution resolution = handler.handleError(instance, node, result, error, retry);
            // ... remainder unchanged ...
```

- [ ] **Step 4: Compile and run**

Run: `mvn -q test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/spi engine/src/main/java/io/apitomy/flow/engine/RecoveryPolicy.java
git commit -m "Pass retry attempt and policy to the error handler (#86)"
```

---

### Task 4: Engine — apply the policy on synchronous execution

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java`
- Create: `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineRetryPolicyTest.java`

**Interfaces:**
- Consumes: `RetryPolicy.effective`, `RetryPolicy.delayFor`, `HistoryEntry.withRetry/effectiveAttempt`,
  `RetryContext`, `RecoveryPolicy.resolve(..., RetryContext)`.
- Produces: constructor `WorkflowEngine(NodeExecutorProvider, List<WorkflowEventListener>,
  WorkflowErrorHandler, Clock, RandomGenerator)`; private helpers `HistoryEntry openEntry(WorkflowInstance,
  String branchId, String nodeId)`, `WorkflowInstance updateOpenEntry(WorkflowInstance, String branchId,
  String nodeId, UnaryOperator<HistoryEntry>)`, `RetryStep planRetry(WorkflowInstance, String branchId,
  WorkflowNode, RetryPolicy, WorkflowError)` with `record RetryStep(WorkflowInstance instance, RetryOutcome
  outcome)` and `enum RetryOutcome { EXHAUSTED, INLINE, PARKED }` (used again by Task 5).

- [ ] **Step 1: Write the failing tests**

```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.SplittableRandom;
import java.util.concurrent.atomic.AtomicInteger;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/** Tests declarative retry policies for action nodes. */
class WorkflowEngineRetryPolicyTest {

    static final Instant NOW = Instant.parse("2026-10-21T10:00:00Z");
    static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    /** Executor that fails the first {@code failures} calls and then completes. */
    static NodeExecutor flaky(int failures, AtomicInteger calls) {
        return new NodeExecutor() {
            @Override public String actionType() { return "flaky"; }
            @Override public NodeResult execute(NodeExecutionContext context) {
                if (calls.incrementAndGet() <= failures) throw new IllegalStateException("boom " + calls.get());
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            }
        };
    }

    /** Handler that always asks to retry, recording each RetryContext it sees. */
    static WorkflowErrorHandler alwaysRetry(List<RetryContext> seen) {
        return new WorkflowErrorHandler() {
            @Override public ErrorResolution handleError(WorkflowInstance i, WorkflowNode n, NodeResult r,
                                                         WorkflowError e, RetryContext retry) {
                seen.add(retry);
                return ErrorResolution.retry();
            }
            @Override public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n, NodeResult r,
                                                             Exception e) { return ErrorResolution.retry(); }
            @Override public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };
    }

    static Workflow workflow(Map<String, Object> nodeRetry, Map<String, Object> defaultRetry) {
        Map<String, Object> config = new HashMap<>(Map.of("actionType", "flaky", "inputs", Map.of(),
            "outputs", List.of()));
        if (nodeRetry != null) config.put("retry", nodeRetry);
        return new Workflow("w", "W", null, null,
            List.of(startNode("start"), new WorkflowNode("act", NodeType.ACTION, "act", config,
                new Position(100, 0)), endNode("end")),
            List.of(edge("e1", "start", "act"), edge("e2", "act", "end")),
            defaultRetry == null ? null : Map.of("retry", defaultRetry));
    }

    static WorkflowEngine engine(NodeExecutor executor, WorkflowErrorHandler handler) {
        return new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(), handler, CLOCK,
            new SplittableRandom(7));
    }

    static HistoryEntry actEntry(WorkflowInstance instance) {
        return instance.history().stream().filter(h -> h.nodeId().equals("act")).reduce((a, b) -> b).orElseThrow();
    }

    @Test
    void zeroDelayPolicyRetriesInlineUntilSuccess() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(2, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(Map.of("maxAttempts", 3), null), Map.of());
        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(3, calls.get());
        assertEquals(3, actEntry(result).attempt());
        assertNull(actEntry(result).retryAt());
    }

    @Test
    void exhaustionFailsWithRetryCount() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(Map.of("maxAttempts", 3), null), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(3, calls.get());
        assertTrue(result.failureReason().startsWith("Exceeded retry limit (2): "), result.failureReason());
    }

    @Test
    void maxAttemptsOneNeverRetries() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(Map.of("maxAttempts", 1), null), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(1, calls.get());
    }

    @Test
    void delayedRetryParksWithRetryAt() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(Map.of("maxAttempts", 3, "delay", "PT30S"), null), Map.of());
        assertEquals(InstanceStatus.WAITING, result.status());
        assertEquals(1, calls.get());
        assertEquals(2, actEntry(result).attempt());
        assertEquals(NOW.plusSeconds(30), actEntry(result).retryAt());
        assertNull(actEntry(result).completedOn());
    }

    @Test
    void workflowDefaultAppliesWhenNodeHasNoPolicy() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(null, Map.of("maxAttempts", 2)), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(2, calls.get());
    }

    @Test
    void legacyBehaviorUnchangedWithoutPolicy() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowInstance result = engine(flaky(99, calls), alwaysRetry(new ArrayList<>()))
            .startWorkflow(workflow(null, null), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(11, calls.get());
        assertTrue(result.failureReason().startsWith("Exceeded retry limit (10): "), result.failureReason());
    }

    @Test
    void handlerReceivesAttemptAndPolicy() {
        List<RetryContext> seen = new ArrayList<>();
        engine(flaky(99, new AtomicInteger()), alwaysRetry(seen))
            .startWorkflow(workflow(Map.of("maxAttempts", 3), null), Map.of());
        assertEquals(List.of(1, 2, 3), seen.stream().map(RetryContext::attempt).toList());
        assertTrue(seen.stream().allMatch(c -> c.policy().orElseThrow().maxAttempts() == 3));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `mvn -q test -Dtest=WorkflowEngineRetryPolicyTest`
Expected: compilation failure (5-arg constructor missing).

- [ ] **Step 3: Add clock/random fields and constructor**

```java
    private final Clock clock;
    private final RandomGenerator random;

    /** Creates an engine using the system UTC clock and default randomness for retry scheduling. */
    public WorkflowEngine(NodeExecutorProvider executorProvider, List<WorkflowEventListener> listeners,
                          WorkflowErrorHandler errorHandler) {
        this(executorProvider, listeners, errorHandler, Clock.systemUTC(), RandomGenerator.getDefault());
    }

    /**
     * Creates an engine with an explicit clock (for {@code retryAt}) and randomness (for retry jitter).
     * Null provider/handler/listeners behave as in the 3-argument constructor; clock and random must be
     * non-null.
     */
    public WorkflowEngine(NodeExecutorProvider executorProvider, List<WorkflowEventListener> listeners,
                          WorkflowErrorHandler errorHandler, Clock clock, RandomGenerator random) {
        // existing body of the 3-arg constructor, then:
        this.clock = Objects.requireNonNull(clock, "clock");
        this.random = Objects.requireNonNull(random, "random");
    }
```

Move the existing 3-arg constructor body into the 5-arg constructor; the 3-arg one only delegates. Imports:
`java.time.Clock`, `java.util.Optional`, `java.util.random.RandomGenerator`,
`java.util.function.UnaryOperator` (`model.*` and `spi.*` already cover `RetryPolicy` and `RetryContext`;
add explicit imports if they are not wildcard-imported).

- [ ] **Step 4: Add history helpers and `planRetry`**

```java
    private enum RetryOutcome { EXHAUSTED, INLINE, PARKED }

    /** Result of applying a declared policy to a RETRY decision. */
    private record RetryStep(WorkflowInstance instance, RetryOutcome outcome) {}

    /** Returns the open history entry for a branch's node, or null when none is open. */
    private HistoryEntry openEntry(WorkflowInstance instance, String branchId, String nodeId) {
        List<HistoryEntry> history = instance.history();
        for (int i = history.size() - 1; i >= 0; i--) {
            HistoryEntry h = history.get(i);
            if (Objects.equals(h.branchId(), branchId) && h.nodeId().equals(nodeId)) {
                return h.completedOn() == null ? h : null;
            }
        }
        return null;
    }

    /** Replaces the open history entry for a branch's node; no-op when none is open. */
    private WorkflowInstance updateOpenEntry(WorkflowInstance instance, String branchId, String nodeId,
                                             UnaryOperator<HistoryEntry> change) {
        List<HistoryEntry> history = new ArrayList<>(instance.history());
        for (int i = history.size() - 1; i >= 0; i--) {
            HistoryEntry h = history.get(i);
            if (Objects.equals(h.branchId(), branchId) && h.nodeId().equals(nodeId)) {
                if (h.completedOn() == null) history.set(i, change.apply(h));
                break;
            }
        }
        return instance.toBuilder().history(history).build();
    }

    /** Returns the attempt number of the branch's open visit (1 when unrecorded). */
    private int currentAttempt(WorkflowInstance instance, String branchId, String nodeId) {
        HistoryEntry entry = openEntry(instance, branchId, nodeId);
        return entry == null ? 1 : entry.effectiveAttempt();
    }

    /**
     * Applies a declared policy after the handler chose RETRY: fails when attempts are exhausted, otherwise
     * records the next attempt and either retries inline (zero delay) or parks with {@code retryAt}.
     */
    private RetryStep planRetry(WorkflowInstance instance, String branchId, WorkflowNode node,
                                RetryPolicy policy, WorkflowError error) {
        int attempt = currentAttempt(instance, branchId, node.id());
        if (attempt >= policy.maxAttempts()) {
            return new RetryStep(failWorkflow(instance,
                "Exceeded retry limit (" + (policy.maxAttempts() - 1) + "): " + error.diagnostic(), error),
                RetryOutcome.EXHAUSTED);
        }
        Duration delay = policy.delayFor(attempt, random);
        Instant retryAt = delay.isZero() ? null : clock.instant().plus(delay);
        WorkflowInstance updated = updateOpenEntry(instance, branchId, node.id(),
            entry -> entry.withRetry(attempt + 1, retryAt))
            .toBuilder().updatedOn(Instant.now()).build();
        return new RetryStep(updated, retryAt == null ? RetryOutcome.INLINE : RetryOutcome.PARKED);
    }
```

- [ ] **Step 5: Rewrite the RETRY branch of `executeActionNode`**

At method start, after `actionType`:

```java
        Optional<RetryPolicy> declared = RetryPolicy.effective(workflow, actionNode);
        int retries = 0;
```

Replace the `if (error != null) { ... }` block with:

```java
            if (error != null) {
                int attempt = currentAttempt(instance, branchId, actionNode.id());
                Recovery resolution = recoveryPolicy.resolve(workflow, instance, actionNode, result, error,
                    new RetryContext(attempt, declared));
                if (resolution.action() == ErrorAction.RETRY) {
                    if (declared.isEmpty()) {
                        if (++retries > MAX_RETRIES) {
                            return failWorkflow(instance,
                                "Exceeded retry limit (" + MAX_RETRIES + "): " + error.diagnostic(), error);
                        }
                        continue;
                    }
                    RetryStep step = planRetry(instance, branchId, actionNode, declared.get(), error);
                    instance = step.instance();
                    if (step.outcome() == RetryOutcome.INLINE) continue;
                    return instance; // EXHAUSTED (failed) or PARKED (open entry; quiesce() marks WAITING)
                }
                return applyResolution(workflow, instance, branchId, actionNode, resolution, work);
            }
```

Legacy path deliberately does not record `attempt` (keeps history identical to today).

- [ ] **Step 6: Run tests**

Run: `mvn -q test`
Expected: PASS, including all of `WorkflowEngineRetryPolicyTest`.

- [ ] **Step 7: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineRetryPolicyTest.java
git commit -m "Apply declarative retry policies to action execution (#86)"
```

---

### Task 5: Engine — async resumes and host retry API

**Files:**
- Create: `engine/src/main/java/io/apitomy/flow/model/RetryInfo.java`
- Modify: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java`
- Test: `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineRetryPolicyTest.java` (append)

**Interfaces:**
- Consumes: `planRetry`, `RetryStep`, `RetryOutcome`, `openEntry`, `updateOpenEntry`, `currentAttempt`
  from Task 4.
- Produces: `record RetryInfo(String nodeId, String branchId, int attempt, Instant retryAt)`;
  `public List<RetryInfo> getPendingRetries(WorkflowInstance instance)`;
  `public WorkflowInstance retryNode(Workflow workflow, WorkflowInstance instance, String nodeId)`.

- [ ] **Step 1: Write the failing tests** (append inside `WorkflowEngineRetryPolicyTest`)

```java
    /** Executor that parks (PENDING) every call. */
    static NodeExecutor pending(AtomicInteger calls) {
        return new NodeExecutor() {
            @Override public String actionType() { return "flaky"; }
            @Override public NodeResult execute(NodeExecutionContext context) {
                calls.incrementAndGet();
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };
    }

    @Test
    void retryNodeRunsParkedRetryAndClearsRetryAt() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowEngine engine = engine(flaky(1, calls), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3, "delay", "PT30S"), null);
        WorkflowInstance parked = engine.startWorkflow(workflow, Map.of());

        assertEquals(List.of(new RetryInfo("act", "root", 2, NOW.plusSeconds(30))),
            engine.getPendingRetries(parked));
        assertNull(engine.getActionInfo(workflow, parked, "act"), "a scheduled retry is not pending async work");
        assertThrows(IllegalStateException.class, () -> engine.completeNode(workflow, parked, "act",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of())));

        WorkflowInstance done = engine.retryNode(workflow, parked, "act");
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals(2, calls.get());
        assertEquals(2, actEntry(done).attempt());
        assertNull(actEntry(done).retryAt());
        assertEquals(List.of(), engine.getPendingRetries(done));
    }

    @Test
    void lateOrDuplicateRetryNodeIsNoOp() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowEngine engine = engine(flaky(1, calls), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3, "delay", "PT30S"), null);
        WorkflowInstance done = engine.retryNode(workflow, engine.startWorkflow(workflow, Map.of()), "act");
        assertSame(done, engine.retryNode(workflow, done, "act"));
        assertEquals(2, calls.get());
    }

    @Test
    void retryNodeIgnoresAsyncPendingAction() {
        WorkflowEngine engine = engine(pending(new AtomicInteger()), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3), null);
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        assertSame(waiting, engine.retryNode(workflow, waiting, "act"));
    }

    @Test
    void attemptCountSurvivesAsyncResumes() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowEngine engine = engine(pending(calls), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3), null);
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        NodeResult failed = new NodeResult(NodeResultStatus.FAILED, Map.of("error", "boom"));

        instance = engine.completeNode(workflow, instance, "act", failed); // attempt 1 fails -> runs attempt 2
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals(2, actEntry(instance).attempt());
        instance = engine.completeNode(workflow, instance, "act", failed); // attempt 2 fails -> runs attempt 3
        assertEquals(3, actEntry(instance).attempt());
        instance = engine.completeNode(workflow, instance, "act", failed); // attempt 3 fails -> exhausted
        assertEquals(InstanceStatus.FAILED, instance.status());
        assertTrue(instance.failureReason().startsWith("Exceeded retry limit (2): "), instance.failureReason());
        assertEquals(3, calls.get());
    }

    @Test
    void asyncFailureWithDelayParksForRetry() {
        WorkflowEngine engine = engine(pending(new AtomicInteger()), alwaysRetry(new ArrayList<>()));
        Workflow workflow = workflow(Map.of("maxAttempts", 3, "delay", "PT5S"), null);
        WorkflowInstance instance = engine.completeNode(workflow, engine.startWorkflow(workflow, Map.of()), "act",
            new NodeResult(NodeResultStatus.FAILED, Map.of()));
        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals(List.of(new RetryInfo("act", "root", 2, NOW.plusSeconds(5))),
            engine.getPendingRetries(instance));
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `mvn -q test -Dtest=WorkflowEngineRetryPolicyTest`
Expected: compilation failure (`RetryInfo`, `retryNode`, `getPendingRetries` missing).

- [ ] **Step 3: Create `RetryInfo`**

```java
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
```

- [ ] **Step 4: Apply the policy in the async completion path**

In `handleFailedCompletion`, pass the retry context:

```java
        Optional<RetryPolicy> declared = RetryPolicy.effective(workflow, node);
        Recovery resolution = recoveryPolicy.resolve(workflow, instance, node, result, error,
            node.type() == NodeType.ACTION
                ? new RetryContext(currentAttempt(instance, branchId, node.id()), declared)
                : RetryContext.NONE);
```

In `resumeResolution`, replace the RETRY branch:

```java
        if (resolution.action() == ErrorAction.RETRY) {
            Optional<RetryPolicy> declared = RetryPolicy.effective(workflow, node);
            if (declared.isEmpty()) {
                work.addFirst(new BranchWork(new ActiveBranch(branchId, node.id()), WorkKind.RETRY,
                    null, resolution.error()));
                resolved = running;
            } else {
                RetryStep step = planRetry(running, branchId, node, declared.get(), resolution.error());
                if (step.outcome() == RetryOutcome.EXHAUSTED) return step.instance();
                resolved = step.instance();
                if (step.outcome() == RetryOutcome.INLINE) {
                    work.addFirst(new BranchWork(new ActiveBranch(branchId, node.id()), WorkKind.RETRY,
                        null, resolution.error()));
                }
                // PARKED: nothing queued for this branch; quiesce() derives WAITING from the open entry.
            }
        } else {
```

- [ ] **Step 5: Add the host API and guards**

Add near `onReceiveEventTimeout`:

```java
    /**
     * Lists action nodes parked for a delayed retry. Hosts schedule a timer per entry and call
     * {@link #retryNode} when it fires.
     *
     * @param instance the instance to inspect
     * @return parked retries in active-branch order; empty unless the instance is WAITING
     */
    public List<RetryInfo> getPendingRetries(WorkflowInstance instance) {
        if (instance.status() != InstanceStatus.WAITING) return List.of();
        return instance.activeBranches().stream()
            .map(branch -> {
                HistoryEntry entry = openEntry(instance, branch.branchId(), branch.nodeId());
                return entry == null || entry.retryAt() == null ? null
                    : new RetryInfo(branch.nodeId(), branch.branchId(), entry.effectiveAttempt(), entry.retryAt());
            })
            .filter(Objects::nonNull)
            .toList();
    }

    /**
     * Runs a parked delayed retry. The host calls this when the timer it scheduled from
     * {@link RetryInfo#retryAt()} fires; the engine does not enforce the due time.
     *
     * <p>Timers race with cancellation and duplicates, so this is a no-op (the instance is returned
     * unchanged) when the node is not currently parked for a retry.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @param nodeId   the parked action node id
     * @return the advanced instance, or {@code instance} unchanged when no retry is parked at the node
     */
    public WorkflowInstance retryNode(Workflow workflow, WorkflowInstance instance, String nodeId) {
        if (!isParkedNode(instance, nodeId)) return instance;
        ActiveBranch branch = instance.activeBranches().stream()
            .filter(b -> nodeId.equals(b.nodeId()))
            .filter(b -> {
                HistoryEntry entry = openEntry(instance, b.branchId(), nodeId);
                return entry != null && entry.retryAt() != null;
            })
            .findFirst()
            .orElse(null);
        if (branch == null) return instance;
        WorkflowInstance running = updateOpenEntry(instance, branch.branchId(), nodeId,
            entry -> entry.withRetry(entry.attempt(), null))
            .toBuilder().status(InstanceStatus.RUNNING).updatedOn(Instant.now()).build();
        Deque<BranchWork> work = runnableBranches(running);
        work.addFirst(new BranchWork(branch, WorkKind.RETRY));
        return advanceBranches(workflow, running, work, ParallelRegions.analyze(workflow));
    }

    /** Reports whether a branch's open visit at the node is parked for a delayed retry. */
    private boolean isRetryParked(WorkflowInstance instance, String nodeId) {
        return instance.activeBranches().stream()
            .filter(b -> nodeId.equals(b.nodeId()))
            .map(b -> openEntry(instance, b.branchId(), nodeId))
            .anyMatch(entry -> entry != null && entry.retryAt() != null);
    }
```

Guard `completeNode` right after the WAITING check:

```java
        if (isRetryParked(instance, nodeId)) {
            throw new IllegalStateException("Node is scheduled for retry; call retryNode instead: " + nodeId);
        }
```

Guard `getActionInfo(workflow, instance, nodeId)` after `isParkedNode`:

```java
        if (isRetryParked(instance, nodeId)) {
            return null;
        }
```

Update the `advanceBranches` Javadoc sentence "Local action retries retain their separate MAX_RETRIES guard;
neither limit is a durable retry policy." to: "Action retries are bounded by the node's declared retry policy
(durable on the history entry) or, without one, by the call-local MAX_RETRIES guard."

- [ ] **Step 6: Run tests**

Run: `mvn -q test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow
git add engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineRetryPolicyTest.java
git commit -m "Support delayed retries and durable attempts across async resumes (#86)"
```

---

### Task 6: Java validation, shared conformance fixture, and JSON schema

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/validation/WorkflowValidator.java`
- Create: `conformance/retry-validation.json`
- Modify: `conformance/workflow-v1.schema.json`, `conformance/README.md`
- Modify: `engine/src/test/java/io/apitomy/flow/engine/ConformanceTest.java`
- Test: `engine/src/test/java/io/apitomy/flow/validation/WorkflowValidatorTest.java` (append)

**Interfaces:**
- Produces: fixture format consumed by Task 7: array of `{ "name", "retry"?, "defaultsRetry"?, "nodeType"?,
  "problems": ["CODE:severity:nodeIdOr-"] }`. The fixture workflow is `start → act → end` where `act` has
  type `nodeType` (default `action`; config `{actionType:"t", inputs:{}, outputs:[]}` for actions, `{}` for
  `wait`/others plus `duration: "PT1S"` for `wait`) and `config.retry = retry` when present; `defaults =
  {retry: defaultsRetry}` when present. Only problems whose code contains `RETRY` are compared.

- [ ] **Step 1: Create the fixture `conformance/retry-validation.json`**

```json
[
    { "name": "minimal policy", "retry": { "maxAttempts": 1 }, "problems": [] },
    { "name": "full exponential policy", "retry": { "maxAttempts": 5, "delay": "PT2S", "backoff": "exponential", "multiplier": 1.5, "maxDelay": "PT1M", "jitter": true }, "problems": [] },
    { "name": "zero delay", "retry": { "maxAttempts": 3, "delay": "PT0S" }, "problems": [] },
    { "name": "policy not object", "retry": 3, "problems": ["INVALID_RETRY_POLICY:error:act"] },
    { "name": "missing maxAttempts", "retry": { "delay": "PT1S" }, "problems": ["INVALID_RETRY_MAX_ATTEMPTS:error:act"] },
    { "name": "zero maxAttempts", "retry": { "maxAttempts": 0 }, "problems": ["INVALID_RETRY_MAX_ATTEMPTS:error:act"] },
    { "name": "fractional maxAttempts", "retry": { "maxAttempts": 2.5 }, "problems": ["INVALID_RETRY_MAX_ATTEMPTS:error:act"] },
    { "name": "bad delay text", "retry": { "maxAttempts": 2, "delay": "soon" }, "problems": ["INVALID_RETRY_DELAY:error:act"] },
    { "name": "delay not string", "retry": { "maxAttempts": 2, "delay": 5 }, "problems": ["INVALID_RETRY_DELAY:error:act"] },
    { "name": "unknown backoff", "retry": { "maxAttempts": 2, "backoff": "linear" }, "problems": ["INVALID_RETRY_BACKOFF:error:act"] },
    { "name": "multiplier with fixed", "retry": { "maxAttempts": 2, "multiplier": 2 }, "problems": ["INVALID_RETRY_MULTIPLIER:error:act"] },
    { "name": "multiplier not above one", "retry": { "maxAttempts": 2, "backoff": "exponential", "multiplier": 1 }, "problems": ["INVALID_RETRY_MULTIPLIER:error:act"] },
    { "name": "zero maxDelay", "retry": { "maxAttempts": 2, "maxDelay": "PT0S" }, "problems": ["INVALID_RETRY_MAX_DELAY:error:act"] },
    { "name": "maxDelay below delay", "retry": { "maxAttempts": 2, "delay": "PT10S", "maxDelay": "PT5S" }, "problems": ["INVALID_RETRY_MAX_DELAY:error:act"] },
    { "name": "jitter not boolean", "retry": { "maxAttempts": 2, "jitter": "yes" }, "problems": ["INVALID_RETRY_JITTER:error:act"] },
    { "name": "valid workflow default", "defaultsRetry": { "maxAttempts": 3, "delay": "PT1S" }, "problems": [] },
    { "name": "invalid workflow default", "defaultsRetry": { "maxAttempts": 0 }, "problems": ["INVALID_RETRY_MAX_ATTEMPTS:error:-"] },
    { "name": "retry on wait node", "nodeType": "wait", "retry": { "maxAttempts": 2 }, "problems": ["RETRY_ON_NON_ACTION_NODE:warning:act"] }
]
```

- [ ] **Step 2: Add the Java conformance test** (in `ConformanceTest`)

```java
    static Stream<Fixture> retryValidation() throws Exception { return fixtures("retry-validation"); }

    @ParameterizedTest(name = "retry validation: {0}")
    @MethodSource("retryValidation")
    void retryValidationContract(Fixture fixture) {
        JsonNode data = fixture.data();
        NodeType type = data.has("nodeType") ? NodeType.valueOf(data.path("nodeType").asText().toUpperCase())
            : NodeType.ACTION;
        Map<String, Object> config = new java.util.HashMap<>(type == NodeType.ACTION
            ? Map.of("actionType", "t", "inputs", Map.of(), "outputs", List.of())
            : type == NodeType.WAIT ? Map.of("duration", "PT1S") : Map.of());
        if (data.has("retry")) config.put("retry", MAPPER.convertValue(data.path("retry"), Object.class));
        Map<String, Object> defaults = data.has("defaultsRetry")
            ? Map.of("retry", MAPPER.convertValue(data.path("defaultsRetry"), Object.class)) : null;
        Workflow workflow = new Workflow("retry", "Retry", null, null, List.of(
            node("start", NodeType.START, Map.of("inputs", List.of())),
            node("act", type, config),
            node("end", NodeType.END, Map.of())
        ), List.of(new WorkflowEdge("begin", "start", "act", null, 0, false, null),
            new WorkflowEdge("finish", "act", "end", null, 0, false, null)), defaults);
        assertJson(data.path("problems"), MAPPER.valueToTree(new WorkflowValidator().validate(workflow).stream()
            .filter(p -> p.code().contains("RETRY"))
            .map(p -> p.code() + ":" + p.severity().toString().toLowerCase() + ":"
                + (p.nodeId() == null ? "-" : p.nodeId())).toList()));
    }
```

(`node(...)` and `assertJson(...)` are existing helpers in `ConformanceTest`.)

- [ ] **Step 3: Write targeted validator unit tests** (append to `WorkflowValidatorTest`)

```java
    @Test
    void validRetryPolicyProducesNoRetryProblems() {
        Workflow workflow = new Workflow("w", "W", null, null, List.of(startNode("s"),
            new WorkflowNode("a", NodeType.ACTION, "a", Map.of("actionType", "t", "inputs", Map.of(),
                "outputs", List.of(), "retry", Map.of("maxAttempts", 3, "delay", "PT1S")), new Position(0, 0)),
            endNode("e")), List.of(edge("1", "s", "a"), edge("2", "a", "e")));
        assertTrue(new WorkflowValidator().validate(workflow).stream().noneMatch(p -> p.code().contains("RETRY")));
    }

    @Test
    void negativeRetryDelayIsRejected() {
        Workflow workflow = new Workflow("w", "W", null, null, List.of(startNode("s"),
            new WorkflowNode("a", NodeType.ACTION, "a", Map.of("actionType", "t", "inputs", Map.of(),
                "outputs", List.of(), "retry", Map.of("maxAttempts", 3, "delay", "-PT1S")), new Position(0, 0)),
            endNode("e")), List.of(edge("1", "s", "a"), edge("2", "a", "e")));
        assertTrue(new WorkflowValidator().validate(workflow).stream()
            .anyMatch(p -> p.code().equals("INVALID_RETRY_DELAY")));
    }
```

- [ ] **Step 4: Run to verify failure**

Run: `mvn -q test -Dtest=ConformanceTest,WorkflowValidatorTest`
Expected: FAIL — invalid fixtures report `[]` instead of the expected codes.

- [ ] **Step 5: Implement the validator**

In `validateSemantics`, before `detectAutomatedCycles(...)`, add `validateRetryPolicies(workflow, problems);`
and add:

```java
    /** Validates node-level and workflow-default retry policies (mirrors validateWorkflow.ts). */
    private void validateRetryPolicies(Workflow workflow, List<ValidationProblem> problems) {
        if (workflow.defaults() != null && workflow.defaults().get("retry") != null) {
            validateRetryPolicy(workflow.defaults().get("retry"), null, problems);
        }
        for (WorkflowNode node : workflow.nodes()) {
            Object retry = node.config() == null ? null : node.config().get("retry");
            if (retry == null) continue;
            if (node.type() != NodeType.ACTION) {
                problems.add(ValidationProblem.warning("RETRY_ON_NON_ACTION_NODE",
                    "Retry policies only apply to action nodes", node.id()));
                continue;
            }
            validateRetryPolicy(retry, node.id(), problems);
        }
    }

    private void validateRetryPolicy(Object raw, String nodeId, List<ValidationProblem> problems) {
        if (!(raw instanceof Map<?, ?> policy)) {
            problems.add(ValidationProblem.error("INVALID_RETRY_POLICY", "Retry policy must be an object", nodeId));
            return;
        }
        Object maxAttempts = policy.get("maxAttempts");
        if (!(maxAttempts instanceof Number n) || n.doubleValue() != Math.rint(n.doubleValue())
                || n.doubleValue() < 1 || n.doubleValue() > Integer.MAX_VALUE) {
            problems.add(ValidationProblem.error("INVALID_RETRY_MAX_ATTEMPTS",
                "Retry maxAttempts must be an integer of at least 1", nodeId));
        }
        Duration delay = retryDuration(policy.get("delay"));
        if (policy.get("delay") != null && (delay == null || delay.isNegative())) {
            problems.add(ValidationProblem.error("INVALID_RETRY_DELAY",
                "Retry delay must be a non-negative ISO 8601 duration", nodeId));
            delay = null;
        }
        Object backoff = policy.get("backoff");
        if (backoff != null && !RetryPolicy.FIXED.equals(backoff) && !RetryPolicy.EXPONENTIAL.equals(backoff)) {
            problems.add(ValidationProblem.error("INVALID_RETRY_BACKOFF",
                "Retry backoff must be \"fixed\" or \"exponential\"", nodeId));
        }
        Object multiplier = policy.get("multiplier");
        if (multiplier != null && (!(multiplier instanceof Number m) || !(m.doubleValue() > 1)
                || !RetryPolicy.EXPONENTIAL.equals(backoff))) {
            problems.add(ValidationProblem.error("INVALID_RETRY_MULTIPLIER",
                "Retry multiplier must be a number greater than 1 and requires exponential backoff", nodeId));
        }
        Object maxDelayRaw = policy.get("maxDelay");
        if (maxDelayRaw != null) {
            Duration maxDelay = retryDuration(maxDelayRaw);
            if (maxDelay == null || maxDelay.isNegative() || maxDelay.isZero()
                    || (delay != null && maxDelay.compareTo(delay) < 0)) {
                problems.add(ValidationProblem.error("INVALID_RETRY_MAX_DELAY",
                    "Retry maxDelay must be a positive ISO 8601 duration no smaller than delay", nodeId));
            }
        }
        Object jitter = policy.get("jitter");
        if (jitter != null && !(jitter instanceof Boolean)) {
            problems.add(ValidationProblem.error("INVALID_RETRY_JITTER", "Retry jitter must be a boolean", nodeId));
        }
    }

    /** Parses a retry duration, returning null when absent or malformed. */
    private static Duration retryDuration(Object value) {
        if (!(value instanceof String text)) return null;
        try {
            return Duration.parse(text);
        } catch (Exception e) {
            return null;
        }
    }
```

`ValidationProblem.error(code, message, nodeId)` with a null `nodeId` is the workflow-level form (verify the
3-arg factory accepts null; it does: it only stores the value).

- [ ] **Step 6: Update the schema**

In `conformance/workflow-v1.schema.json`, add under top-level `properties`:

```json
        "defaults": {
            "type": ["object", "null"],
            "description": "Workflow-level defaults. retry is the default retry policy for action nodes without their own.",
            "properties": { "retry": { "$ref": "#/definitions/retryPolicy" } },
            "additionalProperties": true
        },
```

add `"retry": { "$ref": "#/definitions/retryPolicy" }` to `definitions.action.properties`, and add to
`definitions`:

```json
        "retryPolicy": {
            "type": ["object", "null"],
            "description": "Declarative retry policy. Semantic rules (ranges, maxDelay >= delay, multiplier only with exponential) are enforced by the validators.",
            "properties": {
                "maxAttempts": { "type": "integer", "minimum": 1 },
                "delay": { "type": "string", "description": "Non-negative ISO-8601 duration; default PT0S." },
                "backoff": { "enum": ["fixed", "exponential"] },
                "multiplier": { "type": "number", "exclusiveMinimum": 1 },
                "maxDelay": { "type": "string", "description": "Positive ISO-8601 duration cap." },
                "jitter": { "type": "boolean" }
            },
            "additionalProperties": true
        },
```

Add a one-line entry for `retry-validation.json` to `conformance/README.md` following the existing list style.

- [ ] **Step 7: Run tests**

Run: `mvn -q test`
Expected: PASS. (If `ui/src/types/schema.contract.test.ts` checks schema/type parity, it is fixed in Task 7.)

- [ ] **Step 8: Commit**

```bash
git add conformance engine/src
git commit -m "Validate retry policies in the engine and add shared conformance fixtures (#86)"
```

---

### Task 7: TypeScript types, validator, and retry utilities

**Files:**
- Modify: `ui/src/types/workflow.ts`, `ui/src/types/instance.ts`, `ui/src/index.ts`
- Modify: `ui/src/validation/validateWorkflow.ts`
- Create: `ui/src/utils/retryPolicy.ts`, `ui/src/utils/retryPolicy.test.ts`
- Modify: `ui/src/simulation/conformance.test.ts`

**Interfaces:**
- Consumes: `conformance/retry-validation.json` (Task 6 format).
- Produces (types): `RetryBackoff = 'fixed' | 'exponential'`; `interface RetryPolicy extends ConfigExtensions
  { maxAttempts?: number | null; delay?: string | null; backoff?: RetryBackoff | null; multiplier?: number |
  null; maxDelay?: string | null; jitter?: boolean | null }`; `interface WorkflowDefaults extends
  ConfigExtensions { retry?: RetryPolicy | null }`; `ActionConfig.retry?: RetryPolicy | null`;
  `Workflow.defaults?: WorkflowDefaults | null`; `HistoryEntry.attempt?: number`, `HistoryEntry.retryAt?:
  string`.
- Produces (utils): `effectiveRetryPolicy(node: WorkflowNode, defaults?: WorkflowDefaults | null):
  { policy: RetryPolicy; source: 'node' | 'workflow' } | undefined`; `describeRetryPolicy(policy:
  RetryPolicy): string`; `isoDurationMillis(value: string): number | undefined` (exported from
  `validateWorkflow.ts`).

- [ ] **Step 1: Add types**

In `types/workflow.ts`, before `ActionConfig`:

```ts
/** Delay growth between retry attempts. */
export type RetryBackoff = 'fixed' | 'exponential';
/**
 * Declarative retry policy for action nodes (mirrors Java `RetryPolicy`). `maxAttempts` counts every
 * attempt including the first. `delay` (default `PT0S`) and `maxDelay` are ISO-8601 durations; `multiplier`
 * (default 2) applies only to exponential backoff; `jitter` randomizes each delay in `[0, delay]`.
 */
export interface RetryPolicy extends ConfigExtensions {
    maxAttempts?: number | null;
    delay?: string | null;
    backoff?: RetryBackoff | null;
    multiplier?: number | null;
    maxDelay?: string | null;
    jitter?: boolean | null;
}
/** Workflow-level defaults. `retry` applies to action nodes that declare no policy of their own. */
export interface WorkflowDefaults extends ConfigExtensions {
    retry?: RetryPolicy | null;
}
```

Add `retry?: RetryPolicy | null;` (with a one-line doc: "Overrides `workflow.defaults.retry` wholesale.") to
`ActionConfig`, and `defaults?: WorkflowDefaults | null;` to `Workflow`. Export `RetryPolicy`, `RetryBackoff`,
`WorkflowDefaults` from `index.ts` in the first `export type { ... } from './types/workflow.ts'` list.

In `types/instance.ts` `HistoryEntry`, add:

```ts
  /** 1-based attempt number of this visit for retried action nodes. Absent means the first attempt. */
  attempt?: number;
  /** ISO-8601 instant when a parked delayed retry is due; present only while the retry is scheduled. */
  retryAt?: string;
```

- [ ] **Step 2: Write the failing conformance test** (append to `simulation/conformance.test.ts`)

```ts
import retryValidation from '../../../conformance/retry-validation.json';

describe('shared retry policy validation', () => {
    for (const fixture of retryValidation as Array<{ name: string; retry?: unknown; defaultsRetry?: unknown;
        nodeType?: string; problems: string[] }>) {
        it(fixture.name, () => {
            const type = fixture.nodeType ?? 'action';
            const config: Record<string, unknown> = type === 'action'
                ? { actionType: 't', inputs: {}, outputs: [] } : type === 'wait' ? { duration: 'PT1S' } : {};
            if ('retry' in fixture) config.retry = fixture.retry;
            const workflow = {
                id: 'retry', name: 'Retry',
                ...('defaultsRetry' in fixture ? { defaults: { retry: fixture.defaultsRetry } } : {}),
                nodes: [
                    { id: 'start', name: 'start', type: 'start', config: { inputs: [] }, position: { x: 0, y: 0 } },
                    { id: 'act', name: 'act', type, config, position: { x: 100, y: 0 } },
                    { id: 'end', name: 'end', type: 'end', config: {}, position: { x: 200, y: 0 } },
                ],
                edges: [{ id: 'begin', source: 'start', target: 'act', priority: 0, isDefault: false },
                    { id: 'finish', source: 'act', target: 'end', priority: 0, isDefault: false }],
            };
            expect(validateWorkflow(workflow).filter(p => p.code.includes('RETRY'))
                .map(p => `${p.code}:${p.severity}:${p.nodeId ?? '-'}`)).toEqual(fixture.problems);
        });
    }
});
```

(Move the import to the top of the file with the other fixture imports.)

- [ ] **Step 3: Write the failing util test** `utils/retryPolicy.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { describeRetryPolicy, effectiveRetryPolicy } from './retryPolicy.ts';
import { isoDurationMillis } from '../validation/validateWorkflow.ts';
import { type WorkflowNode } from '../types/workflow.ts';

const action = (retry?: object): WorkflowNode => ({ id: 'a', name: 'a', type: 'action',
    config: { actionType: 't', ...(retry ? { retry } : {}) } } as WorkflowNode);

describe('retry policy utilities', () => {
    it('prefers the node policy over the workflow default', () => {
        expect(effectiveRetryPolicy(action({ maxAttempts: 2 }), { retry: { maxAttempts: 9 } }))
            .toEqual({ policy: { maxAttempts: 2 }, source: 'node' });
        expect(effectiveRetryPolicy(action(), { retry: { maxAttempts: 9 } }))
            .toEqual({ policy: { maxAttempts: 9 }, source: 'workflow' });
        expect(effectiveRetryPolicy(action(), undefined)).toBeUndefined();
        expect(effectiveRetryPolicy({ id: 'e', name: 'e', type: 'end', config: {} }, { retry: { maxAttempts: 9 } }))
            .toBeUndefined();
    });

    it('describes policies', () => {
        expect(describeRetryPolicy({ maxAttempts: 3 })).toBe('Up to 3 attempts, retried immediately');
        expect(describeRetryPolicy({ maxAttempts: 5, delay: 'PT2S' })).toBe('Up to 5 attempts, PT2S between attempts');
        expect(describeRetryPolicy({ maxAttempts: 5, delay: 'PT2S', backoff: 'exponential', multiplier: 3,
            maxDelay: 'PT1M', jitter: true }))
            .toBe('Up to 5 attempts, exponential backoff from PT2S (x3, max PT1M), with jitter');
    });

    it('parses ISO durations to milliseconds', () => {
        expect(isoDurationMillis('PT0S')).toBe(0);
        expect(isoDurationMillis('P1DT1H1M1.5S')).toBe(90061500);
        expect(isoDurationMillis('soon')).toBeUndefined();
    });
});
```

- [ ] **Step 4: Run to verify failure**

Run (in `ui/`): `npx vitest run src/utils/retryPolicy.test.ts src/simulation/conformance.test.ts`
Expected: FAIL (module `retryPolicy.ts` missing; invalid fixtures produce no problems).

- [ ] **Step 5: Implement the validator** (in `validateWorkflow.ts`)

Call `validateRetryPolicies(workflow, problems);` at the end of `validateSemantics` (before automated-cycle
detection, matching Java order). Add:

```ts
/** Validates node-level and workflow-default retry policies (mirrors WorkflowValidator.java). */
function validateRetryPolicies(workflow: Workflow, problems: ValidationProblem[]) {
  const defaults = workflow.defaults;
  if (defaults && typeof defaults === 'object' && defaults.retry != null) {
    validateRetryPolicy(defaults.retry, undefined, problems);
  }
  for (const node of workflow.nodes) {
    const retry = (node.config as Record<string, unknown> | undefined)?.retry;
    if (retry == null) continue;
    if (node.type !== 'action') {
      problems.push(problem('warning', 'RETRY_ON_NON_ACTION_NODE', 'Retry policies only apply to action nodes', node.id));
      continue;
    }
    validateRetryPolicy(retry, node.id, problems);
  }
}

function validateRetryPolicy(raw: unknown, nodeId: string | undefined, problems: ValidationProblem[]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(problem('error', 'INVALID_RETRY_POLICY', 'Retry policy must be an object', nodeId));
    return;
  }
  const policy = raw as Record<string, unknown>;
  const max = policy.maxAttempts;
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 2147483647) {
    problems.push(problem('error', 'INVALID_RETRY_MAX_ATTEMPTS', 'Retry maxAttempts must be an integer of at least 1', nodeId));
  }
  let delay: number | undefined;
  if (policy.delay != null) {
    delay = typeof policy.delay === 'string' ? isoDurationMillis(policy.delay) : undefined;
    if (delay === undefined) {
      problems.push(problem('error', 'INVALID_RETRY_DELAY', 'Retry delay must be a non-negative ISO 8601 duration', nodeId));
    }
  }
  const backoff = policy.backoff;
  if (backoff != null && backoff !== 'fixed' && backoff !== 'exponential') {
    problems.push(problem('error', 'INVALID_RETRY_BACKOFF', 'Retry backoff must be "fixed" or "exponential"', nodeId));
  }
  const multiplier = policy.multiplier;
  if (multiplier != null && (typeof multiplier !== 'number' || !(multiplier > 1) || backoff !== 'exponential')) {
    problems.push(problem('error', 'INVALID_RETRY_MULTIPLIER',
      'Retry multiplier must be a number greater than 1 and requires exponential backoff', nodeId));
  }
  if (policy.maxDelay != null) {
    const maxDelay = typeof policy.maxDelay === 'string' ? isoDurationMillis(policy.maxDelay) : undefined;
    if (maxDelay === undefined || maxDelay <= 0 || (delay !== undefined && maxDelay < delay)) {
      problems.push(problem('error', 'INVALID_RETRY_MAX_DELAY',
        'Retry maxDelay must be a positive ISO 8601 duration no smaller than delay', nodeId));
    }
  }
  if (policy.jitter != null && typeof policy.jitter !== 'boolean') {
    problems.push(problem('error', 'INVALID_RETRY_JITTER', 'Retry jitter must be a boolean', nodeId));
  }
}

/**
 * Converts a `java.time.Duration`-compatible ISO-8601 duration (PnDTnHnMnS) to milliseconds.
 *
 * @returns the non-negative duration in milliseconds, or `undefined` when malformed
 */
export function isoDurationMillis(value: string): number | undefined {
  if (!isValidIsoDuration(value)) return undefined;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match) return undefined;
  const [, d = '0', h = '0', m = '0', s = '0'] = match;
  return Math.round(((Number(d) * 24 + Number(h)) * 60 + Number(m)) * 60000 + Number(s) * 1000);
}
```

- [ ] **Step 6: Implement `utils/retryPolicy.ts`**

```ts
import { type RetryPolicy, type WorkflowDefaults, type WorkflowNode } from '../types/workflow.ts';

/** The policy governing an action node and where it was declared. */
export interface EffectiveRetryPolicy {
    policy: RetryPolicy;
    source: 'node' | 'workflow';
}

/**
 * Resolves an action node's effective retry policy: its own `config.retry`, else `defaults.retry`.
 *
 * @returns the policy and its source, or `undefined` for non-action nodes and legacy (no policy) behavior
 */
export function effectiveRetryPolicy(node: WorkflowNode, defaults?: WorkflowDefaults | null): EffectiveRetryPolicy | undefined {
    if (node.type !== 'action') return undefined;
    if (node.config.retry) return { policy: node.config.retry, source: 'node' };
    if (defaults?.retry) return { policy: defaults.retry, source: 'workflow' };
    return undefined;
}

/** Summarizes a policy in one human-readable sentence for tooltips and the properties panel. */
export function describeRetryPolicy(policy: RetryPolicy): string {
    const attempts = `Up to ${policy.maxAttempts ?? '?'} attempts`;
    const delay = policy.delay ?? 'PT0S';
    if (/^P(?:0D)?(?:T(?:0H)?(?:0M)?(?:0(?:\.0+)?S)?)?$/.test(delay)) return `${attempts}, retried immediately`;
    const jitter = policy.jitter ? ', with jitter' : '';
    if (policy.backoff === 'exponential') {
        const extras = [`x${policy.multiplier ?? 2}`, ...(policy.maxDelay ? [`max ${policy.maxDelay}`] : [])];
        return `${attempts}, exponential backoff from ${delay} (${extras.join(', ')})${jitter}`;
    }
    return `${attempts}, ${delay} between attempts${policy.maxDelay ? ` (max ${policy.maxDelay})` : ''}${jitter}`;
}
```

- [ ] **Step 7: Run tests, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS (including `types/schema.contract.test.ts` against the Task 6 schema).

- [ ] **Step 8: Commit**

```bash
git add ui/src conformance
git commit -m "Add retry policy types, validation, and utilities to the UI (#86)"
```

---

### Task 8: Editor — retry fields for action nodes and workflow defaults

**Files:**
- Create: `ui/src/components/panels/RetryPolicyFields.tsx`, `ui/src/components/panels/RetryPolicyFields.test.tsx`
- Modify: `ui/src/components/panels/PropertiesPanel.tsx` (props, empty-selection state, `ActionNodeFields`)
- Modify: `ui/src/hooks/editorState.ts` (new `defaults` command)
- Modify: `ui/src/components/WorkflowEditor.tsx` (pass defaults to both `PropertiesPanel` usages)
- Test: `ui/src/hooks/editorDefaults.test.ts`

**Interfaces:**
- Consumes: `RetryPolicy`, `WorkflowDefaults` types; `describeRetryPolicy` (Task 7).
- Produces: `RetryPolicyFields({ policy, onChange, enableLabel, inheritedHint? })` where `policy: RetryPolicy |
  null | undefined`, `onChange: (policy: RetryPolicy | undefined) => void`; editor command `{ type:
  'defaults'; defaults: WorkflowDefaults | undefined }`; `PropertiesPanel` props `workflowDefaults?:
  WorkflowDefaults | null` and `onWorkflowDefaultsChange?: (defaults: WorkflowDefaults | undefined) => void`.

- [ ] **Step 1: Write the failing tests**

`components/panels/RetryPolicyFields.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RetryPolicyFields, updateRetryPolicy } from './RetryPolicyFields.tsx';

vi.mock('@patternfly/react-core', () => ({}));
vi.mock('@patternfly/react-icons', () => ({}));

describe('retry policy fields', () => {
    it('renders only the enable checkbox when no policy is set', () => {
        const markup = renderToStaticMarkup(<RetryPolicyFields policy={undefined} onChange={() => {}}
            enableLabel="Override workflow default" inheritedHint="Inherits: Up to 3 attempts, retried immediately" />);
        expect(markup).toContain('Override workflow default');
        expect(markup).toContain('Inherits: Up to 3 attempts');
        expect(markup).not.toContain('Max attempts');
    });

    it('renders fields and hides multiplier for fixed backoff', () => {
        const markup = renderToStaticMarkup(<RetryPolicyFields policy={{ maxAttempts: 4, delay: 'PT2S' }}
            onChange={() => {}} enableLabel="Retry" />);
        expect(markup).toContain('Max attempts');
        expect(markup).toContain('value="4"');
        expect(markup).toContain('value="PT2S"');
        expect(markup).not.toContain('Multiplier');
        expect(markup).toContain('Up to 4 attempts, PT2S between attempts');
    });

    it('shows multiplier for exponential backoff', () => {
        const markup = renderToStaticMarkup(<RetryPolicyFields policy={{ maxAttempts: 4, backoff: 'exponential' }}
            onChange={() => {}} enableLabel="Retry" />);
        expect(markup).toContain('Multiplier');
    });

    it('drops blank fields and multiplier when switching to fixed', () => {
        expect(updateRetryPolicy({ maxAttempts: 3, delay: 'PT1S' }, 'delay', '')).toEqual({ maxAttempts: 3 });
        expect(updateRetryPolicy({ maxAttempts: 3, backoff: 'exponential', multiplier: 3 }, 'backoff', 'fixed'))
            .toEqual({ maxAttempts: 3, backoff: 'fixed' });
    });
});
```

`hooks/editorDefaults.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEditorState, editorReducer } from './editorState.ts';
import { readOnlyCommand } from './editorReadOnly.ts';
import { type Workflow } from '../types/workflow.ts';

const workflow: Workflow = { id: 'w', name: 'W', nodes: [
    { id: 's', name: 's', type: 'start', config: { inputs: [] }, position: { x: 0, y: 0 } }], edges: [] };

describe('workflow defaults command', () => {
    it('sets, undoes, and clears workflow defaults', () => {
        let state = createEditorState(workflow);
        state = editorReducer(state, { type: 'defaults', defaults: { retry: { maxAttempts: 3 } } });
        expect(state.document.defaults).toEqual({ retry: { maxAttempts: 3 } });
        state = editorReducer(state, { type: 'undo' });
        expect(state.document.defaults).toBeUndefined();
        state = editorReducer(state, { type: 'redo' });
        state = editorReducer(state, { type: 'defaults', defaults: undefined });
        expect('defaults' in state.document).toBe(false);
    });

    it('is blocked in read-only mode', () => {
        expect(readOnlyCommand({ type: 'defaults', defaults: { retry: { maxAttempts: 2 } } })).toBeNull();
    });
});
```

(If `editorReducer`'s signature differs from `(state, command)`, follow the call pattern used in
`hooks/editorDeletion.test.ts`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/panels/RetryPolicyFields.test.tsx src/hooks/editorDefaults.test.ts`
Expected: FAIL (module and command missing).

- [ ] **Step 3: Implement `RetryPolicyFields.tsx`**

```tsx
import { type RetryPolicy } from '../../types/workflow.ts';
import { describeRetryPolicy } from '../../utils/retryPolicy.ts';

type RetryField = 'maxAttempts' | 'delay' | 'backoff' | 'multiplier' | 'maxDelay' | 'jitter';

/**
 * Returns a copy of `policy` with one field changed from raw input text. Blank text removes the field;
 * numeric fields parse as numbers; switching to fixed backoff drops the multiplier.
 */
export function updateRetryPolicy(policy: RetryPolicy, field: RetryField, raw: string | boolean): RetryPolicy {
    const next: RetryPolicy = { ...policy };
    if (raw === '' || raw === false) {
        delete next[field];
    } else if (field === 'maxAttempts' || field === 'multiplier') {
        next[field] = Number(raw);
    } else if (field === 'jitter') {
        next.jitter = true;
    } else if (field === 'backoff') {
        next.backoff = raw === 'exponential' ? 'exponential' : 'fixed';
    } else {
        next[field] = String(raw);
    }
    if (next.backoff !== 'exponential') delete next.multiplier;
    return next;
}

/**
 * Edits an optional retry policy. Unchecking the enable box removes the policy (`onChange(undefined)`);
 * checking it starts from `{ maxAttempts: 3 }`.
 */
export function RetryPolicyFields({ policy, onChange, enableLabel, inheritedHint }: {
    policy: RetryPolicy | null | undefined;
    onChange: (policy: RetryPolicy | undefined) => void;
    enableLabel: string;
    inheritedHint?: string;
}) {
    const set = (field: RetryField, raw: string | boolean) => policy && onChange(updateRetryPolicy(policy, field, raw));
    return (
        <div className="properties-panel__field properties-panel__retry">
            <label>
                <input type="checkbox" checked={!!policy}
                    onChange={e => onChange(e.target.checked ? { maxAttempts: 3 } : undefined)} />
                {' '}{enableLabel}
            </label>
            {!policy && inheritedHint && <div className="properties-panel__hint">{inheritedHint}</div>}
            {policy && (
                <>
                    <label>Max attempts</label>
                    <input type="number" min={1} step={1} value={policy.maxAttempts ?? ''}
                        onChange={e => set('maxAttempts', e.target.value)} />
                    <label>Delay (ISO 8601)</label>
                    <input type="text" value={policy.delay ?? ''} placeholder="e.g. PT5S — blank retries immediately"
                        onChange={e => set('delay', e.target.value)} />
                    <label>Backoff</label>
                    <select value={policy.backoff ?? 'fixed'} onChange={e => set('backoff', e.target.value)}>
                        <option value="fixed">Fixed</option>
                        <option value="exponential">Exponential</option>
                    </select>
                    {policy.backoff === 'exponential' && (
                        <>
                            <label>Multiplier</label>
                            <input type="number" min={1} step={0.1} value={policy.multiplier ?? ''} placeholder="2"
                                onChange={e => set('multiplier', e.target.value)} />
                        </>
                    )}
                    <label>Max delay (ISO 8601, optional)</label>
                    <input type="text" value={policy.maxDelay ?? ''} placeholder="e.g. PT1M"
                        onChange={e => set('maxDelay', e.target.value)} />
                    <label>
                        <input type="checkbox" checked={!!policy.jitter} onChange={e => set('jitter', e.target.checked)} />
                        {' '}Jitter
                    </label>
                    <div className="properties-panel__hint">{describeRetryPolicy(policy)}</div>
                </>
            )}
        </div>
    );
}
```

Add minimal CSS in `PropertiesPanel.css`:

```css
.properties-panel__retry > label,
.properties-panel__retry > input,
.properties-panel__retry > select { display: block; margin-top: 4px; }
```

- [ ] **Step 4: Add the `defaults` editor command**

In `hooks/editorState.ts`, add to `EditorCommand`:

```ts
    | { type: 'defaults'; defaults: WorkflowDefaults | undefined }
```

(import `type WorkflowDefaults`), and in `reduceCommand` next to `case 'metadata':`:

```ts
        case 'defaults': {
            const next: Workflow = { ...document };
            if (command.defaults) next.defaults = command.defaults;
            else delete next.defaults;
            return commit(state, next);
        }
```

`readOnlyCommand` already returns `null` for unlisted commands — no change needed.

- [ ] **Step 5: Wire into `PropertiesPanel`**

Add props to `PropertiesPanelProps`:

```ts
  /** The workflow-level defaults, shown when nothing is selected. */
  workflowDefaults?: WorkflowDefaults | null;
  /** Updates workflow-level defaults; when omitted (and not read-only) the defaults section is hidden. */
  onWorkflowDefaultsChange?: (defaults: WorkflowDefaults | undefined) => void;
```

Replace the empty-selection branch:

```tsx
  if (!selectedNode && !selectedEdge) {
    const onDefaults = readOnly ? undefined : props.onWorkflowDefaultsChange;
    const showDefaults = !!onDefaults || (readOnly && !!props.workflowDefaults?.retry);
    return wrap(
      <>
        <div className="properties-panel__empty">Select a node or edge to view its properties</div>
        {showDefaults && (
          <div className="properties-panel__section">
            <h4>Workflow defaults</h4>
            <RetryPolicyFields policy={props.workflowDefaults?.retry} enableLabel="Default retry policy for action nodes"
              onChange={retry => {
                const rest: WorkflowDefaults = { ...(props.workflowDefaults ?? {}) };
                delete rest.retry;
                onDefaults?.(retry ? { ...rest, retry } : Object.keys(rest).length ? rest : undefined);
              }} />
          </div>
        )}
      </>,
    );
  }
```

(Host extension keys inside `defaults` are preserved; `defaults` is removed entirely when nothing remains.)

In `ActionNodeFields`, add a `workflowDefaults?: WorkflowDefaults | null` prop (passed from the
`<ActionNodeFields ... />` call site as `workflowDefaults={props.workflowDefaults}`) and append to the end of
its returned JSX:

```tsx
      <RetryPolicyFields
        policy={config.retry}
        enableLabel={workflowDefaults?.retry ? 'Override workflow default retry policy' : 'Retry on failure'}
        inheritedHint={workflowDefaults?.retry ? `Inherits: ${describeRetryPolicy(workflowDefaults.retry)}` : undefined}
        onChange={retry => onNodeChange(node.id, { config: { ...config, retry } })}
      />
```

Imports: `RetryPolicyFields` from `./RetryPolicyFields.tsx`, `describeRetryPolicy` from
`../../utils/retryPolicy.ts`, `type WorkflowDefaults` from `../../types/workflow.ts`.

- [ ] **Step 6: Wire into `WorkflowEditor`**

Add a callback near `onNodeDataChange`:

```tsx
  const onWorkflowDefaultsChange = useCallback((defaults: WorkflowDefaults | undefined) => {
    dispatch({ type: 'defaults', defaults });
  }, [dispatch]);
```

Pass `workflowDefaults={state.document.defaults}` and `onWorkflowDefaultsChange={onWorkflowDefaultsChange}` to
both `<PropertiesPanel>` usages (side panel and dialog).

- [ ] **Step 7: Add a panel test** (append to `PropertiesPanel.readOnly.test.tsx`)

```tsx
    it('shows workflow default retry policy read-only when nothing is selected', () => {
        const markup = renderToStaticMarkup(<PropertiesPanel readOnly workflowDefaults={{ retry: { maxAttempts: 4 } }}
            onNodeChange={() => {}} onNodeIdChange={() => {}} onEdgeChange={() => {}} />);
        expect(markup).toMatch(/<fieldset[^>]*disabled/);
        expect(markup).toContain('Workflow defaults');
        expect(markup).toContain('value="4"');
    });
```

- [ ] **Step 8: Run tests, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 9: Manual check in the dev app**

Run `npm run dev`, open <http://localhost:5173/>, select an action node, enable retry, set values, confirm the
summary hint updates and invalid values (e.g. `maxDelay` < `delay`) appear as validation problems. Deselect
and set a workflow default; confirm the action node shows the "Inherits: ..." hint.

- [ ] **Step 10: Commit**

```bash
git add ui/src
git commit -m "Edit node and workflow-default retry policies in the editor (#86)"
```

---

### Task 9: Viewer and canvas — retry badge and scheduled-retry status

**Files:**
- Modify: `ui/src/utils/conversion.ts` (`FlowNodeData.retryBadge`)
- Modify: `ui/src/components/nodes/ActionNode.tsx`, `ui/src/components/nodes/ActionNode.css`
- Modify: `ui/src/components/WorkflowViewer.tsx`, `ui/src/components/WorkflowEditor.tsx`
- Modify: `ui/src/utils/nodeStatus.ts`, `ui/src/utils/nodeStatus.test.ts`
- Modify: `ui/src/utils/retryPolicy.ts`, `ui/src/utils/retryPolicy.test.ts`

**Interfaces:**
- Consumes: `effectiveRetryPolicy`, `describeRetryPolicy` (Task 7); `HistoryEntry.attempt/retryAt`.
- Produces: `interface RetryBadge { label: string; title: string }`; `retryBadgesByNodeId(nodes:
  WorkflowNode[], defaults?: WorkflowDefaults | null): Map<string, RetryBadge>`; `FlowNodeData.retryBadge?:
  RetryBadge`; `getNodeStatusBadge({ ..., pendingRetry?: { attempt: number; maxAttempts?: number; retryAt:
  string } })`.

- [ ] **Step 1: Write the failing tests**

Append to `utils/retryPolicy.test.ts`:

```ts
import { retryBadgesByNodeId } from './retryPolicy.ts';

describe('retry badges', () => {
    it('labels nodes with an effective policy and notes inheritance', () => {
        const badges = retryBadgesByNodeId([action({ maxAttempts: 2 }),
            { id: 'b', name: 'b', type: 'action', config: { actionType: 't' } },
            { id: 'e', name: 'e', type: 'end', config: {} }], { retry: { maxAttempts: 5 } });
        expect(badges.get('a')).toEqual({ label: '↻2', title: 'Retry: Up to 2 attempts, retried immediately' });
        expect(badges.get('b')).toEqual({ label: '↻5',
            title: 'Retry (workflow default): Up to 5 attempts, retried immediately' });
        expect(badges.has('e')).toBe(false);
    });
});
```

Append to `utils/nodeStatus.test.ts`:

```ts
    it('reports a scheduled retry for the current visit', () => {
        expect(getNodeStatusBadge({ isCurrentVisit: true, wasVisited: true, instanceStatus: 'waiting',
            pendingRetry: { attempt: 2, maxAttempts: 5, retryAt: '2026-10-21T10:00:30Z' } }))
            .toEqual({ key: 'waiting', label: 'Retry 2/5 scheduled at 2026-10-21T10:00:30Z' });
        expect(getNodeStatusBadge({ isCurrentVisit: true, wasVisited: true, instanceStatus: 'waiting',
            pendingRetry: { attempt: 2, retryAt: '2026-10-21T10:00:30Z' } }).label)
            .toBe('Retry 2 scheduled at 2026-10-21T10:00:30Z');
    });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/retryPolicy.test.ts src/utils/nodeStatus.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `utils/retryPolicy.ts`:

```ts
/** Compact canvas badge for an action node's effective retry policy. */
export interface RetryBadge {
    label: string;
    title: string;
}

/** Computes retry badges for action nodes that have an effective declared policy. */
export function retryBadgesByNodeId(nodes: WorkflowNode[], defaults?: WorkflowDefaults | null): Map<string, RetryBadge> {
    const badges = new Map<string, RetryBadge>();
    for (const node of nodes) {
        const effective = effectiveRetryPolicy(node, defaults);
        if (!effective) continue;
        const prefix = effective.source === 'workflow' ? 'Retry (workflow default): ' : 'Retry: ';
        badges.set(node.id, { label: `↻${effective.policy.maxAttempts ?? '?'}`,
            title: prefix + describeRetryPolicy(effective.policy) });
    }
    return badges;
}
```

In `utils/nodeStatus.ts`, add the optional `pendingRetry` parameter (document it in the Javadoc-style
comment) and, at the top of the `isCurrentVisit` branch, before the terminal checks:

```ts
    if (pendingRetry && instanceStatus === 'waiting') {
      const of = pendingRetry.maxAttempts ? `/${pendingRetry.maxAttempts}` : '';
      return { key: 'waiting', label: `Retry ${pendingRetry.attempt}${of} scheduled at ${pendingRetry.retryAt}` };
    }
```

In `utils/conversion.ts` `FlowNodeData`, add:

```ts
  /** Effective retry policy badge for an Action node, if any. */
  retryBadge?: RetryBadge;
```

In `ActionNode.tsx`, after the name span:

```tsx
      {nodeData.retryBadge && (
        <span className="flow-node-action-retry" title={nodeData.retryBadge.title}>{nodeData.retryBadge.label}</span>
      )}
```

In `ActionNode.css`:

```css
.flow-node-action-retry {
  margin-left: 6px;
  font-size: 0.75em;
  opacity: 0.75;
  white-space: nowrap;
}
```

In `WorkflowViewer.tsx`: compute `const retryBadges = useMemo(() => retryBadgesByNodeId(laidOutNodes,
workflow.defaults), [laidOutNodes, workflow.defaults]);`, add `retryBadge: retryBadges.get(node.id)` to the node
`data` object, and add `retryBadges` to that `useMemo`'s dependency list. In the node-detail component, add a
`workflowDefaults?: WorkflowDefaults | null` prop (pass `workflow.defaults` from the parent) and compute:

```tsx
  const effectiveRetry = effectiveRetryPolicy(node, workflowDefaults);
  const pendingRetry = isCurrentVisit && history?.retryAt
    ? { attempt: history.attempt ?? 1, maxAttempts: effectiveRetry?.policy.maxAttempts ?? undefined,
        retryAt: history.retryAt }
    : undefined;
  const statusBadge = getNodeStatusBadge({ isCurrentVisit, wasVisited, instanceStatus, pendingRetry });
```

In `WorkflowEditor.tsx`: compute `const retryBadges = useMemo(() => retryBadgesByNodeId(semanticWorkflow.nodes,
semanticWorkflow.defaults), [semanticWorkflow]);`, include `retryBadges.size` in the early-return guard
(`!retryBadges.size`), add `const retryBadge = retryBadges.get(node.id);` and `retryBadge` to both the
"needs decoration" condition and the `data` object, and add `retryBadges` to the dependency list.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Manual check**

In the dev app, confirm action nodes with a policy show `↻N` with a tooltip, in both editor and viewer.

- [ ] **Step 6: Commit**

```bash
git add ui/src
git commit -m "Show retry policies and scheduled retries on the canvas and viewer (#86)"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/user-guide/error-handling.md`, `docs/user-guide/typed-configuration.md`,
  `docs/user-guide/workflow-model.md`, `docs/user-guide/current-contracts.md`, `docs/user-guide/validation.md`,
  `docs/developer-guide/engine-errors.md`, `BACKLOG.md`

Markdown lines wrap at 110 characters (tables excepted).

- [ ] **Step 1: `error-handling.md`** — replace the "Retry limits and durability" section (and adjust "What
  RETRY repeats") with:
  - The handler decides RETRY/FAIL/TRANSITION; the effective policy (node `retry`, else `defaults.retry`)
    decides ceiling and delay. Without a policy: legacy inline retries, limit 10, not durable across async
    resumes.
  - A field table for `maxAttempts`, `delay`, `backoff`, `multiplier`, `maxDelay`, `jitter` (copy from the
    spec section 1), and the delay formula from spec section 3.
  - `attempt`/`retryAt` on the open history entry; counts survive `PENDING` and persistence.
  - Host contract with a Java example:

    ```java
    for (RetryInfo retry : engine.getPendingRetries(instance)) {
        scheduler.schedule(retry.retryAt(), () -> save(engine.retryNode(workflow, load(id), retry.nodeId())));
    }
    ```

    `retryNode` is a no-op for late or duplicate timers; `completeNode` throws for a node scheduled for retry;
    `getActionInfo` returns `null` for it.
  - The `RetryContext` handler overload, with an example that returns `fail()` for non-transient errors.
- [ ] **Step 2:** `typed-configuration.md` and `workflow-model.md` — document `config.retry`,
  `Workflow.defaults`, `NodeConfig.Action.retry()`, `Workflow.defaultRetryPolicy()`, `RetryPolicy.effective`.
- [ ] **Step 3:** `current-contracts.md` — replace the line saying hosts must schedule backoff themselves with
  the `getPendingRetries`/`retryNode` contract. `validation.md` — add the eight codes and their meanings.
  `engine-errors.md` — note the `Exceeded retry limit (N)` message where N = `maxAttempts - 1`.
- [ ] **Step 4:** `BACKLOG.md` — mark #86 done following the file's existing convention.
- [ ] **Step 5: Verify docs build if mkdocs is available**

Run: `mkdocs build --strict` (skip if `mkdocs` is not installed; note it in the PR description).

- [ ] **Step 6: Commit**

```bash
git add docs BACKLOG.md
git commit -m "Document declarative retry policies (#86)"
```

---

### Final verification

- [ ] `mvn -q test` in `engine/` — PASS.
- [ ] `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npm run build` in `ui/` — PASS.
- [ ] `git log --oneline` shows one commit per task.
