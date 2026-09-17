# Receive-Event Output Mappings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `receive-event` nodes declare optional output mappings (`{contextKey, expression}` pairs) so an incoming event's fields can be extracted/computed into named context keys instead of always flat-merging the whole event payload.

**Architecture:** Engine and UI each gain: a new EL-evaluation entry point that exposes both `event` and `context` beans and returns a raw value (not just boolean); a merge-time dispatcher that, for `receive-event` nodes with a non-empty `config.outputs`, evaluates each mapping instead of doing the existing flat/rename merge; validation for the new mapping shape; and editor (PropertiesPanel) + viewer (nodeDefinition.ts) surfacing. No mappings declared → zero behavior change (existing flat-merge / `resolveContextKeys` path is untouched and still used for action/human-task and mapping-less receive-event nodes).

**Tech Stack:** Java 21 + JUnit 5 (engine, Maven/Surefire), TypeScript + Vitest (ui).

**Spec:** `docs/superpowers/specs/2026-09-17-receive-event-output-mappings-design.md`

## Global Constraints

- No mappings declared on a `receive-event` node → behavior is byte-for-byte identical to today (flat merge of the raw event).
- When mappings are declared, only the mapped `contextKey`s are merged — raw event fields are not also flat-merged.
- Mapping expressions are evaluated with two root beans: `event` (raw incoming event payload) and `context` (the instance's pre-merge context) — exactly the beans already used for `match` expressions.
- Every engine behavior change has a mirrored UI (simulator) change, per this project's existing dual-implementation convention (see `CLAUDE.md` at the repo root and the prior `contextKey` feature).
- Follow existing code conventions exactly: engine tests live under `engine/src/test/java/io/apitomy/flow/...` mirroring `main`'s package structure and use JUnit 5 + `TestWorkflows` static imports; UI tests use `vitest` with the `node()`/`workflow()`/`edge()`/`hasProblem()` helper patterns already present in each test file.
- Run `mvn -q -o test` (from `engine/`) and `npx vitest run && npx tsc --noEmit && npm run lint` (from `ui/`) before considering any task done.

---

### Task 1: Engine — value-returning EL resolution with an `event` bean

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/engine/ConditionEvaluator.java`
- Test: `engine/src/test/java/io/apitomy/flow/engine/ConditionEvaluatorTest.java`

**Interfaces:**
- Produces: `ConditionEvaluator.resolve(String expression, Map<String, Object> context, Map<String, Object> event)` returning `Object` (null for blank/null expression, throws `ConditionEvaluationException` for invalid EL).

- [ ] **Step 1: Write the failing tests**

Add to `engine/src/test/java/io/apitomy/flow/engine/ConditionEvaluatorTest.java` (anywhere after the existing `resolve*` tests, e.g. right after `resolveInvalidExpressionThrows`):

```java
    @Test
    void resolveWithEventReturnsValueFromEvent() {
        Map<String, Object> context = Map.of("storeId", "s1");
        Map<String, Object> event = Map.of("orderId", "ord-42", "storeId", "s1");
        assertEquals("ord-42", evaluator.resolve("event.orderId", context, event));
    }

    @Test
    void resolveWithEventSupportsNestedFieldAccess() {
        Map<String, Object> event = Map.of("payload", Map.of("customer", Map.of("email", "a@b.com")));
        assertEquals("a@b.com", evaluator.resolve("event.payload.customer.email", Map.of(), event));
    }

    @Test
    void resolveWithEventCanReferenceBothContextAndEvent() {
        Map<String, Object> context = Map.of("prefix", "ORD-");
        Map<String, Object> event = Map.of("id", "42");
        assertEquals("ORD-", evaluator.resolve("context.prefix", context, event));
        assertEquals("42", evaluator.resolve("event.id", context, event));
    }

    @Test
    void resolveWithEventBlankOrNullReturnsNull() {
        Map<String, Object> event = Map.of("orderId", "ord-42");
        assertNull(evaluator.resolve(null, Map.of(), event));
        assertNull(evaluator.resolve("", Map.of(), event));
        assertNull(evaluator.resolve("   ", Map.of(), event));
    }

    @Test
    void resolveWithEventInvalidExpressionThrows() {
        Map<String, Object> event = Map.of("orderId", "ord-42");
        assertThrows(ConditionEvaluationException.class, () ->
            evaluator.resolve("this is not valid !!!", Map.of(), event));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `engine/`): `mvn -q -o test -Dtest=ConditionEvaluatorTest`
Expected: FAIL — compile error, since `resolve(String, Map, Map)` doesn't exist yet.

- [ ] **Step 3: Implement the minimal code**

In `engine/src/main/java/io/apitomy/flow/engine/ConditionEvaluator.java`, add this method right after the existing single-bean `resolve` method:

```java
    public Object resolve(String expression, Map<String, Object> context, Map<String, Object> event) {
        if (expression == null || expression.isBlank()) {
            return null;
        }
        try {
            ELProcessor processor = createProcessor();
            processor.defineBean("context", context);
            processor.defineBean("event", event);
            return processor.eval(expression);
        } catch (Exception e) {
            throw new ConditionEvaluationException(expression, e);
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `engine/`): `mvn -q -o test -Dtest=ConditionEvaluatorTest`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
cd engine
git add src/main/java/io/apitomy/flow/engine/ConditionEvaluator.java src/test/java/io/apitomy/flow/engine/ConditionEvaluatorTest.java
git commit -m "engine: add ConditionEvaluator.resolve overload with an event bean"
```

---

### Task 2: Engine — `EventOutputMapping` model + `ReceiveEventInfo` parsing

**Files:**
- Create: `engine/src/main/java/io/apitomy/flow/model/EventOutputMapping.java`
- Modify: `engine/src/main/java/io/apitomy/flow/model/ReceiveEventInfo.java`
- Modify: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java:324-343` (`getReceiveEventInfo(Workflow, WorkflowInstance, String)`)
- Test: `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineReceiveEventOutputMappingsTest.java` (new)
- Modify: `engine/src/test/java/io/apitomy/flow/TestWorkflows.java` (new helper overload)

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: `EventOutputMapping(String contextKey, String expression)` record; `ReceiveEventInfo.outputMappings()` accessor (new field); `TestWorkflows.receiveEventNode(String id, String eventType, List<String> matchExpressions, List<Map<String, Object>> outputs)`.

- [ ] **Step 1: Write the failing test**

Create `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineReceiveEventOutputMappingsTest.java`:

```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests the optional output-mapping declarations on receive-event nodes: parsing into
 * {@link ReceiveEventInfo#outputMappings()}, and (once wired in later tasks) merge-time
 * evaluation of each mapping's expression against the incoming event and context.
 */
class WorkflowEngineReceiveEventOutputMappingsTest {

    private WorkflowEngine engine() {
        return new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
    }

    @Test
    void getReceiveEventInfoParsesOutputMappings() {
        WorkflowEngine engine = engine();
        WorkflowNode receive = receiveEventNode("wait", "order.created", List.of(),
            List.of(Map.of("contextKey", "orderId", "expression", "event.payload.id")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        ReceiveEventInfo info = engine.getReceiveEventInfo(workflow, waiting);

        assertEquals(1, info.outputMappings().size());
        assertEquals("orderId", info.outputMappings().get(0).contextKey());
        assertEquals("event.payload.id", info.outputMappings().get(0).expression());
    }

    @Test
    void getReceiveEventInfoReturnsEmptyOutputMappingsWhenNoneDeclared() {
        WorkflowEngine engine = engine();
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), receiveEventNode("wait", "order.created"), endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        ReceiveEventInfo info = engine.getReceiveEventInfo(workflow, waiting);

        assertTrue(info.outputMappings().isEmpty());
    }
}
```

Add the new `TestWorkflows` helper overload. In `engine/src/test/java/io/apitomy/flow/TestWorkflows.java`, immediately after the existing `receiveEventNode(String id, String eventType, List<String> matchExpressions)` method (around line 44-47), add:

```java
    public static WorkflowNode receiveEventNode(String id, String eventType, List<String> matchExpressions,
                                                 List<Map<String, Object>> outputs) {
        return new WorkflowNode(id, NodeType.RECEIVE_EVENT, id,
            Map.of("eventType", eventType, "match", matchExpressions, "outputs", outputs), new Position(200, 0));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `engine/`): `mvn -q -o test -Dtest=WorkflowEngineReceiveEventOutputMappingsTest`
Expected: FAIL — compile error (`ReceiveEventInfo.outputMappings()` doesn't exist; the `receiveEventNode` 4-arg overload compiles fine once added, so the failure should be specifically about `outputMappings()`).

- [ ] **Step 3: Implement the minimal code**

Create `engine/src/main/java/io/apitomy/flow/model/EventOutputMapping.java`:

```java
package io.apitomy.flow.model;

/**
 * A single output mapping declared on a {@code receive-event} node: an EL {@code expression}
 * (evaluated against the {@code event} and {@code context} root beans) whose result is stored
 * under {@code contextKey} when the node's branch completes.
 *
 * @param contextKey the context key the computed value is stored under
 * @param expression the EL expression to evaluate
 */
public record EventOutputMapping(String contextKey, String expression) {}
```

Modify `engine/src/main/java/io/apitomy/flow/model/ReceiveEventInfo.java`:

```java
package io.apitomy.flow.model;

import java.util.List;

public record ReceiveEventInfo(
    String nodeId,
    String nodeName,
    String eventType,
    List<String> matchExpressions,
    List<EventOutputMapping> outputMappings
) {}
```

Modify `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java`. Find `getReceiveEventInfo(Workflow, WorkflowInstance, String)` (around line 324) and change its body's return statement plus add mapping parsing:

```java
    public ReceiveEventInfo getReceiveEventInfo(Workflow workflow, WorkflowInstance instance, String nodeId) {
        if (instance.status() != InstanceStatus.WAITING) {
            return null;
        }
        WorkflowNode node = workflow.findNodeById(nodeId).orElse(null);
        if (node == null || node.type() != NodeType.RECEIVE_EVENT) {
            return null;
        }

        String eventType = node.config().get("eventType") instanceof String et ? et : null;

        List<String> matchExpressions = List.of();
        if (node.config().get("match") instanceof List<?> matchList) {
            matchExpressions = matchList.stream()
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .toList();
        }

        List<EventOutputMapping> outputMappings = List.of();
        if (node.config().get("outputs") instanceof List<?> outputDefs) {
            outputMappings = outputDefs.stream()
                .filter(Map.class::isInstance)
                .map(o -> (Map<?, ?>) o)
                .map(o -> new EventOutputMapping(
                    o.get("contextKey") != null ? String.valueOf(o.get("contextKey")) : null,
                    o.get("expression") != null ? String.valueOf(o.get("expression")) : null
                ))
                .toList();
        }

        return new ReceiveEventInfo(node.id(), node.name(), eventType, matchExpressions, outputMappings);
    }
```

(`Map` is already imported via the file's `java.util.*` wildcard import.)

- [ ] **Step 4: Run tests to verify they pass**

Run (from `engine/`): `mvn -q -o test -Dtest=WorkflowEngineReceiveEventOutputMappingsTest`
Expected: PASS, both tests green.

Then run the full suite to catch any other callers of the now-5-arg `ReceiveEventInfo` constructor: `mvn -q -o test`
Expected: PASS. If any other test constructs `ReceiveEventInfo` directly with the old 4-arg constructor, update it to pass `List.of()` as the fifth argument.

- [ ] **Step 5: Commit**

```bash
cd engine
git add src/main/java/io/apitomy/flow/model/EventOutputMapping.java \
        src/main/java/io/apitomy/flow/model/ReceiveEventInfo.java \
        src/main/java/io/apitomy/flow/engine/WorkflowEngine.java \
        src/test/java/io/apitomy/flow/engine/WorkflowEngineReceiveEventOutputMappingsTest.java \
        src/test/java/io/apitomy/flow/TestWorkflows.java
git commit -m "engine: add EventOutputMapping model and parse it in getReceiveEventInfo"
```

---

### Task 3: Engine — merge-time dispatch (apply mappings instead of flat merge)

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java:99-131` (`completeNode`), and the `resolveContextKeys` neighborhood (around line 1077).
- Test: `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineReceiveEventOutputMappingsTest.java` (append)

**Interfaces:**
- Consumes: `EventOutputMapping` (Task 2), `ConditionEvaluator.resolve(expression, context, event)` (Task 1).
- Produces: `WorkflowEngine.resolveMergeOutput(WorkflowInstance instance, WorkflowNode node, Map<String, Object> rawOutput)` — a private helper, used only within `WorkflowEngine`. No public interface for later tasks to consume (this task is a leaf in the engine dependency graph, other than tests).

- [ ] **Step 1: Write the failing tests**

Append to `WorkflowEngineReceiveEventOutputMappingsTest.java`:

```java
    @Test
    void completingWithNoMappingsPreservesFlatMerge() {
        WorkflowEngine engine = engine();
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), receiveEventNode("wait", "order.created"), endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        WorkflowInstance completed = engine.completeNode(workflow, waiting, "wait",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("orderId", "ord-42", "storeId", "s1")));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("ord-42", completed.context().get("orderId"));
        assertEquals("s1", completed.context().get("storeId"));
    }

    @Test
    void completingWithMappingsStoresOnlyMappedContextKeys() {
        WorkflowEngine engine = engine();
        WorkflowNode receive = receiveEventNode("wait", "order.created", List.of(),
            List.of(Map.of("contextKey", "orderId", "expression", "event.payload.id")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        WorkflowInstance completed = engine.completeNode(workflow, waiting, "wait",
            new NodeResult(NodeResultStatus.COMPLETED,
                Map.of("payload", Map.of("id", "ord-42"), "storeId", "s1")));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("ord-42", completed.context().get("orderId"));
        assertNull(completed.context().get("storeId"), "unmapped raw event fields must not flat-merge");
        assertNull(completed.context().get("payload"), "unmapped raw event fields must not flat-merge");
    }

    @Test
    void mappingExpressionCanReferenceExistingContext() {
        WorkflowEngine engine = engine();
        WorkflowNode receive = receiveEventNode("wait", "order.created", List.of(),
            List.of(Map.of("contextKey", "region", "expression", "context.defaultRegion")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of("defaultRegion", "us-east"));

        WorkflowInstance completed = engine.completeNode(workflow, waiting, "wait",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("orderId", "ord-42")));

        assertEquals("us-east", completed.context().get("region"));
    }

    @Test
    void twoReceiveEventNodesOfTheSameTypeDoNotCollideWithDistinctContextKeys() {
        WorkflowEngine engine = engine();
        WorkflowNode first = receiveEventNode("first", "order.created", List.of(),
            List.of(Map.of("contextKey", "firstOrderId", "expression", "event.id")));
        WorkflowNode second = receiveEventNode("second", "order.created", List.of(),
            List.of(Map.of("contextKey", "secondOrderId", "expression", "event.id")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), first, second, endNode("end")),
            List.of(edge("e1", "start", "first"), edge("e2", "first", "second"), edge("e3", "second", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        WorkflowInstance afterFirst = engine.completeNode(workflow, waiting, "first",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("id", "A")));
        WorkflowInstance afterSecond = engine.completeNode(workflow, afterFirst, "second",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("id", "B")));

        assertEquals("A", afterSecond.context().get("firstOrderId"));
        assertEquals("B", afterSecond.context().get("secondOrderId"));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `engine/`): `mvn -q -o test -Dtest=WorkflowEngineReceiveEventOutputMappingsTest`
Expected: `completingWithNoMappingsPreservesFlatMerge` PASSes already (unchanged behavior). The other three FAIL: `completingWithMappingsStoresOnlyMappedContextKeys` and `mappingExpressionCanReferenceExistingContext` fail because context still contains the raw flat-merged fields / the mapping isn't evaluated (`orderId`/`region` come back `null`); `twoReceiveEventNodesOfTheSameTypeDoNotCollideWithDistinctContextKeys` fails similarly.

- [ ] **Step 3: Implement the minimal code**

In `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java`, find the `resolveContextKeys` method (around line 1077) and add two new private methods immediately before it:

```java
    /**
     * Resolves what should actually be merged into context for a completed node's raw output:
     * for a {@code receive-event} node with a non-empty {@code config.outputs} (output mappings),
     * evaluates each mapping's expression against the incoming event and the instance's current
     * (pre-merge) context; for every other node — including a receive-event node with no
     * mappings declared — falls through to the existing {@link #resolveContextKeys} rename logic,
     * which is a no-op when the node declares no {@code outputs} at all (preserving today's flat
     * merge for receive-event nodes with no mappings).
     *
     * @param instance  the instance being completed (its pre-merge context is available to mapping expressions)
     * @param node      the node that produced the output
     * @param rawOutput the raw output map (for receive-event, the raw event payload)
     * @return the map to actually merge into context
     */
    private Map<String, Object> resolveMergeOutput(WorkflowInstance instance, WorkflowNode node,
                                                    Map<String, Object> rawOutput) {
        if (node.type() == NodeType.RECEIVE_EVENT
            && node.config().get("outputs") instanceof List<?> outputDefs && !outputDefs.isEmpty()) {
            return applyEventOutputMappings(outputDefs, instance.context(), rawOutput == null ? Map.of() : rawOutput);
        }
        return resolveContextKeys(node, rawOutput);
    }

    /**
     * Evaluates each raw {@code {contextKey, expression}} mapping entry against the given
     * {@code event} and {@code context}, building the map of resolved values keyed by
     * {@code contextKey}. Entries missing either field are skipped (caught separately by
     * validation).
     */
    private Map<String, Object> applyEventOutputMappings(List<?> outputDefs, Map<String, Object> context,
                                                          Map<String, Object> event) {
        Map<String, Object> mapped = new HashMap<>();
        for (Object defObj : outputDefs) {
            if (defObj instanceof Map<?, ?> def) {
                Object contextKeyVal = def.get("contextKey");
                Object expressionVal = def.get("expression");
                if (contextKeyVal != null && expressionVal != null) {
                    mapped.put(String.valueOf(contextKeyVal),
                        conditionEvaluator.resolve(String.valueOf(expressionVal), context, event));
                }
            }
        }
        return mapped;
    }
```

Now find `completeNode` (around line 94-131) and switch both merge sites from `resolveContextKeys(node, ...)` to `resolveMergeOutput(instance, node, ...)`:

```java
        if (result.status() == NodeResultStatus.PENDING) {
            WorkflowInstance reparked = instance;
            if (result.output() != null && !result.output().isEmpty()) {
                reparked = reparked.toBuilder().mergeContext(resolveMergeOutput(instance, node, result.output())).build();
            }
            return reparked.toBuilder().status(InstanceStatus.WAITING).updatedOn(Instant.now()).build();
        }

        // COMPLETED — record output on the branch's history entry, merge context, then continue this branch.
        Map<String, Object> resolvedOutput = resolveMergeOutput(instance, node, result.output());
        WorkflowInstance updated = completeHistoryEntry(instance, branch.branchId(), nodeId,
            Instant.now(), resolvedOutput);
        updated = updated.toBuilder()
            .mergeContext(resolvedOutput)
            .status(InstanceStatus.RUNNING)
            .updatedOn(Instant.now())
            .build();
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `engine/`): `mvn -q -o test -Dtest=WorkflowEngineReceiveEventOutputMappingsTest`
Expected: PASS, all tests green.

Then run the full suite to make sure nothing else regressed (in particular `WorkflowEngineEventCorrelationTest` and `WorkflowEngineCompleteTest`, which exercise `completeNode`): `mvn -q -o test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd engine
git add src/main/java/io/apitomy/flow/engine/WorkflowEngine.java \
        src/test/java/io/apitomy/flow/engine/WorkflowEngineReceiveEventOutputMappingsTest.java
git commit -m "engine: evaluate receive-event output mappings at merge time"
```

---

### Task 4: Engine — validation for output mappings

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/validation/WorkflowValidator.java:324-352` (`validateSemantics`'s receive-event block), and add a new private method near `validateOutputNames` (around line 433).
- Test: `engine/src/test/java/io/apitomy/flow/validation/WorkflowValidatorTest.java`

**Interfaces:**
- Consumes: nothing new from earlier tasks (validator has its own `ConditionEvaluator` field already, `conditionEvaluator.isValid(String)`).
- Produces: four new `ValidationProblem` codes: `MISSING_OUTPUT_CONTEXT_KEY`, `MISSING_OUTPUT_EXPRESSION`, `INVALID_OUTPUT_EXPRESSION`, `DUPLICATE_OUTPUT_NAME` (reusing the existing code for the contextKey-collision case).

- [ ] **Step 1: Write the failing tests**

Add to `engine/src/test/java/io/apitomy/flow/validation/WorkflowValidatorTest.java`, right after the existing `distinctContextKeysDoNotCollide` test:

```java
    // --- Receive-event output mappings ---

    @Test
    void missingContextKeyOnEventOutputMapping() {
        WorkflowNode receive = new WorkflowNode("r", NodeType.RECEIVE_EVENT, "R",
            Map.of("eventType", "order.created",
                "outputs", List.of(Map.of("expression", "event.id"))),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "r"), edge("e2", "r", "end")));
        assertTrue(hasCode(validate(w), "MISSING_OUTPUT_CONTEXT_KEY"));
    }

    @Test
    void missingExpressionOnEventOutputMapping() {
        WorkflowNode receive = new WorkflowNode("r", NodeType.RECEIVE_EVENT, "R",
            Map.of("eventType", "order.created",
                "outputs", List.of(Map.of("contextKey", "orderId"))),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "r"), edge("e2", "r", "end")));
        assertTrue(hasCode(validate(w), "MISSING_OUTPUT_EXPRESSION"));
    }

    @Test
    void invalidExpressionOnEventOutputMapping() {
        WorkflowNode receive = new WorkflowNode("r", NodeType.RECEIVE_EVENT, "R",
            Map.of("eventType", "order.created",
                "outputs", List.of(Map.of("contextKey", "orderId", "expression", "event. .id !!!"))),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "r"), edge("e2", "r", "end")));
        assertTrue(hasCode(validate(w), "INVALID_OUTPUT_EXPRESSION"));
    }

    @Test
    void duplicateContextKeyAcrossEventOutputMappings() {
        WorkflowNode receive = new WorkflowNode("r", NodeType.RECEIVE_EVENT, "R",
            Map.of("eventType", "order.created",
                "outputs", List.of(
                    Map.of("contextKey", "orderId", "expression", "event.id"),
                    Map.of("contextKey", "orderId", "expression", "event.otherId"))),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "r"), edge("e2", "r", "end")));
        assertTrue(hasCode(validate(w), "DUPLICATE_OUTPUT_NAME"));
    }

    @Test
    void validEventOutputMappingsProduceNoOutputMappingProblems() {
        WorkflowNode receive = new WorkflowNode("r", NodeType.RECEIVE_EVENT, "R",
            Map.of("eventType", "order.created",
                "outputs", List.of(Map.of("contextKey", "orderId", "expression", "event.id"))),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "r"), edge("e2", "r", "end")));
        List<ValidationProblem> problems = validate(w);
        assertFalse(hasCode(problems, "MISSING_OUTPUT_CONTEXT_KEY"));
        assertFalse(hasCode(problems, "MISSING_OUTPUT_EXPRESSION"));
        assertFalse(hasCode(problems, "INVALID_OUTPUT_EXPRESSION"));
        assertFalse(hasCode(problems, "DUPLICATE_OUTPUT_NAME"));
    }
```

Check the top of `WorkflowValidatorTest.java` for the `hasCode` helper signature (it's used extensively already, e.g. by the `contextKey` tests) — reuse it as-is; do not redefine it.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `engine/`): `mvn -q -o test -Dtest=WorkflowValidatorTest`
Expected: FAIL — `missingContextKeyOnEventOutputMapping`, `missingExpressionOnEventOutputMapping`, `invalidExpressionOnEventOutputMapping`, and `duplicateContextKeyAcrossEventOutputMappings` all fail (no problems raised yet); `validEventOutputMappingsProduceNoOutputMappingProblems` passes trivially (no such checks exist yet, so of course none fire) — that's expected and fine, it becomes a real regression guard once Step 3 lands.

- [ ] **Step 3: Implement the minimal code**

In `engine/src/main/java/io/apitomy/flow/validation/WorkflowValidator.java`, find the receive-event block inside `validateSemantics` (around line 324-334) and add the new call:

```java
    private void validateSemantics(Workflow workflow, List<ValidationProblem> problems) {
        // Event type validation on receive-event nodes
        workflow.nodes().stream()
            .filter(n -> n.type() == NodeType.RECEIVE_EVENT)
            .forEach(node -> {
                Object eventTypeVal = node.config().get("eventType");
                if (eventTypeVal == null) {
                    problems.add(ValidationProblem.warning("MISSING_EVENT_TYPE",
                        "Receive-event node has no eventType configured", node.id()));
                } else if (!(eventTypeVal instanceof String s) || s.isBlank()) {
                    problems.add(ValidationProblem.warning("INVALID_EVENT_TYPE_VALUE",
                        "Receive-event node eventType must be a non-blank string", node.id()));
                }
                if (node.config().get("outputs") instanceof List<?> outputs && !outputs.isEmpty()) {
                    validateEventOutputMappings(outputs, node.id(), problems);
                }
            });
```

(Only the added `if (node.config().get("outputs") ...)` block is new; the rest is unchanged — this shows the full method opening for placement clarity.)

Add the new private method right after the existing `validateOutputNames` method (around line 450):

```java
    /**
     * Validates a receive-event node's output mappings: each entry must have a non-blank
     * {@code contextKey} and a non-blank, syntactically valid EL {@code expression}, and
     * {@code contextKey}s must be unique within the node (mirroring {@link #validateOutputNames}'s
     * duplicate-key check, but driven directly by {@code contextKey} since there's no separate
     * {@code name} field for these mappings).
     *
     * @param outputDefs the raw {@code config.outputs} list
     * @param nodeId     the receive-event node's id
     * @param problems   the problems list to append to
     */
    private void validateEventOutputMappings(List<?> outputDefs, String nodeId,
                                              List<ValidationProblem> problems) {
        Set<String> contextKeys = new HashSet<>();
        for (Object defObj : outputDefs) {
            if (!(defObj instanceof Map<?, ?> def)) {
                continue;
            }
            Object contextKeyVal = def.get("contextKey");
            if (contextKeyVal == null || String.valueOf(contextKeyVal).isBlank()) {
                problems.add(ValidationProblem.warning("MISSING_OUTPUT_CONTEXT_KEY",
                    "Receive-event output mapping has no contextKey", nodeId));
                continue;
            }
            String contextKey = String.valueOf(contextKeyVal);
            if (!contextKeys.add(contextKey)) {
                problems.add(ValidationProblem.warning("DUPLICATE_OUTPUT_NAME",
                    "Duplicate output context key: " + contextKey, nodeId));
            }

            Object expressionVal = def.get("expression");
            if (expressionVal == null || String.valueOf(expressionVal).isBlank()) {
                problems.add(ValidationProblem.warning("MISSING_OUTPUT_EXPRESSION",
                    "Receive-event output mapping \"" + contextKey + "\" has no EL expression", nodeId));
            } else if (!conditionEvaluator.isValid(String.valueOf(expressionVal))) {
                problems.add(ValidationProblem.error("INVALID_OUTPUT_EXPRESSION",
                    "Receive-event output mapping \"" + contextKey + "\" is not valid EL: " + expressionVal,
                    nodeId));
            }
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `engine/`): `mvn -q -o test -Dtest=WorkflowValidatorTest`
Expected: PASS, all tests green.

Then run the full suite: `mvn -q -o test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd engine
git add src/main/java/io/apitomy/flow/validation/WorkflowValidator.java \
        src/test/java/io/apitomy/flow/validation/WorkflowValidatorTest.java
git commit -m "engine: validate receive-event output mappings"
```

---

### Task 5: UI — `EventOutputMapping` type

**Files:**
- Modify: `ui/src/types/workflow.ts`

**Interfaces:**
- Produces: `export interface EventOutputMapping { contextKey: string; expression: string; }`

- [ ] **Step 1: Add the type**

In `ui/src/types/workflow.ts`, add this new interface right after the existing `ActionOutputConfig` interface:

```ts
/**
 * A single output mapping declared on a `receive-event` node: an EL `expression` (evaluated
 * against the `event` and `context` root beans) whose result is stored under `contextKey` when
 * the node's branch completes. When a receive-event node declares no mappings, its entire raw
 * event payload is flat-merged into context instead (unchanged legacy behavior).
 */
export interface EventOutputMapping {
  /** The context key the computed value is stored under. */
  contextKey: string;
  /** The EL expression to evaluate, with `event` and `context` root beans available. */
  expression: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run (from `ui/`): `npx tsc --noEmit`
Expected: no errors (this step only adds an unused-so-far exported type, which is fine in TypeScript).

- [ ] **Step 3: Commit**

```bash
cd ui
git add src/types/workflow.ts
git commit -m "ui: add EventOutputMapping type"
```

---

### Task 6: UI — merge-time dispatch in `simulate.ts`

**Files:**
- Modify: `ui/src/simulation/simulate.ts`
- Test: `ui/src/simulation/simulate.test.ts`

**Interfaces:**
- Consumes: `resolveExpression(expression, scope)` from `./elEvaluator.ts` (already exported, no changes needed there). The mapping entries are read from `node.config.outputs` as loosely-typed objects, matching how `resolveContextKeys` already reads `config.outputs` (structural/duck typing, same as the existing code — no `import` of `EventOutputMapping` is required for this implementation).
- Produces: no new exported symbols — `resumeSimulation`'s existing behavior gains the mapping dispatch internally.

- [ ] **Step 1: Write the failing tests**

Add to `ui/src/simulation/simulate.test.ts`, right after the existing `'does not shadow two same-typed action nodes...'` test (in the `describe('node lifecycle', ...)` block):

```ts
    it('preserves the flat-merge for a receive-event node with no output mappings declared', () => {
        const wf = workflow(
            [node('start', 'start'), node('recv', 'receive-event', { eventType: 'order.created' }), node('end', 'end')],
            [edge('e1', 'start', 'recv'), edge('e2', 'recv', 'end')],
        );
        let state = stepSimulation(wf, startSimulation(wf, {}));
        state = resumeSimulation(wf, state, { output: { orderId: 'ord-42', storeId: 's1' } });
        expect(state.context.orderId).toBe('ord-42');
        expect(state.context.storeId).toBe('s1');
    });

    it('evaluates a receive-event node\'s output mappings against the event, replacing the flat merge', () => {
        const wf = workflow(
            [
                node('start', 'start'),
                node('recv', 'receive-event', {
                    eventType: 'order.created',
                    outputs: [{ contextKey: 'orderId', expression: 'event.payload.id' }],
                }),
                node('end', 'end'),
            ],
            [edge('e1', 'start', 'recv'), edge('e2', 'recv', 'end')],
        );
        let state = stepSimulation(wf, startSimulation(wf, {}));
        state = resumeSimulation(wf, state, { output: { payload: { id: 'ord-42' }, storeId: 's1' } });
        expect(state.context.orderId).toBe('ord-42');
        expect(state.context.storeId).toBeUndefined();
        expect(state.context.payload).toBeUndefined();
    });

    it('lets a receive-event output mapping expression reference existing context', () => {
        const wf = workflow(
            [
                node('start', 'start'),
                node('recv', 'receive-event', {
                    eventType: 'order.created',
                    outputs: [{ contextKey: 'region', expression: 'context.defaultRegion' }],
                }),
                node('end', 'end'),
            ],
            [edge('e1', 'start', 'recv'), edge('e2', 'recv', 'end')],
        );
        let state = stepSimulation(wf, startSimulation(wf, { defaultRegion: 'us-east' }));
        state = resumeSimulation(wf, state, { output: { orderId: 'ord-42' } });
        expect(state.context.region).toBe('us-east');
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `ui/`): `npx vitest run src/simulation/simulate.test.ts`
Expected: the first new test (`preserves the flat-merge...`) PASSes already. The second and third FAIL — context still has the raw flat-merged fields, and mapped keys (`orderId`, `region`) aren't computed (they'll be `undefined` instead of the expected values).

- [ ] **Step 3: Implement the minimal code**

In `ui/src/simulation/simulate.ts`, add the `resolveExpression` import (replacing the existing import line):

```ts
import { evaluateCondition, ElEvaluationError, resolveExpression, type ElScope } from './elEvaluator.ts';
```

Then, in `resumeSimulation`, replace the single `resolveContextKeys` call with a dispatch. Find:

```ts
    const targetNode = findNode(workflow, target.nodeId);
    const output = resolveContextKeys(targetNode, mock.output ?? {});
```

Replace with:

```ts
    const targetNode = findNode(workflow, target.nodeId);
    const output = resolveMergeOutput(targetNode, state.context, mock.output ?? {});
```

Add the new `resolveMergeOutput` function immediately before the existing `resolveContextKeys` function:

```ts
/**
 * Resolves what should actually be merged into context for a node's raw mock output: for a
 * `receive-event` node with a non-empty `config.outputs` (output mappings), evaluates each
 * mapping's expression against the event and the current (pre-merge) context; for every other
 * node — including a receive-event node with no mappings declared — falls through to
 * {@link resolveContextKeys}, which is a no-op when the node declares no `outputs` at all
 * (preserving the flat merge for receive-event nodes with no mappings). Mirrors the Java engine's
 * `WorkflowEngine.resolveMergeOutput`.
 */
function resolveMergeOutput(
    node: WorkflowNode | undefined,
    context: Record<string, unknown>,
    rawOutput: Record<string, unknown>,
): Record<string, unknown> {
    const outputDefs = node?.config?.outputs;
    if (node?.type === 'receive-event' && Array.isArray(outputDefs) && outputDefs.length > 0) {
        return applyEventOutputMappings(outputDefs, context, rawOutput);
    }
    return resolveContextKeys(node, rawOutput);
}

/**
 * Evaluates each raw `{contextKey, expression}` mapping entry against the given `event` and
 * `context`, building the map of resolved values keyed by `contextKey`. Entries missing either
 * field are skipped (caught separately by validation).
 */
function applyEventOutputMappings(
    outputDefs: unknown[],
    context: Record<string, unknown>,
    event: Record<string, unknown>,
): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};
    for (const def of outputDefs) {
        if (typeof def !== 'object' || def === null) continue;
        const contextKey = (def as Record<string, unknown>).contextKey;
        const expression = (def as Record<string, unknown>).expression;
        if (typeof contextKey === 'string' && contextKey !== '' && typeof expression === 'string') {
            mapped[contextKey] = resolveExpression(expression, { context, event });
        }
    }
    return mapped;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `ui/`): `npx vitest run src/simulation/simulate.test.ts`
Expected: PASS, all tests green.

Then run the full UI suite and typecheck: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
cd ui
git add src/simulation/simulate.ts src/simulation/simulate.test.ts
git commit -m "ui: evaluate receive-event output mappings in the simulator"
```

---

### Task 7: UI — validation for output mappings

**Files:**
- Modify: `ui/src/validation/validateWorkflow.ts:271-289` (`validateSemantics`'s receive-event block)
- Test: `ui/src/validation/validateWorkflow.test.ts`

**Interfaces:**
- Consumes: `isValidCondition` (existing local private function in `validateWorkflow.ts`, used for edge-condition validation) — reused here for consistency with how this file already validates EL syntax, rather than introducing `isValidExpression` from `elEvaluator.ts` (which would be a different validation strategy for the same file).
- Produces: no exported symbols — internal validation logic only.

- [ ] **Step 1: Write the failing tests**

Add to `ui/src/validation/validateWorkflow.test.ts`, right after the existing `'no DUPLICATE_OUTPUT_NAME when contextKeys are distinct'` test:

```ts
  describe('receive-event output mappings', () => {
    it('MISSING_OUTPUT_CONTEXT_KEY when a mapping has no contextKey', () => {
      const w = workflow(
        [
          node('start', 'start'),
          node('r', 'receive-event', { eventType: 'order.created', outputs: [{ expression: 'event.id' }] }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 'r'), edge('e2', 'r', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_OUTPUT_CONTEXT_KEY')).toBe(true);
    });

    it('MISSING_OUTPUT_EXPRESSION when a mapping has no expression', () => {
      const w = workflow(
        [
          node('start', 'start'),
          node('r', 'receive-event', { eventType: 'order.created', outputs: [{ contextKey: 'orderId' }] }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 'r'), edge('e2', 'r', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'MISSING_OUTPUT_EXPRESSION')).toBe(true);
    });

    it('INVALID_OUTPUT_EXPRESSION when a mapping\'s expression is not valid EL', () => {
      const w = workflow(
        [
          node('start', 'start'),
          node('r', 'receive-event', {
            eventType: 'order.created',
            outputs: [{ contextKey: 'orderId', expression: '(((unbalanced' }],
          }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 'r'), edge('e2', 'r', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'INVALID_OUTPUT_EXPRESSION')).toBe(true);
    });

    it('DUPLICATE_OUTPUT_NAME when two mappings on the same node share a contextKey', () => {
      const w = workflow(
        [
          node('start', 'start'),
          node('r', 'receive-event', {
            eventType: 'order.created',
            outputs: [
              { contextKey: 'orderId', expression: 'event.id' },
              { contextKey: 'orderId', expression: 'event.otherId' },
            ],
          }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 'r'), edge('e2', 'r', 'end')],
      );
      expect(hasProblem(validateWorkflow(w), 'DUPLICATE_OUTPUT_NAME')).toBe(true);
    });

    it('no output-mapping problems for a valid mapping', () => {
      const w = workflow(
        [
          node('start', 'start'),
          node('r', 'receive-event', {
            eventType: 'order.created',
            outputs: [{ contextKey: 'orderId', expression: 'event.id' }],
          }),
          node('end', 'end'),
        ],
        [edge('e1', 'start', 'r'), edge('e2', 'r', 'end')],
      );
      const problems = validateWorkflow(w);
      expect(hasProblem(problems, 'MISSING_OUTPUT_CONTEXT_KEY')).toBe(false);
      expect(hasProblem(problems, 'MISSING_OUTPUT_EXPRESSION')).toBe(false);
      expect(hasProblem(problems, 'INVALID_OUTPUT_EXPRESSION')).toBe(false);
      expect(hasProblem(problems, 'DUPLICATE_OUTPUT_NAME')).toBe(false);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `ui/`): `npx vitest run src/validation/validateWorkflow.test.ts`
Expected: FAIL — the first four new tests fail (no such problems raised yet); the fifth passes trivially (same reasoning as the engine task).

- [ ] **Step 3: Implement the minimal code**

In `ui/src/validation/validateWorkflow.ts`, find the receive-event block inside `validateSemantics` (around line 272-280) and add the new call:

```ts
  // Event type validation on receive-event nodes
  for (const node of workflow.nodes.filter(n => n.type === 'receive-event')) {
    const eventTypeVal = node.config.eventType;
    if (eventTypeVal === undefined || eventTypeVal === null) {
      problems.push(problem('warning', 'MISSING_EVENT_TYPE', 'Receive-event node has no eventType configured', node.id));
    } else if (typeof eventTypeVal !== 'string' || eventTypeVal.trim() === '') {
      problems.push(problem('warning', 'INVALID_EVENT_TYPE_VALUE', 'Receive-event node eventType must be a non-blank string', node.id));
    }
    if (Array.isArray(node.config.outputs) && node.config.outputs.length > 0) {
      validateEventOutputMappings(node.config.outputs, node.id, problems);
    }
  }
```

(Only the trailing `if (Array.isArray(...))` block is new.)

Add the new function near `validateOutputNames` (right after it):

```ts
function validateEventOutputMappings(outputDefs: unknown[], nodeId: string, problems: ValidationProblem[]) {
  const contextKeys = new Set<string>();
  for (const defObj of outputDefs) {
    if (typeof defObj !== 'object' || defObj === null) continue;
    const def = defObj as Record<string, unknown>;
    const contextKeyVal = def.contextKey;
    if (contextKeyVal === undefined || contextKeyVal === null || String(contextKeyVal).trim() === '') {
      problems.push(problem('warning', 'MISSING_OUTPUT_CONTEXT_KEY',
        'Receive-event output mapping has no contextKey', nodeId));
      continue;
    }
    const contextKey = String(contextKeyVal);
    if (contextKeys.has(contextKey)) {
      problems.push(problem('warning', 'DUPLICATE_OUTPUT_NAME',
        `Duplicate output context key: ${contextKey}`, nodeId));
    }
    contextKeys.add(contextKey);

    const expressionVal = def.expression;
    if (expressionVal === undefined || expressionVal === null || String(expressionVal).trim() === '') {
      problems.push(problem('warning', 'MISSING_OUTPUT_EXPRESSION',
        `Receive-event output mapping "${contextKey}" has no EL expression`, nodeId));
    } else if (!isValidCondition(String(expressionVal))) {
      problems.push(problem('error', 'INVALID_OUTPUT_EXPRESSION',
        `Receive-event output mapping "${contextKey}" is not valid EL: ${expressionVal}`, nodeId));
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `ui/`): `npx vitest run src/validation/validateWorkflow.test.ts`
Expected: PASS, all tests green.

Then run the full suite and typecheck: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ui
git add src/validation/validateWorkflow.ts src/validation/validateWorkflow.test.ts
git commit -m "ui: validate receive-event output mappings"
```

---

### Task 8: UI — Viewer definition-view section

**Files:**
- Modify: `ui/src/utils/nodeDefinition.ts`
- Test: `ui/src/utils/nodeDefinition.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports — `getNodeDefinition` gains a receive-event branch.

- [ ] **Step 1: Write the failing tests**

Add to `ui/src/utils/nodeDefinition.test.ts`, right after the existing action-node "surfaces an action output's contextKey override" test:

```ts
  it('builds an "Output mappings" section from a receive-event node\'s config.outputs array', () => {
    const def = getNodeDefinition(node({
      type: 'receive-event',
      config: {
        eventType: 'order.created',
        outputs: [{ contextKey: 'orderId', expression: 'event.payload.id' }],
      },
    }));

    const outputs = def.sections.find(s => s.label === 'Output mappings');
    expect(outputs).toBeDefined();
    expect(outputs!.fields).toEqual([
      { label: 'orderId', badge: undefined, value: 'event.payload.id' },
    ]);
  });

  it('omits the "Output mappings" section for a receive-event node with no outputs declared', () => {
    const def = getNodeDefinition(node({
      type: 'receive-event',
      config: { eventType: 'order.created' },
    }));

    expect(def.sections.find(s => s.label === 'Output mappings')).toBeUndefined();
  });

  it('excludes outputs from the generic Config fallback for receive-event nodes', () => {
    const def = getNodeDefinition(node({
      type: 'receive-event',
      config: {
        eventType: 'order.created',
        outputs: [{ contextKey: 'orderId', expression: 'event.payload.id' }],
      },
    }));

    const config = def.sections.find(s => s.label === 'Config');
    expect(config!.fields.some(f => f.label === 'outputs')).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `ui/`): `npx vitest run src/utils/nodeDefinition.test.ts`
Expected: FAIL — receive-event nodes currently fall into the `else { sections = []; }` branch, so no "Output mappings" section exists, and `outputs` currently leaks into the generic `Config` section (since `HANDLED_CONFIG_KEYS['receive-event']` doesn't exist yet). The first and third tests fail; the second passes trivially (no section exists either way when there's nothing declared).

- [ ] **Step 3: Implement the minimal code**

In `ui/src/utils/nodeDefinition.ts`, add `'receive-event'` to `HANDLED_CONFIG_KEYS` (around line 33-37):

```ts
const HANDLED_CONFIG_KEYS: Record<string, Set<string>> = {
  start: new Set(['inputs']),
  'human-task': new Set(['description', 'inputs', 'outputs']),
  action: new Set(['actionType', 'inputs', 'outputs']),
  'receive-event': new Set(['outputs']),
};
```

(Note: `eventType`/`match` are deliberately *not* added here — they continue to show up in the generic Config section exactly as they do today; only `outputs` is newly special-cased, per the design's non-goal of not touching that display.)

Add a new section builder function, right after `actionSections`:

```ts
function receiveEventOutputsSection(config: Record<string, any>): DefinitionSection | null {
  const outputs = config.outputs;
  if (!Array.isArray(outputs) || outputs.length === 0) return null;
  return {
    label: 'Output mappings',
    fields: outputs.map((output: { contextKey?: string; expression?: string }) => ({
      label: output.contextKey ?? '(missing contextKey)',
      value: output.expression,
    })),
  };
}
```

Wire it into `getNodeDefinition` — find the `if/else` chain (around line 148-157):

```ts
  if (node.type === 'start') {
    sections = [startInputsSection(config)].filter((s): s is DefinitionSection => s !== null);
  } else if (node.type === 'human-task') {
    description = typeof config.description === 'string' && config.description ? config.description : undefined;
    sections = [mapInputsSection(config), humanTaskOutputsSection(config)]
      .filter((s): s is DefinitionSection => s !== null);
  } else if (node.type === 'action') {
    sections = actionSections(config);
  } else if (node.type === 'receive-event') {
    sections = [receiveEventOutputsSection(config)].filter((s): s is DefinitionSection => s !== null);
  } else {
    sections = [];
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `ui/`): `npx vitest run src/utils/nodeDefinition.test.ts`
Expected: PASS, all tests green.

Then run the full suite, typecheck, and lint: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ui
git add src/utils/nodeDefinition.ts src/utils/nodeDefinition.test.ts
git commit -m "ui: show receive-event output mappings in the Viewer definition view"
```

---

### Task 9: UI — PropertiesPanel editor

**Files:**
- Modify: `ui/src/components/panels/PropertiesPanel.tsx:635-692` (the `receive-event` config branch)

**Interfaces:**
- Consumes: nothing new (uses the existing `onNodeChange` prop already in scope in this component).
- Produces: no new exports — editor UI only. Not unit tested, per this project's convention (no jsdom/testing-library; verified via `tsc`/`lint`/manual review), matching how the prior `contextKey` PropertiesPanel work was handled.

- [ ] **Step 1: Implement the editor section**

In `ui/src/components/panels/PropertiesPanel.tsx`, find the `receive-event` branch (around line 635-692) and add a new "Output mappings" field after the existing "Match Expressions" field, keeping the `Event Type` and `Match Expressions` fields exactly as they are:

```tsx
        {selectedNode.data.nodeType === 'receive-event' && (
          <>
            <div className="properties-panel__field">
              <label>Event Type</label>
              <input
                type="text"
                value={(selectedNode.data.config.eventType as string) || ''}
                onChange={(e) => onNodeChange(selectedNode.id, {
                  config: { ...selectedNode.data.config, eventType: e.target.value },
                })}
              />
            </div>
            <div className="properties-panel__field">
              <label>Match Expressions (EL)</label>
              <div className="properties-panel__match-list">
                {((selectedNode.data.config.match as string[]) || []).map((expr, i) => (
                  <div key={i} className="properties-panel__match-item">
                    <input
                      type="text"
                      value={expr}
                      placeholder="e.g. event.repo == context.repo"
                      onChange={(e) => {
                        const match = [...((selectedNode.data.config.match as string[]) || [])];
                        match[i] = e.target.value;
                        onNodeChange(selectedNode.id, {
                          config: { ...selectedNode.data.config, match },
                        });
                      }}
                    />
                    <button
                      className="properties-panel__match-remove"
                      title="Remove expression"
                      onClick={() => {
                        const match = ((selectedNode.data.config.match as string[]) || []).filter((_, j) => j !== i);
                        onNodeChange(selectedNode.id, {
                          config: { ...selectedNode.data.config, match },
                        });
                      }}
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <button
                  className="properties-panel__match-add"
                  onClick={() => {
                    const match = [...((selectedNode.data.config.match as string[]) || []), ''];
                    onNodeChange(selectedNode.id, {
                      config: { ...selectedNode.data.config, match },
                    });
                  }}
                >
                  + Add expression
                </button>
              </div>
            </div>
            <div className="properties-panel__field">
              <label>Output mappings</label>
              <div className="properties-panel__inputs-list">
                {((selectedNode.data.config.outputs as EventOutputMapping[]) || []).map((mapping, i) => (
                  <div key={i} className="properties-panel__input-item">
                    <div className="properties-panel__input-row">
                      <input
                        type="text"
                        value={mapping.contextKey ?? ''}
                        placeholder="Context key"
                        onChange={(e) => {
                          const outputs = [...((selectedNode.data.config.outputs as EventOutputMapping[]) || [])];
                          outputs[i] = { ...outputs[i], contextKey: e.target.value };
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, outputs },
                          });
                        }}
                      />
                      <input
                        type="text"
                        value={mapping.expression ?? ''}
                        placeholder="e.g. event.payload.id"
                        onChange={(e) => {
                          const outputs = [...((selectedNode.data.config.outputs as EventOutputMapping[]) || [])];
                          outputs[i] = { ...outputs[i], expression: e.target.value };
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, outputs },
                          });
                        }}
                      />
                      <button
                        className="properties-panel__match-remove"
                        title="Remove output mapping"
                        onClick={() => {
                          const outputs = ((selectedNode.data.config.outputs as EventOutputMapping[]) || [])
                            .filter((_, j) => j !== i);
                          onNodeChange(selectedNode.id, {
                            config: { ...selectedNode.data.config, outputs },
                          });
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="properties-panel__match-add"
                  onClick={() => {
                    const outputs = [
                      ...((selectedNode.data.config.outputs as EventOutputMapping[]) || []),
                      { contextKey: '', expression: '' },
                    ];
                    onNodeChange(selectedNode.id, {
                      config: { ...selectedNode.data.config, outputs },
                    });
                  }}
                >
                  + Add output mapping
                </button>
              </div>
            </div>
          </>
        )}
```

Add the `EventOutputMapping` import at the top of the file (replacing the existing type-import line for `workflow.ts`):

```tsx
import { type HumanTaskOutput, type OutputOption, type OutputWidget, type ActionOutputConfig, type EventOutputMapping } from '../../types/workflow.ts';
```

- [ ] **Step 2: Verify it compiles and lints**

Run (from `ui/`): `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run (from `ui/`): `npm run dev`, open the editor, add a `receive-event` node, and confirm:
- The existing "Event Type" and "Match Expressions" fields still work unchanged.
- A new "Output mappings" field appears with "+ Add output mapping".
- Adding a mapping shows two text inputs (context key, expression) and a remove button; edits persist in the node's config.

- [ ] **Step 4: Commit**

```bash
cd ui
git add src/components/panels/PropertiesPanel.tsx
git commit -m "ui: add output-mappings editor for receive-event nodes"
```

---

### Task 10: Full verification and PR

**Files:** none (verification only).

- [ ] **Step 1: Run the full engine suite**

Run (from `engine/`): `mvn -q -o test`
Expected: PASS, no failures.

- [ ] **Step 2: Run the full UI suite, typecheck, and lint**

Run (from `ui/`): `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS, no errors or warnings.

- [ ] **Step 3: Review the full diff**

Run (from repo root): `git log --oneline main..HEAD` and `git diff main...HEAD --stat`
Confirm every file touched matches the spec's scope (engine model/engine/validation classes + tests; UI types/simulate/validateWorkflow/nodeDefinition/PropertiesPanel + tests) and nothing unrelated slipped in.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feature/receive-event-output-mappings
gh pr create --base main --head feature/receive-event-output-mappings \
  --title "Add optional output mappings to receive-event nodes" \
  --body "Implements docs/superpowers/specs/2026-09-17-receive-event-output-mappings-design.md: receive-event nodes can now declare optional {contextKey, expression} output mappings, evaluated against the event and context, replacing the default flat-merge of the whole event payload. No mappings declared -> unchanged behavior. Engine + UI (simulator/validator/editor/viewer) implemented in parallel per this repo's existing dual-implementation convention. Diff viewer requires no changes (confirmed during design)."
```
</content>
