# Apitomy Flow Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stateless, pure Java workflow engine library that executes directed-graph workflows with conditional edge routing, an extensible NodeExecutor SPI, event listeners, error handling, and definition validation.

**Architecture:** A single Maven module (`engine/`) containing plain Java classes — no CDI, no Quarkus, no JPA. The engine takes workflow state in and returns updated state out (immutable). All dependencies (executors, listeners, error handler) are passed via constructor. Jakarta EL evaluates edge conditions and event match expressions.

**Tech Stack:** Java 25, Maven, Jackson (JSON serialization), Jakarta EL / Expressly (condition evaluation), SLF4J (logging), JUnit 5 (testing)

**Spec:** `docs/superpowers/specs/2026-08-17-apitomy-flow-design.md`

## Global Constraints

- **Java:** 25 (`maven.compiler.release=25`)
- **GroupId:** `io.apitomy`, **ArtifactId:** `apitomy-flow-engine`
- **Package root:** `io.apitomy.flow`
- **No framework dependencies:** No Quarkus, CDI, JPA, Spring, or other frameworks
- **Immutability:** All engine methods return new `WorkflowInstance` objects — input is never mutated
- **All methods synchronous:** Engine blocks on `NodeExecutor` calls; consumer threads for async
- **JSON field names:** Use kebab-case for enum serialization to match TypeScript types (e.g. `human-task`, not `HUMAN_TASK`)

---

## File Map

```
engine/
  pom.xml
  src/main/java/io/apitomy/flow/
    model/
      Workflow.java              — workflow definition (record + helper methods)
      WorkflowNode.java          — node in the graph (record)
      WorkflowEdge.java          — edge between nodes (record)
      NodeType.java              — enum: START, END, ACTION, HUMAN_TASK, RECEIVE_EVENT
      Position.java              — x/y coordinates (record)
      WorkflowInstance.java      — runtime state (record + Builder)
      InstanceStatus.java        — enum: RUNNING, WAITING, COMPLETED, FAILED, CANCELLED
      HistoryEntry.java          — visited node record (record)
    spi/
      NodeExecutor.java          — SPI interface for action execution
      NodeExecutionContext.java  — context passed to executors (record)
      NodeResult.java            — executor return value (record)
      NodeResultStatus.java      — enum: COMPLETED, FAILED
      WorkflowEventListener.java — listener interface for engine events
      WorkflowErrorHandler.java  — error handler interface
      ErrorResolution.java       — error handler return value (record)
      ErrorAction.java           — enum: FAIL, RETRY, TRANSITION
    engine/
      WorkflowEngine.java        — core engine: start, complete, cancel, matchesEvent
      ConditionEvaluator.java    — Jakarta EL wrapper
      DefaultErrorHandler.java   — default error handler (always FAIL)
    validation/
      WorkflowValidator.java     — definition validator (24 rules)
      ValidationProblem.java     — single validation finding (record)
      ValidationSeverity.java    — enum: ERROR, WARNING
  src/test/java/io/apitomy/flow/
    model/
      WorkflowSerializationTest.java
    engine/
      ConditionEvaluatorTest.java
      WorkflowEngineStartTest.java
      WorkflowEngineCompleteTest.java
      WorkflowEngineErrorTest.java
      WorkflowEngineEventCorrelationTest.java
    validation/
      WorkflowValidatorTest.java
    TestWorkflows.java           — helper methods for building test workflows
```

---

### Task 1: Project Scaffolding + Core Types

**Files:**
- Create: `engine/pom.xml`
- Create: `engine/src/main/java/io/apitomy/flow/model/Workflow.java`
- Create: `engine/src/main/java/io/apitomy/flow/model/WorkflowNode.java`
- Create: `engine/src/main/java/io/apitomy/flow/model/WorkflowEdge.java`
- Create: `engine/src/main/java/io/apitomy/flow/model/NodeType.java`
- Create: `engine/src/main/java/io/apitomy/flow/model/Position.java`
- Create: `engine/src/main/java/io/apitomy/flow/model/WorkflowInstance.java`
- Create: `engine/src/main/java/io/apitomy/flow/model/InstanceStatus.java`
- Create: `engine/src/main/java/io/apitomy/flow/model/HistoryEntry.java`
- Create: `engine/src/main/java/io/apitomy/flow/spi/NodeExecutor.java`
- Create: `engine/src/main/java/io/apitomy/flow/spi/NodeExecutionContext.java`
- Create: `engine/src/main/java/io/apitomy/flow/spi/NodeResult.java`
- Create: `engine/src/main/java/io/apitomy/flow/spi/NodeResultStatus.java`
- Create: `engine/src/main/java/io/apitomy/flow/spi/WorkflowEventListener.java`
- Create: `engine/src/main/java/io/apitomy/flow/spi/WorkflowErrorHandler.java`
- Create: `engine/src/main/java/io/apitomy/flow/spi/ErrorResolution.java`
- Create: `engine/src/main/java/io/apitomy/flow/spi/ErrorAction.java`
- Create: `engine/src/main/java/io/apitomy/flow/validation/ValidationProblem.java`
- Create: `engine/src/main/java/io/apitomy/flow/validation/ValidationSeverity.java`
- Create: `engine/src/test/java/io/apitomy/flow/TestWorkflows.java`
- Create: `engine/src/test/java/io/apitomy/flow/model/WorkflowSerializationTest.java`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: All model types and SPI interfaces used by every subsequent task

- [ ] **Step 1: Create pom.xml**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>io.apitomy</groupId>
    <artifactId>apitomy-flow-engine</artifactId>
    <version>1.0.0-SNAPSHOT</version>
    <packaging>jar</packaging>

    <name>Apitomy Flow Engine</name>
    <description>Lightweight, stateless workflow engine library</description>

    <properties>
        <maven.compiler.release>25</maven.compiler.release>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <jackson.version>2.18.2</jackson.version>
        <jakarta.el-api.version>6.0.1</jakarta.el-api.version>
        <expressly.version>6.0.0</expressly.version>
        <slf4j.version>2.0.17</slf4j.version>
        <junit.version>5.11.4</junit.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
            <version>${jackson.version}</version>
        </dependency>
        <dependency>
            <groupId>com.fasterxml.jackson.datatype</groupId>
            <artifactId>jackson-datatype-jsr310</artifactId>
            <version>${jackson.version}</version>
        </dependency>
        <dependency>
            <groupId>jakarta.el</groupId>
            <artifactId>jakarta.el-api</artifactId>
            <version>${jakarta.el-api.version}</version>
        </dependency>
        <dependency>
            <groupId>org.glassfish.expressly</groupId>
            <artifactId>expressly</artifactId>
            <version>${expressly.version}</version>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-api</artifactId>
            <version>${slf4j.version}</version>
        </dependency>

        <!-- Test -->
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>${junit.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.slf4j</groupId>
            <artifactId>slf4j-simple</artifactId>
            <version>${slf4j.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.14.0</version>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.5.2</version>
            </plugin>
        </plugins>
    </build>
</project>
```

- [ ] **Step 2: Create enum types**

`NodeType.java`:
```java
package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum NodeType {
    @JsonProperty("start") START,
    @JsonProperty("end") END,
    @JsonProperty("action") ACTION,
    @JsonProperty("human-task") HUMAN_TASK,
    @JsonProperty("receive-event") RECEIVE_EVENT
}
```

`InstanceStatus.java`:
```java
package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum InstanceStatus {
    @JsonProperty("running") RUNNING,
    @JsonProperty("waiting") WAITING,
    @JsonProperty("completed") COMPLETED,
    @JsonProperty("failed") FAILED,
    @JsonProperty("cancelled") CANCELLED
}
```

`NodeResultStatus.java`:
```java
package io.apitomy.flow.spi;

public enum NodeResultStatus {
    COMPLETED, FAILED
}
```

`ErrorAction.java`:
```java
package io.apitomy.flow.spi;

public enum ErrorAction {
    FAIL, RETRY, TRANSITION
}
```

`ValidationSeverity.java`:
```java
package io.apitomy.flow.validation;

public enum ValidationSeverity {
    ERROR, WARNING
}
```

- [ ] **Step 3: Create model records**

`Position.java`:
```java
package io.apitomy.flow.model;

public record Position(double x, double y) {}
```

`WorkflowNode.java`:
```java
package io.apitomy.flow.model;

import java.util.Map;

public record WorkflowNode(
    String id,
    NodeType type,
    String name,
    Map<String, Object> config,
    Position position
) {}
```

`WorkflowEdge.java`:
```java
package io.apitomy.flow.model;

public record WorkflowEdge(
    String id,
    String source,
    String target,
    String condition,
    int priority,
    boolean isDefault,
    String label
) {}
```

`HistoryEntry.java`:
```java
package io.apitomy.flow.model;

import java.time.Instant;
import java.util.Map;

public record HistoryEntry(
    String nodeId,
    String nodeName,
    String edgeId,
    String edgeCondition,
    Instant enteredOn,
    Instant completedOn,
    Map<String, Object> output
) {}
```

- [ ] **Step 4: Create Workflow record with helper methods**

```java
package io.apitomy.flow.model;

import java.util.Comparator;
import java.util.List;

public record Workflow(
    String id,
    String name,
    String description,
    List<WorkflowNode> nodes,
    List<WorkflowEdge> edges
) {
    public WorkflowNode findNodeById(String nodeId) {
        return nodes.stream()
            .filter(n -> n.id().equals(nodeId))
            .findFirst()
            .orElse(null);
    }

    public WorkflowNode findStartNode() {
        return nodes.stream()
            .filter(n -> n.type() == NodeType.START)
            .findFirst()
            .orElse(null);
    }

    public List<WorkflowEdge> getOutgoingEdges(String nodeId) {
        return edges.stream()
            .filter(e -> e.source().equals(nodeId))
            .sorted(Comparator.comparingInt(WorkflowEdge::priority))
            .toList();
    }

    public List<WorkflowEdge> getIncomingEdges(String nodeId) {
        return edges.stream()
            .filter(e -> e.target().equals(nodeId))
            .toList();
    }
}
```

- [ ] **Step 5: Create WorkflowInstance record with Builder**

```java
package io.apitomy.flow.model;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public record WorkflowInstance(
    String id,
    String workflowId,
    String currentNodeId,
    InstanceStatus status,
    Map<String, Object> context,
    List<HistoryEntry> history,
    String failureReason,
    Instant createdOn,
    Instant updatedOn
) {
    public static Builder builder() {
        return new Builder();
    }

    public Builder toBuilder() {
        return new Builder()
            .id(id).workflowId(workflowId).currentNodeId(currentNodeId)
            .status(status).context(new HashMap<>(context))
            .history(new ArrayList<>(history)).failureReason(failureReason)
            .createdOn(createdOn).updatedOn(updatedOn);
    }

    public static class Builder {
        private String id;
        private String workflowId;
        private String currentNodeId;
        private InstanceStatus status;
        private Map<String, Object> context = new HashMap<>();
        private List<HistoryEntry> history = new ArrayList<>();
        private String failureReason;
        private Instant createdOn;
        private Instant updatedOn;

        public Builder id(String id) { this.id = id; return this; }
        public Builder workflowId(String workflowId) { this.workflowId = workflowId; return this; }
        public Builder currentNodeId(String currentNodeId) { this.currentNodeId = currentNodeId; return this; }
        public Builder status(InstanceStatus status) { this.status = status; return this; }
        public Builder context(Map<String, Object> context) { this.context = context; return this; }
        public Builder history(List<HistoryEntry> history) { this.history = history; return this; }
        public Builder failureReason(String failureReason) { this.failureReason = failureReason; return this; }
        public Builder createdOn(Instant createdOn) { this.createdOn = createdOn; return this; }
        public Builder updatedOn(Instant updatedOn) { this.updatedOn = updatedOn; return this; }

        public Builder addHistory(HistoryEntry entry) {
            this.history.add(entry);
            return this;
        }

        public Builder mergeContext(Map<String, Object> output) {
            if (output != null) this.context.putAll(output);
            return this;
        }

        public WorkflowInstance build() {
            return new WorkflowInstance(id, workflowId, currentNodeId, status,
                Map.copyOf(context), List.copyOf(history), failureReason, createdOn, updatedOn);
        }
    }
}
```

- [ ] **Step 6: Create SPI interfaces and records**

`NodeExecutionContext.java`:
```java
package io.apitomy.flow.spi;

import io.apitomy.flow.model.WorkflowNode;
import java.util.Map;

public record NodeExecutionContext(
    WorkflowNode node,
    Map<String, Object> workflowContext,
    Map<String, Object> nodeConfig
) {}
```

`NodeResult.java`:
```java
package io.apitomy.flow.spi;

import java.util.Map;

public record NodeResult(
    NodeResultStatus status,
    Map<String, Object> output
) {}
```

`ErrorResolution.java`:
```java
package io.apitomy.flow.spi;

public record ErrorResolution(
    ErrorAction action,
    String targetNodeId
) {
    public static ErrorResolution fail() {
        return new ErrorResolution(ErrorAction.FAIL, null);
    }

    public static ErrorResolution retry() {
        return new ErrorResolution(ErrorAction.RETRY, null);
    }

    public static ErrorResolution transitionTo(String nodeId) {
        return new ErrorResolution(ErrorAction.TRANSITION, nodeId);
    }
}
```

`NodeExecutor.java`:
```java
package io.apitomy.flow.spi;

public interface NodeExecutor {
    String actionType();
    NodeResult execute(NodeExecutionContext context);
}
```

`WorkflowEventListener.java`:
```java
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
```

`WorkflowErrorHandler.java`:
```java
package io.apitomy.flow.spi;

import io.apitomy.flow.model.WorkflowInstance;
import io.apitomy.flow.model.WorkflowNode;

public interface WorkflowErrorHandler {
    ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node, NodeResult result, Exception error);
    ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node);
}
```

`ValidationProblem.java`:
```java
package io.apitomy.flow.validation;

public record ValidationProblem(
    ValidationSeverity severity,
    String code,
    String message,
    String nodeId,
    String edgeId
) {
    public static ValidationProblem error(String code, String message) {
        return new ValidationProblem(ValidationSeverity.ERROR, code, message, null, null);
    }

    public static ValidationProblem error(String code, String message, String nodeId) {
        return new ValidationProblem(ValidationSeverity.ERROR, code, message, nodeId, null);
    }

    public static ValidationProblem warning(String code, String message, String nodeId) {
        return new ValidationProblem(ValidationSeverity.WARNING, code, message, nodeId, null);
    }

    public static ValidationProblem edgeError(String code, String message, String edgeId) {
        return new ValidationProblem(ValidationSeverity.ERROR, code, message, null, edgeId);
    }

    public static ValidationProblem edgeWarning(String code, String message, String edgeId) {
        return new ValidationProblem(ValidationSeverity.WARNING, code, message, null, edgeId);
    }
}
```

- [ ] **Step 7: Create test helper**

`TestWorkflows.java`:
```java
package io.apitomy.flow;

import io.apitomy.flow.model.*;
import java.util.List;
import java.util.Map;

public class TestWorkflows {

    public static WorkflowNode startNode(String id) {
        return new WorkflowNode(id, NodeType.START, "Start", Map.of(), new Position(0, 0));
    }

    public static WorkflowNode startNode(String id, List<Map<String, Object>> inputs) {
        return new WorkflowNode(id, NodeType.START, "Start", Map.of("inputs", inputs), new Position(0, 0));
    }

    public static WorkflowNode actionNode(String id, String actionType) {
        return new WorkflowNode(id, NodeType.ACTION, id, Map.of("actionType", actionType), new Position(100, 0));
    }

    public static WorkflowNode humanTaskNode(String id) {
        return new WorkflowNode(id, NodeType.HUMAN_TASK, id, Map.of(), new Position(200, 0));
    }

    public static WorkflowNode receiveEventNode(String id, String eventType) {
        return new WorkflowNode(id, NodeType.RECEIVE_EVENT, id,
            Map.of("eventType", eventType), new Position(200, 0));
    }

    public static WorkflowNode receiveEventNode(String id, String eventType, List<String> matchExpressions) {
        return new WorkflowNode(id, NodeType.RECEIVE_EVENT, id,
            Map.of("eventType", eventType, "match", matchExpressions), new Position(200, 0));
    }

    public static WorkflowNode endNode(String id) {
        return new WorkflowNode(id, NodeType.END, "End", Map.of(), new Position(300, 0));
    }

    public static WorkflowEdge edge(String id, String source, String target) {
        return new WorkflowEdge(id, source, target, null, 0, false, null);
    }

    public static WorkflowEdge edge(String id, String source, String target, String condition, int priority) {
        return new WorkflowEdge(id, source, target, condition, priority, false, null);
    }

    public static WorkflowEdge defaultEdge(String id, String source, String target) {
        return new WorkflowEdge(id, source, target, null, Integer.MAX_VALUE, true, null);
    }

    public static Map<String, Object> inputDef(String name, String type, boolean required) {
        return Map.of("name", name, "type", type, "required", required);
    }

    /** Start → Action → End */
    public static Workflow simpleActionWorkflow(String actionType) {
        return new Workflow("wf-1", "Simple", null,
            List.of(startNode("start"), actionNode("action", actionType), endNode("end")),
            List.of(edge("e1", "start", "action"), edge("e2", "action", "end")));
    }

    /** Start → HumanTask → End */
    public static Workflow simpleHumanTaskWorkflow() {
        return new Workflow("wf-2", "HumanTask", null,
            List.of(startNode("start"), humanTaskNode("task"), endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "end")));
    }
}
```

- [ ] **Step 8: Write serialization tests**

```java
package io.apitomy.flow.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.apitomy.flow.TestWorkflows;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class WorkflowSerializationTest {

    private ObjectMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
    }

    @Test
    void workflowRoundTrips() throws Exception {
        Workflow workflow = TestWorkflows.simpleActionWorkflow("analyze");
        String json = mapper.writeValueAsString(workflow);
        Workflow deserialized = mapper.readValue(json, Workflow.class);
        assertEquals(workflow, deserialized);
    }

    @Test
    void nodeTypesSerializeAsKebabCase() throws Exception {
        WorkflowNode node = TestWorkflows.humanTaskNode("ht-1");
        String json = mapper.writeValueAsString(node);
        assertTrue(json.contains("\"human-task\""), "NodeType should serialize as kebab-case");
    }

    @Test
    void workflowInstanceRoundTrips() throws Exception {
        WorkflowInstance instance = WorkflowInstance.builder()
            .id("inst-1").workflowId("wf-1").currentNodeId("task-1")
            .status(InstanceStatus.WAITING)
            .context(Map.of("key", "value"))
            .history(List.of(new HistoryEntry("start", "Start", null, null, Instant.now(), Instant.now(), Map.of())))
            .createdOn(Instant.now()).updatedOn(Instant.now())
            .build();
        String json = mapper.writeValueAsString(instance);
        WorkflowInstance deserialized = mapper.readValue(json, WorkflowInstance.class);
        assertEquals(instance.id(), deserialized.id());
        assertEquals(instance.status(), deserialized.status());
        assertEquals("value", deserialized.context().get("key"));
    }

    @Test
    void instanceStatusSerializesAsLowerCase() throws Exception {
        String json = mapper.writeValueAsString(InstanceStatus.WAITING);
        assertEquals("\"waiting\"", json);
    }

    @Test
    void workflowHelperMethods() {
        Workflow workflow = TestWorkflows.simpleActionWorkflow("analyze");
        assertNotNull(workflow.findStartNode());
        assertEquals(NodeType.START, workflow.findStartNode().type());
        assertNotNull(workflow.findNodeById("action"));
        assertNull(workflow.findNodeById("nonexistent"));
        assertEquals(1, workflow.getOutgoingEdges("start").size());
        assertEquals("action", workflow.getOutgoingEdges("start").getFirst().target());
    }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd engine && mvn test -pl . -Dtest=WorkflowSerializationTest`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add engine/
git commit -m "feat: scaffold engine project with core model types and SPI interfaces"
```

---

### Task 2: ConditionEvaluator

**Files:**
- Create: `engine/src/main/java/io/apitomy/flow/engine/ConditionEvaluator.java`
- Create: `engine/src/test/java/io/apitomy/flow/engine/ConditionEvaluatorTest.java`

**Interfaces:**
- Consumes: nothing (standalone utility)
- Produces: `ConditionEvaluator.evaluate(String expression, Map<String, Object> context): boolean` and `ConditionEvaluator.evaluate(String expression, Map<String, Object> context, Map<String, Object> event): boolean` — used by `WorkflowEngine` (Task 4) and event correlation (Task 7)

- [ ] **Step 1: Write failing tests**

```java
package io.apitomy.flow.engine;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ConditionEvaluatorTest {

    private ConditionEvaluator evaluator;

    @BeforeEach
    void setUp() {
        evaluator = new ConditionEvaluator();
    }

    @Test
    void nullConditionReturnsTrue() {
        assertTrue(evaluator.evaluate(null, Map.of()));
    }

    @Test
    void emptyConditionReturnsTrue() {
        assertTrue(evaluator.evaluate("", Map.of()));
    }

    @Test
    void blankConditionReturnsTrue() {
        assertTrue(evaluator.evaluate("   ", Map.of()));
    }

    @Test
    void simpleEquality() {
        Map<String, Object> context = Map.of("status", "active");
        assertTrue(evaluator.evaluate("context.status == 'active'", context));
        assertFalse(evaluator.evaluate("context.status == 'inactive'", context));
    }

    @Test
    void nestedMapAccess() {
        Map<String, Object> context = Map.of("result", Map.of("status", "affected"));
        assertTrue(evaluator.evaluate("context.result.status == 'affected'", context));
        assertFalse(evaluator.evaluate("context.result.status == 'clean'", context));
    }

    @Test
    void numericComparison() {
        Map<String, Object> context = Map.of("score", 85);
        assertTrue(evaluator.evaluate("context.score > 80", context));
        assertFalse(evaluator.evaluate("context.score > 90", context));
    }

    @Test
    void booleanLogic() {
        Map<String, Object> context = Map.of("a", true, "b", false);
        assertTrue(evaluator.evaluate("context.a && !context.b", context));
        assertFalse(evaluator.evaluate("context.a && context.b", context));
    }

    @Test
    void nullSafeAccess() {
        Map<String, Object> context = Map.of("key", "value");
        assertFalse(evaluator.evaluate("context.missing != null", context));
    }

    @Test
    void invalidExpressionThrows() {
        assertThrows(ConditionEvaluationException.class, () ->
            evaluator.evaluate("this is not valid EL !!!", Map.of()));
    }

    @Test
    void evaluateWithContextAndEvent() {
        Map<String, Object> context = Map.of("repository", "apitomy/axiom");
        Map<String, Object> event = Map.of("repository", "apitomy/axiom", "action", "merged");
        assertTrue(evaluator.evaluate("event.repository == context.repository", context, event));
        assertTrue(evaluator.evaluate("event.action == 'merged'", context, event));
        assertFalse(evaluator.evaluate("event.action == 'closed'", context, event));
    }

    @Test
    void evaluateWithNestedEvent() {
        Map<String, Object> context = Map.of("prNumber", 42);
        Map<String, Object> event = Map.of("pull_request", Map.of("number", 42));
        assertTrue(evaluator.evaluate("event.pull_request.number == context.prNumber", context, event));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && mvn test -Dtest=ConditionEvaluatorTest`
Expected: Compilation failure — `ConditionEvaluator` and `ConditionEvaluationException` don't exist

- [ ] **Step 3: Implement ConditionEvaluator**

`ConditionEvaluationException.java` (create in `engine/src/main/java/io/apitomy/flow/engine/`):
```java
package io.apitomy.flow.engine;

public class ConditionEvaluationException extends RuntimeException {
    public ConditionEvaluationException(String expression, Throwable cause) {
        super("Failed to evaluate condition: " + expression, cause);
    }
}
```

`ConditionEvaluator.java`:
```java
package io.apitomy.flow.engine;

import jakarta.el.ELProcessor;
import java.util.Map;

public class ConditionEvaluator {

    public boolean evaluate(String expression, Map<String, Object> context) {
        if (expression == null || expression.isBlank()) {
            return true;
        }
        try {
            ELProcessor processor = new ELProcessor();
            processor.defineBean("context", context);
            Object result = processor.eval(expression);
            return Boolean.TRUE.equals(result);
        } catch (Exception e) {
            throw new ConditionEvaluationException(expression, e);
        }
    }

    public boolean evaluate(String expression, Map<String, Object> context, Map<String, Object> event) {
        if (expression == null || expression.isBlank()) {
            return true;
        }
        try {
            ELProcessor processor = new ELProcessor();
            processor.defineBean("context", context);
            processor.defineBean("event", event);
            Object result = processor.eval(expression);
            return Boolean.TRUE.equals(result);
        } catch (Exception e) {
            throw new ConditionEvaluationException(expression, e);
        }
    }

    public boolean isValid(String expression) {
        try {
            ELProcessor processor = new ELProcessor();
            processor.defineBean("context", Map.of());
            processor.getELManager().getExpressionFactory()
                .createValueExpression(processor.getELManager().getELContext(),
                    "${" + expression + "}", Object.class);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && mvn test -Dtest=ConditionEvaluatorTest`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/engine/ConditionEvaluator.java
git add engine/src/main/java/io/apitomy/flow/engine/ConditionEvaluationException.java
git add engine/src/test/java/io/apitomy/flow/engine/ConditionEvaluatorTest.java
git commit -m "feat: add ConditionEvaluator with Jakarta EL support"
```

---

### Task 3: WorkflowValidator

**Files:**
- Create: `engine/src/main/java/io/apitomy/flow/validation/WorkflowValidator.java`
- Create: `engine/src/test/java/io/apitomy/flow/validation/WorkflowValidatorTest.java`

**Interfaces:**
- Consumes: `Workflow`, `WorkflowNode`, `WorkflowEdge`, `NodeType`, `ValidationProblem`, `ValidationSeverity` from Task 1; `ConditionEvaluator.isValid(String)` from Task 2
- Produces: `WorkflowValidator.validate(Workflow): List<ValidationProblem>` — used by `WorkflowEngine.startWorkflow()` in Task 4

- [ ] **Step 1: Write failing tests**

```java
package io.apitomy.flow.validation;

import io.apitomy.flow.model.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowValidatorTest {

    private WorkflowValidator validator;

    @BeforeEach
    void setUp() {
        validator = new WorkflowValidator();
    }

    private List<ValidationProblem> validate(Workflow w) {
        return validator.validate(w);
    }

    private boolean hasCode(List<ValidationProblem> problems, String code) {
        return problems.stream().anyMatch(p -> p.code().equals(code));
    }

    // --- Structural ---

    @Test
    void noStartNode() {
        Workflow w = new Workflow("w", "W", null,
            List.of(endNode("end")), List.of());
        assertTrue(hasCode(validate(w), "NO_START_NODE"));
    }

    @Test
    void multipleStartNodes() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("s1"), startNode("s2"), endNode("end")),
            List.of(edge("e1", "s1", "end"), edge("e2", "s2", "end")));
        assertTrue(hasCode(validate(w), "MULTIPLE_START_NODES"));
    }

    @Test
    void noEndNode() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), actionNode("a", "test")),
            List.of(edge("e1", "start", "a")));
        assertTrue(hasCode(validate(w), "NO_END_NODE"));
    }

    @Test
    void invalidEdgeSource() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "nonexistent", "end")));
        assertTrue(hasCode(validate(w), "INVALID_EDGE_SOURCE"));
    }

    @Test
    void invalidEdgeTarget() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "nonexistent")));
        assertTrue(hasCode(validate(w), "INVALID_EDGE_TARGET"));
    }

    @Test
    void duplicateNodeId() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("dup"), endNode("dup")),
            List.of(edge("e1", "dup", "dup")));
        assertTrue(hasCode(validate(w), "DUPLICATE_NODE_ID"));
    }

    @Test
    void duplicateEdgeId() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("dup", "start", "end"), edge("dup", "start", "end")));
        assertTrue(hasCode(validate(w), "DUPLICATE_EDGE_ID"));
    }

    @Test
    void startHasIncoming() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), actionNode("a", "test"), endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "start"), edge("e3", "a", "end")));
        assertTrue(hasCode(validate(w), "START_HAS_INCOMING"));
    }

    @Test
    void endHasOutgoing() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), endNode("end"), actionNode("a", "test")),
            List.of(edge("e1", "start", "end"), edge("e2", "end", "a")));
        assertTrue(hasCode(validate(w), "END_HAS_OUTGOING"));
    }

    @Test
    void missingActionType() {
        WorkflowNode badAction = new WorkflowNode("a", NodeType.ACTION, "A", Map.of(), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), badAction, endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "MISSING_ACTION_TYPE"));
    }

    // --- Connectivity ---

    @Test
    void noOutgoingEdges() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), actionNode("a", "test"), endNode("end")),
            List.of(edge("e1", "start", "a")));
        assertTrue(hasCode(validate(w), "NO_OUTGOING_EDGES"));
    }

    @Test
    void disconnectedNode() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), endNode("end"), actionNode("orphan", "test")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "DISCONNECTED_NODE"));
    }

    // --- Edge/Condition ---

    @Test
    void noDefaultEdge() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), endNode("e1"), endNode("e2")),
            List.of(
                edge("edge1", "start", "e1", "context.x == 1", 1),
                edge("edge2", "start", "e2", "context.x == 2", 2)));
        // Note: also triggers DUPLICATE_NODE_ID for end nodes — use different IDs
        // Fix: use proper unique IDs
        Workflow w2 = new Workflow("w", "W", null,
            List.of(startNode("start"), actionNode("a1", "t"), actionNode("a2", "t"), endNode("end")),
            List.of(
                edge("edge1", "start", "a1", "context.x == 1", 1),
                edge("edge2", "start", "a2", "context.x == 2", 2),
                edge("edge3", "a1", "end"),
                edge("edge4", "a2", "end")));
        assertTrue(hasCode(validate(w2), "NO_DEFAULT_EDGE"));
    }

    @Test
    void multipleDefaultEdges() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), endNode("end1"), endNode("end2")),
            List.of(defaultEdge("e1", "start", "end1"), defaultEdge("e2", "start", "end2")));
        assertTrue(hasCode(validate(w), "MULTIPLE_DEFAULT_EDGES"));
    }

    // --- Semantic ---

    @Test
    void missingEventType() {
        WorkflowNode badReceive = new WorkflowNode("r", NodeType.RECEIVE_EVENT, "R", Map.of(), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), badReceive, endNode("end")),
            List.of(edge("e1", "start", "r"), edge("e2", "r", "end")));
        assertTrue(hasCode(validate(w), "MISSING_EVENT_TYPE"));
    }

    @Test
    void missingStartInputs() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "MISSING_START_INPUTS"));
    }

    // --- Valid workflow produces no errors ---

    @Test
    void validWorkflowHasNoErrors() {
        Workflow w = new Workflow("w", "W", null,
            List.of(
                startNode("start", List.of(inputDef("input1", "string", true))),
                actionNode("a", "test"),
                endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        List<ValidationProblem> errors = validate(w).stream()
            .filter(p -> p.severity() == ValidationSeverity.ERROR).toList();
        assertTrue(errors.isEmpty(), "Valid workflow should have no errors: " + errors);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && mvn test -Dtest=WorkflowValidatorTest`
Expected: Compilation failure — `WorkflowValidator` doesn't exist

- [ ] **Step 3: Implement WorkflowValidator**

```java
package io.apitomy.flow.validation;

import io.apitomy.flow.engine.ConditionEvaluator;
import io.apitomy.flow.model.*;

import java.util.*;
import java.util.stream.Collectors;

public class WorkflowValidator {

    private final ConditionEvaluator conditionEvaluator = new ConditionEvaluator();

    public List<ValidationProblem> validate(Workflow workflow) {
        List<ValidationProblem> problems = new ArrayList<>();
        validateStructure(workflow, problems);
        validateConnectivity(workflow, problems);
        validateEdgeConditions(workflow, problems);
        validateSemantics(workflow, problems);
        return problems;
    }

    public boolean hasErrors(List<ValidationProblem> problems) {
        return problems.stream().anyMatch(p -> p.severity() == ValidationSeverity.ERROR);
    }

    private void validateStructure(Workflow workflow, List<ValidationProblem> problems) {
        List<WorkflowNode> nodes = workflow.nodes();
        List<WorkflowEdge> edges = workflow.edges();
        Set<String> nodeIds = new HashSet<>();

        // Duplicate node IDs
        for (WorkflowNode node : nodes) {
            if (!nodeIds.add(node.id())) {
                problems.add(ValidationProblem.error("DUPLICATE_NODE_ID",
                    "Duplicate node ID: " + node.id(), node.id()));
            }
        }

        // Duplicate edge IDs
        Set<String> edgeIds = new HashSet<>();
        for (WorkflowEdge edge : edges) {
            if (!edgeIds.add(edge.id())) {
                problems.add(ValidationProblem.edgeError("DUPLICATE_EDGE_ID",
                    "Duplicate edge ID: " + edge.id(), edge.id()));
            }
        }

        // Start node checks
        List<WorkflowNode> startNodes = nodes.stream()
            .filter(n -> n.type() == NodeType.START).toList();
        if (startNodes.isEmpty()) {
            problems.add(ValidationProblem.error("NO_START_NODE", "No start node found"));
        } else if (startNodes.size() > 1) {
            problems.add(ValidationProblem.error("MULTIPLE_START_NODES",
                "Found " + startNodes.size() + " start nodes"));
        }

        // End node check
        boolean hasEnd = nodes.stream().anyMatch(n -> n.type() == NodeType.END);
        if (!hasEnd) {
            problems.add(ValidationProblem.error("NO_END_NODE", "No end node found"));
        }

        // Edge reference checks
        for (WorkflowEdge edge : edges) {
            if (!nodeIds.contains(edge.source())) {
                problems.add(ValidationProblem.edgeError("INVALID_EDGE_SOURCE",
                    "Edge " + edge.id() + " references nonexistent source: " + edge.source(), edge.id()));
            }
            if (!nodeIds.contains(edge.target())) {
                problems.add(ValidationProblem.edgeError("INVALID_EDGE_TARGET",
                    "Edge " + edge.id() + " references nonexistent target: " + edge.target(), edge.id()));
            }
        }

        // Start must not have incoming edges
        for (WorkflowNode start : startNodes) {
            boolean hasIncoming = edges.stream().anyMatch(e -> e.target().equals(start.id()));
            if (hasIncoming) {
                problems.add(ValidationProblem.error("START_HAS_INCOMING",
                    "Start node must not have incoming edges", start.id()));
            }
        }

        // End must not have outgoing edges
        nodes.stream().filter(n -> n.type() == NodeType.END).forEach(end -> {
            boolean hasOutgoing = edges.stream().anyMatch(e -> e.source().equals(end.id()));
            if (hasOutgoing) {
                problems.add(ValidationProblem.error("END_HAS_OUTGOING",
                    "End node must not have outgoing edges", end.id()));
            }
        });

        // Action nodes must have actionType
        nodes.stream().filter(n -> n.type() == NodeType.ACTION).forEach(action -> {
            if (!action.config().containsKey("actionType")) {
                problems.add(ValidationProblem.error("MISSING_ACTION_TYPE",
                    "Action node missing actionType in config", action.id()));
            }
        });
    }

    private void validateConnectivity(Workflow workflow, List<ValidationProblem> problems) {
        List<WorkflowNode> nodes = workflow.nodes();
        List<WorkflowEdge> edges = workflow.edges();

        for (WorkflowNode node : nodes) {
            List<WorkflowEdge> incoming = workflow.getIncomingEdges(node.id());
            List<WorkflowEdge> outgoing = workflow.getOutgoingEdges(node.id());

            // Disconnected node (no incoming AND no outgoing, except start)
            if (node.type() != NodeType.START && incoming.isEmpty() && outgoing.isEmpty()) {
                problems.add(ValidationProblem.error("DISCONNECTED_NODE",
                    "Node is completely disconnected", node.id()));
                continue;
            }

            // No outgoing edges (except end)
            if (node.type() != NodeType.END && outgoing.isEmpty()) {
                problems.add(ValidationProblem.error("NO_OUTGOING_EDGES",
                    "Non-end node has no outgoing edges", node.id()));
            }

            // No incoming edges (except start)
            if (node.type() != NodeType.START && incoming.isEmpty()) {
                problems.add(ValidationProblem.warning("NO_INCOMING_EDGES",
                    "Node has no incoming edges — unreachable", node.id()));
            }
        }

        // Unreachable from start (BFS)
        WorkflowNode startNode = workflow.findStartNode();
        if (startNode != null) {
            Set<String> reachable = new HashSet<>();
            Queue<String> queue = new LinkedList<>();
            queue.add(startNode.id());
            while (!queue.isEmpty()) {
                String current = queue.poll();
                if (reachable.add(current)) {
                    edges.stream().filter(e -> e.source().equals(current))
                        .map(WorkflowEdge::target).forEach(queue::add);
                }
            }
            for (WorkflowNode node : nodes) {
                if (!reachable.contains(node.id()) && node.type() != NodeType.START) {
                    problems.add(ValidationProblem.warning("UNREACHABLE_NODE",
                        "Node cannot be reached from start", node.id()));
                }
            }

            // No path to end (reverse BFS from all end nodes)
            Set<String> canReachEnd = new HashSet<>();
            Queue<String> reverseQueue = new LinkedList<>();
            nodes.stream().filter(n -> n.type() == NodeType.END)
                .map(WorkflowNode::id).forEach(id -> { reverseQueue.add(id); canReachEnd.add(id); });
            while (!reverseQueue.isEmpty()) {
                String current = reverseQueue.poll();
                edges.stream().filter(e -> e.target().equals(current))
                    .map(WorkflowEdge::source)
                    .filter(canReachEnd::add)
                    .forEach(reverseQueue::add);
            }
            for (WorkflowNode node : nodes) {
                if (reachable.contains(node.id()) && !canReachEnd.contains(node.id())
                        && node.type() != NodeType.END) {
                    problems.add(ValidationProblem.warning("NO_PATH_TO_END",
                        "Node has no path to any end node", node.id()));
                }
            }
        }
    }

    private void validateEdgeConditions(Workflow workflow, List<ValidationProblem> problems) {
        Map<String, List<WorkflowEdge>> edgesBySource = workflow.edges().stream()
            .collect(Collectors.groupingBy(WorkflowEdge::source));

        for (var entry : edgesBySource.entrySet()) {
            List<WorkflowEdge> outgoing = entry.getValue();
            if (outgoing.size() <= 1) continue;

            // Multiple default edges
            List<WorkflowEdge> defaults = outgoing.stream().filter(WorkflowEdge::isDefault).toList();
            if (defaults.size() > 1) {
                problems.add(ValidationProblem.warning("MULTIPLE_DEFAULT_EDGES",
                    "Node has multiple default edges", entry.getKey()));
            }

            // No default edge when there are conditional edges
            boolean hasConditional = outgoing.stream()
                .anyMatch(e -> e.condition() != null && !e.condition().isBlank());
            if (hasConditional && defaults.isEmpty()) {
                problems.add(ValidationProblem.warning("NO_DEFAULT_EDGE",
                    "Node has conditional edges but no default fallback", entry.getKey()));
            }

            // No conditions at all on multiple edges
            boolean allUnconditional = outgoing.stream()
                .allMatch(e -> e.condition() == null || e.condition().isBlank());
            if (allUnconditional && defaults.isEmpty()) {
                problems.add(ValidationProblem.warning("UNCONDITIONAL_MULTIPLE_EDGES",
                    "Node has multiple outgoing edges with no conditions", entry.getKey()));
            }

            // Duplicate priorities
            Map<Integer, Long> priorityCounts = outgoing.stream()
                .collect(Collectors.groupingBy(WorkflowEdge::priority, Collectors.counting()));
            priorityCounts.entrySet().stream().filter(e -> e.getValue() > 1).forEach(e ->
                problems.add(ValidationProblem.edgeWarning("DUPLICATE_EDGE_PRIORITY",
                    "Multiple edges from node " + entry.getKey() + " share priority " + e.getKey(),
                    entry.getKey())));
        }

        // Invalid EL conditions
        for (WorkflowEdge edge : workflow.edges()) {
            if (edge.condition() != null && !edge.condition().isBlank()) {
                if (!conditionEvaluator.isValid(edge.condition())) {
                    problems.add(ValidationProblem.edgeWarning("INVALID_CONDITION",
                        "Edge condition is not valid EL: " + edge.condition(), edge.id()));
                }
            }
        }
    }

    private void validateSemantics(Workflow workflow, List<ValidationProblem> problems) {
        // Missing event type on receive-event nodes
        workflow.nodes().stream()
            .filter(n -> n.type() == NodeType.RECEIVE_EVENT)
            .forEach(node -> {
                if (!node.config().containsKey("eventType")) {
                    problems.add(ValidationProblem.warning("MISSING_EVENT_TYPE",
                        "Receive-event node has no eventType configured", node.id()));
                }
            });

        // Duplicate event receivers
        List<WorkflowNode> receivers = workflow.nodes().stream()
            .filter(n -> n.type() == NodeType.RECEIVE_EVENT)
            .filter(n -> n.config().containsKey("eventType"))
            .toList();
        for (int i = 0; i < receivers.size(); i++) {
            for (int j = i + 1; j < receivers.size(); j++) {
                if (hasSameEventConfig(receivers.get(i), receivers.get(j))) {
                    problems.add(ValidationProblem.warning("DUPLICATE_EVENT_RECEIVER",
                        "Multiple receive-event nodes match the same events",
                        receivers.get(j).id()));
                }
            }
        }

        // Missing start inputs
        WorkflowNode start = workflow.findStartNode();
        if (start != null && !start.config().containsKey("inputs")) {
            problems.add(ValidationProblem.warning("MISSING_START_INPUTS",
                "Start node has no inputs defined", start.id()));
        }

        // Automated cycles (cycles with only action nodes)
        detectAutomatedCycles(workflow, problems);
    }

    private boolean hasSameEventConfig(WorkflowNode a, WorkflowNode b) {
        Object typeA = a.config().get("eventType");
        Object typeB = b.config().get("eventType");
        if (!Objects.equals(typeA, typeB)) return false;
        Object matchA = a.config().get("match");
        Object matchB = b.config().get("match");
        return Objects.equals(matchA, matchB);
    }

    private void detectAutomatedCycles(Workflow workflow, List<ValidationProblem> problems) {
        // Find cycles using DFS, then check if any cycle contains only action nodes
        Set<String> actionNodeIds = workflow.nodes().stream()
            .filter(n -> n.type() == NodeType.ACTION)
            .map(WorkflowNode::id).collect(Collectors.toSet());

        Set<String> visited = new HashSet<>();
        Set<String> inStack = new HashSet<>();

        for (WorkflowNode node : workflow.nodes()) {
            if (node.type() == NodeType.ACTION && !visited.contains(node.id())) {
                if (hasAutomatedCycle(workflow, node.id(), actionNodeIds, visited, inStack)) {
                    problems.add(ValidationProblem.warning("AUTOMATED_CYCLE",
                        "Cycle detected containing only action nodes", node.id()));
                    return;
                }
            }
        }
    }

    private boolean hasAutomatedCycle(Workflow workflow, String nodeId, Set<String> actionNodeIds,
                                      Set<String> visited, Set<String> inStack) {
        visited.add(nodeId);
        inStack.add(nodeId);
        for (WorkflowEdge edge : workflow.getOutgoingEdges(nodeId)) {
            String target = edge.target();
            if (!actionNodeIds.contains(target)) continue;
            if (inStack.contains(target)) return true;
            if (!visited.contains(target) && hasAutomatedCycle(workflow, target, actionNodeIds, visited, inStack)) {
                return true;
            }
        }
        inStack.remove(nodeId);
        return false;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && mvn test -Dtest=WorkflowValidatorTest`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/validation/WorkflowValidator.java
git add engine/src/test/java/io/apitomy/flow/validation/WorkflowValidatorTest.java
git commit -m "feat: add WorkflowValidator with 24 structural and semantic rules"
```

---

### Task 4: WorkflowEngine — Start + Transitions + Events

**Files:**
- Create: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java`
- Create: `engine/src/main/java/io/apitomy/flow/engine/DefaultErrorHandler.java`
- Create: `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineStartTest.java`

**Interfaces:**
- Consumes: All model types (Task 1), `ConditionEvaluator` (Task 2), `WorkflowValidator` (Task 3)
- Produces: `WorkflowEngine.startWorkflow(Workflow, Map<String, Object>): WorkflowInstance`, `WorkflowEngine.startWorkflow(Workflow, Map<String, Object>, String): WorkflowInstance` — used by Task 5

- [ ] **Step 1: Write failing tests**

```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowEngineStartTest {

    private WorkflowEngine engine(NodeExecutor... executors) {
        return new WorkflowEngine(List.of(executors), List.of(), null);
    }

    private WorkflowEngine engine(List<NodeExecutor> executors, List<WorkflowEventListener> listeners) {
        return new WorkflowEngine(executors, listeners, null);
    }

    private NodeExecutor echoExecutor(String actionType) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("executed", actionType));
            }
        };
    }

    @Test
    void startSimpleWorkflowReachesHumanTask() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.WAITING, instance.status());
        assertEquals("task", instance.currentNodeId());
        assertNotNull(instance.id());
        assertEquals("wf-2", instance.workflowId());
    }

    @Test
    void startWorkflowChainsActionNodes() {
        WorkflowEngine engine = engine(echoExecutor("step1"), echoExecutor("step2"));
        Workflow workflow = new Workflow("w", "W", null,
            List.of(startNode("start"), actionNode("a1", "step1"), actionNode("a2", "step2"), endNode("end")),
            List.of(edge("e1", "start", "a1"), edge("e2", "a1", "a2"), edge("e3", "a2", "end")));

        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, instance.status());
        assertEquals("step1", instance.context().get("executed"));
        assertTrue(instance.history().size() >= 3);
    }

    @Test
    void startWorkflowWithConditionalEdges() {
        WorkflowEngine engine = engine(echoExecutor("left"), echoExecutor("right"));
        Workflow workflow = new Workflow("w", "W", null,
            List.of(
                startNode("start", List.of(inputDef("branch", "string", true))),
                actionNode("left", "left"), actionNode("right", "right"), endNode("end")),
            List.of(
                edge("e1", "start", "left", "context.branch == 'left'", 1),
                defaultEdge("e2", "start", "right"),
                edge("e3", "left", "end"), edge("e4", "right", "end")));

        WorkflowInstance leftResult = engine.startWorkflow(workflow, Map.of("branch", "left"));
        assertEquals("left", leftResult.context().get("executed"));

        WorkflowInstance rightResult = engine.startWorkflow(workflow, Map.of("branch", "right"));
        assertEquals("right", rightResult.context().get("executed"));
    }

    @Test
    void startWorkflowValidatesDefinition() {
        WorkflowEngine engine = engine();
        Workflow invalid = new Workflow("w", "W", null,
            List.of(actionNode("orphan", "test")), List.of());
        assertThrows(Exception.class, () -> engine.startWorkflow(invalid, Map.of()));
    }

    @Test
    void startWorkflowValidatesRequiredInputs() {
        WorkflowEngine engine = engine();
        Workflow workflow = new Workflow("w", "W", null,
            List.of(
                startNode("start", List.of(inputDef("required", "string", true))),
                endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertThrows(Exception.class, () -> engine.startWorkflow(workflow, Map.of()));
    }

    @Test
    void startWorkflowWithCallerProvidedId() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of(), "my-custom-id");
        assertEquals("my-custom-id", instance.id());
    }

    @Test
    void startWorkflowFiresEvents() {
        List<String> events = new ArrayList<>();
        WorkflowEventListener listener = new WorkflowEventListener() {
            public void onWorkflowStarted(WorkflowInstance i) { events.add("started"); }
            public void onNodeEntered(WorkflowInstance i, WorkflowNode n) { events.add("entered:" + n.id()); }
            public void onNodeCompleted(WorkflowInstance i, WorkflowNode n, NodeResult r) { events.add("completed:" + n.id()); }
            public void onEdgeFollowed(WorkflowInstance i, WorkflowEdge e) { events.add("edge:" + e.id()); }
            public void onWorkflowCompleted(WorkflowInstance i) { events.add("workflow-completed"); }
        };
        WorkflowEngine engine = engine(List.of(echoExecutor("test")), List.of(listener));
        Workflow workflow = simpleActionWorkflow("test");
        engine.startWorkflow(workflow, Map.of());

        assertTrue(events.contains("started"));
        assertTrue(events.contains("entered:start"));
        assertTrue(events.contains("entered:action"));
        assertTrue(events.contains("entered:end"));
        assertTrue(events.contains("workflow-completed"));
    }

    @Test
    void safetyLimitPreventsInfiniteLoops() {
        NodeExecutor loopExecutor = new NodeExecutor() {
            public String actionType() { return "loop"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            }
        };
        WorkflowEngine engine = engine(loopExecutor);
        Workflow workflow = new Workflow("w", "W", null,
            List.of(startNode("start"), actionNode("a", "loop"), endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "a")));

        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertNotNull(result.failureReason());
        assertTrue(result.failureReason().contains("transition limit"));
    }

    @Test
    void historyRecordsEdgeInfo() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertTrue(instance.history().size() >= 2);
        HistoryEntry taskEntry = instance.history().stream()
            .filter(h -> h.nodeId().equals("task")).findFirst().orElseThrow();
        assertEquals("e1", taskEntry.edgeId());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && mvn test -Dtest=WorkflowEngineStartTest`
Expected: Compilation failure — `WorkflowEngine` doesn't exist

- [ ] **Step 3: Implement DefaultErrorHandler**

```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.WorkflowInstance;
import io.apitomy.flow.model.WorkflowNode;
import io.apitomy.flow.spi.*;

public class DefaultErrorHandler implements WorkflowErrorHandler {
    @Override
    public ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node,
                                           NodeResult result, Exception error) {
        return ErrorResolution.fail();
    }

    @Override
    public ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node) {
        return ErrorResolution.fail();
    }
}
```

- [ ] **Step 4: Implement WorkflowEngine**

```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import io.apitomy.flow.validation.ValidationProblem;
import io.apitomy.flow.validation.WorkflowValidator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.*;

public class WorkflowEngine {

    private static final Logger log = LoggerFactory.getLogger(WorkflowEngine.class);
    private static final int MAX_TRANSITIONS = 100;

    private final Map<String, NodeExecutor> executors;
    private final List<WorkflowEventListener> listeners;
    private final WorkflowErrorHandler errorHandler;
    private final WorkflowValidator validator;
    private final ConditionEvaluator conditionEvaluator;

    public WorkflowEngine(List<NodeExecutor> executors, List<WorkflowEventListener> listeners,
                          WorkflowErrorHandler errorHandler) {
        this.executors = new HashMap<>();
        for (NodeExecutor executor : executors) {
            this.executors.put(executor.actionType(), executor);
        }
        this.listeners = listeners != null ? listeners : List.of();
        this.errorHandler = errorHandler != null ? errorHandler : new DefaultErrorHandler();
        this.validator = new WorkflowValidator();
        this.conditionEvaluator = new ConditionEvaluator();
    }

    public WorkflowInstance startWorkflow(Workflow workflow, Map<String, Object> initialContext) {
        return startWorkflow(workflow, initialContext, UUID.randomUUID().toString());
    }

    public WorkflowInstance startWorkflow(Workflow workflow, Map<String, Object> initialContext,
                                          String instanceId) {
        // Validate definition
        List<ValidationProblem> problems = validator.validate(workflow);
        if (validator.hasErrors(problems)) {
            throw new WorkflowValidationException(problems);
        }

        // Find start node and validate inputs
        WorkflowNode startNode = workflow.findStartNode();
        validateInputs(startNode, initialContext);

        // Create instance
        Instant now = Instant.now();
        WorkflowInstance instance = WorkflowInstance.builder()
            .id(instanceId)
            .workflowId(workflow.id())
            .currentNodeId(startNode.id())
            .status(InstanceStatus.RUNNING)
            .context(new HashMap<>(initialContext))
            .createdOn(now)
            .updatedOn(now)
            .build();

        // Fire started event
        fireEvent(l -> l.onWorkflowStarted(instance));

        // Enter start node, add to history
        fireEvent(l -> l.onNodeEntered(instance, startNode));
        instance = instance.toBuilder()
            .addHistory(new HistoryEntry(startNode.id(), startNode.name(),
                null, null, now, now, Map.of()))
            .build();

        // Advance through the graph
        return advance(workflow, instance);
    }

    private WorkflowInstance advance(Workflow workflow, WorkflowInstance instance) {
        int transitions = 0;

        while (true) {
            if (transitions++ >= MAX_TRANSITIONS) {
                return failWorkflow(instance,
                    "Exceeded transition limit (" + MAX_TRANSITIONS + ") — possible infinite loop",
                    null);
            }

            WorkflowNode currentNode = workflow.findNodeById(instance.currentNodeId());

            // Find the next edge
            WorkflowEdge selectedEdge = selectEdge(workflow, instance, currentNode);
            if (selectedEdge == null) {
                // No matching edge — call error handler
                ErrorResolution resolution;
                try {
                    resolution = errorHandler.handleNoMatchingEdge(instance, currentNode);
                } catch (Exception e) {
                    return failWorkflow(instance, "Error handler threw: " + e.getMessage(), e);
                }
                instance = applyResolution(workflow, instance, currentNode, resolution);
                if (instance.status() != InstanceStatus.RUNNING) return instance;
                continue;
            }

            // Fire edge event
            WorkflowInstance edgeInstance = instance;
            fireEvent(l -> l.onEdgeFollowed(edgeInstance, selectedEdge));

            // Transition to target node
            WorkflowNode targetNode = workflow.findNodeById(selectedEdge.target());
            Instant now = Instant.now();

            // Mark current history entry as completed
            instance = completeCurrentHistoryEntry(instance, now);

            // Enter target node
            instance = instance.toBuilder()
                .currentNodeId(targetNode.id())
                .updatedOn(now)
                .addHistory(new HistoryEntry(targetNode.id(), targetNode.name(),
                    selectedEdge.id(), selectedEdge.condition(), now, null, null))
                .build();

            WorkflowInstance enteredInstance = instance;
            fireEvent(l -> l.onNodeEntered(enteredInstance, targetNode));

            // Execute based on node type
            switch (targetNode.type()) {
                case ACTION -> {
                    instance = executeActionNode(workflow, instance, targetNode);
                    if (instance.status() != InstanceStatus.RUNNING) return instance;
                }
                case HUMAN_TASK, RECEIVE_EVENT -> {
                    instance = instance.toBuilder()
                        .status(InstanceStatus.WAITING)
                        .updatedOn(Instant.now())
                        .build();
                    return instance;
                }
                case END -> {
                    instance = instance.toBuilder()
                        .status(InstanceStatus.COMPLETED)
                        .updatedOn(Instant.now())
                        .build();
                    instance = completeCurrentHistoryEntry(instance, Instant.now());
                    WorkflowInstance completedInstance = instance;
                    fireEvent(l -> l.onWorkflowCompleted(completedInstance));
                    return instance;
                }
                default -> {
                    return failWorkflow(instance, "Unexpected node type: " + targetNode.type(), null);
                }
            }
        }
    }

    private WorkflowInstance executeActionNode(Workflow workflow, WorkflowInstance instance,
                                               WorkflowNode actionNode) {
        String actionType = (String) actionNode.config().get("actionType");
        NodeExecutor executor = executors.get(actionType);
        if (executor == null) {
            return failWorkflow(instance, "No executor found for action type: " + actionType, null);
        }

        NodeResult result;
        try {
            result = executor.execute(new NodeExecutionContext(
                actionNode, instance.context(), actionNode.config()));
        } catch (Exception e) {
            ErrorResolution resolution;
            try {
                resolution = errorHandler.handleNodeError(instance, actionNode, null, e);
            } catch (Exception handlerError) {
                return failWorkflow(instance, "Error handler threw: " + handlerError.getMessage(), handlerError);
            }
            return applyResolution(workflow, instance, actionNode, resolution);
        }

        if (result.status() == NodeResultStatus.FAILED) {
            ErrorResolution resolution;
            try {
                resolution = errorHandler.handleNodeError(instance, actionNode, result, null);
            } catch (Exception handlerError) {
                return failWorkflow(instance, "Error handler threw: " + handlerError.getMessage(), handlerError);
            }
            return applyResolution(workflow, instance, actionNode, resolution);
        }

        // Success — merge output, fire completed, continue
        instance = instance.toBuilder()
            .mergeContext(result.output())
            .updatedOn(Instant.now())
            .build();

        WorkflowInstance completedInstance = instance;
        fireEvent(l -> l.onNodeCompleted(completedInstance, actionNode, result));

        return instance;
    }

    private WorkflowEdge selectEdge(Workflow workflow, WorkflowInstance instance,
                                     WorkflowNode node) {
        List<WorkflowEdge> outgoing = workflow.getOutgoingEdges(node.id());
        WorkflowEdge defaultEdge = null;

        for (WorkflowEdge edge : outgoing) {
            if (edge.isDefault()) {
                defaultEdge = edge;
                continue;
            }
            try {
                if (conditionEvaluator.evaluate(edge.condition(), instance.context())) {
                    return edge;
                }
            } catch (ConditionEvaluationException e) {
                log.warn("Condition evaluation failed for edge {}: {}", edge.id(), e.getMessage());
                // Treated as node error per spec
                return null;
            }
        }

        return defaultEdge;
    }

    private WorkflowInstance applyResolution(Workflow workflow, WorkflowInstance instance,
                                             WorkflowNode node, ErrorResolution resolution) {
        return switch (resolution.action()) {
            case FAIL -> failWorkflow(instance, "Workflow failed at node: " + node.id(), null);
            case RETRY -> instance;
            case TRANSITION -> {
                WorkflowNode target = workflow.findNodeById(resolution.targetNodeId());
                if (target == null) {
                    yield failWorkflow(instance,
                        "Error handler TRANSITION target not found: " + resolution.targetNodeId(), null);
                }
                yield instance.toBuilder()
                    .currentNodeId(target.id())
                    .updatedOn(Instant.now())
                    .build();
            }
        };
    }

    private WorkflowInstance failWorkflow(WorkflowInstance instance, String reason, Exception error) {
        WorkflowInstance failed = instance.toBuilder()
            .status(InstanceStatus.FAILED)
            .failureReason(reason)
            .updatedOn(Instant.now())
            .build();
        fireEvent(l -> l.onWorkflowFailed(failed, error));
        return failed;
    }

    private WorkflowInstance completeCurrentHistoryEntry(WorkflowInstance instance, Instant completedOn) {
        List<HistoryEntry> history = new ArrayList<>(instance.history());
        if (!history.isEmpty()) {
            HistoryEntry last = history.getLast();
            if (last.completedOn() == null) {
                history.set(history.size() - 1, new HistoryEntry(
                    last.nodeId(), last.nodeName(), last.edgeId(), last.edgeCondition(),
                    last.enteredOn(), completedOn, last.output()));
            }
        }
        return instance.toBuilder().history(history).build();
    }

    private void fireEvent(java.util.function.Consumer<WorkflowEventListener> action) {
        for (WorkflowEventListener listener : listeners) {
            try {
                action.accept(listener);
            } catch (Exception e) {
                log.warn("Event listener threw exception", e);
            }
        }
    }

    private void validateInputs(WorkflowNode startNode, Map<String, Object> initialContext) {
        Object inputsDef = startNode.config().get("inputs");
        if (inputsDef instanceof List<?> inputs) {
            for (Object inputObj : inputs) {
                if (inputObj instanceof Map<?, ?> input) {
                    String name = (String) input.get("name");
                    Object required = input.get("required");
                    if (Boolean.TRUE.equals(required) && !initialContext.containsKey(name)) {
                        throw new IllegalArgumentException("Missing required input: " + name);
                    }
                    if (Boolean.TRUE.equals(required) && initialContext.get(name) == null) {
                        throw new IllegalArgumentException("Required input is null: " + name);
                    }
                }
            }
        }
    }
}
```

Also create the validation exception (in `engine/src/main/java/io/apitomy/flow/engine/`):

```java
package io.apitomy.flow.engine;

import io.apitomy.flow.validation.ValidationProblem;
import java.util.List;

public class WorkflowValidationException extends RuntimeException {
    private final List<ValidationProblem> problems;

    public WorkflowValidationException(List<ValidationProblem> problems) {
        super("Workflow validation failed: " + problems.stream()
            .map(ValidationProblem::message).toList());
        this.problems = problems;
    }

    public List<ValidationProblem> getProblems() { return problems; }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && mvn test -Dtest=WorkflowEngineStartTest`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/engine/
git add engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineStartTest.java
git commit -m "feat: add WorkflowEngine with startWorkflow, transitions, and event firing"
```

---

### Task 5: WorkflowEngine — Complete + Cancel

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java`
- Create: `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineCompleteTest.java`

**Interfaces:**
- Consumes: `WorkflowEngine` from Task 4 (extends it with new methods)
- Produces: `WorkflowEngine.completeCurrentNode(Workflow, WorkflowInstance, NodeResult): WorkflowInstance`, `WorkflowEngine.cancelWorkflow(Workflow, WorkflowInstance): WorkflowInstance`

- [ ] **Step 1: Write failing tests**

```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowEngineCompleteTest {

    private WorkflowEngine engine(NodeExecutor... executors) {
        return new WorkflowEngine(List.of(executors), List.of(), null);
    }

    @Test
    void completeHumanTaskAdvancesToEnd() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, waiting.status());

        NodeResult result = new NodeResult(NodeResultStatus.COMPLETED, Map.of("approved", true));
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting, result);

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertTrue((Boolean) completed.context().get("approved"));
    }

    @Test
    void completeNodeChainsActions() {
        NodeExecutor executor = new NodeExecutor() {
            public String actionType() { return "process"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("processed", true));
            }
        };
        WorkflowEngine engine = engine(executor);
        Workflow workflow = new Workflow("w", "W", null,
            List.of(startNode("start"), humanTaskNode("task"), actionNode("process", "process"), endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "process"), edge("e3", "process", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("input", "data")));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertTrue((Boolean) completed.context().get("processed"));
    }

    @Test
    void completeNonWaitingThrows() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));

        assertThrows(IllegalStateException.class, () ->
            engine.completeCurrentNode(workflow, completed,
                new NodeResult(NodeResultStatus.COMPLETED, Map.of())));
    }

    @Test
    void cancelWaitingWorkflow() {
        List<String> events = new ArrayList<>();
        WorkflowEventListener listener = new WorkflowEventListener() {
            public void onWorkflowCancelled(WorkflowInstance i) { events.add("cancelled"); }
        };
        WorkflowEngine engine = new WorkflowEngine(List.of(), List.of(listener), null);
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        WorkflowInstance cancelled = engine.cancelWorkflow(workflow, waiting);
        assertEquals(InstanceStatus.CANCELLED, cancelled.status());
        assertTrue(events.contains("cancelled"));
    }

    @Test
    void cancelTerminalWorkflowIsNoOp() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));

        WorkflowInstance result = engine.cancelWorkflow(workflow, completed);
        assertEquals(InstanceStatus.COMPLETED, result.status());
    }

    @Test
    void inputInstanceNotMutated() {
        WorkflowEngine engine = engine();
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        String originalNodeId = waiting.currentNodeId();

        engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));

        assertEquals(originalNodeId, waiting.currentNodeId());
        assertEquals(InstanceStatus.WAITING, waiting.status());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && mvn test -Dtest=WorkflowEngineCompleteTest`
Expected: Compilation failure — `completeCurrentNode` and `cancelWorkflow` don't exist

- [ ] **Step 3: Add completeCurrentNode and cancelWorkflow to WorkflowEngine**

Add these methods to `WorkflowEngine.java`:

```java
public WorkflowInstance completeCurrentNode(Workflow workflow, WorkflowInstance instance,
                                             NodeResult result) {
    if (instance.status() != InstanceStatus.WAITING) {
        throw new IllegalStateException(
            "Cannot complete node: instance is not in WAITING status (current: " + instance.status() + ")");
    }

    WorkflowNode currentNode = workflow.findNodeById(instance.currentNodeId());

    // Merge result into context
    WorkflowInstance updated = instance.toBuilder()
        .mergeContext(result.output())
        .status(InstanceStatus.RUNNING)
        .updatedOn(Instant.now())
        .build();

    // Fire completed event
    fireEvent(l -> l.onNodeCompleted(updated, currentNode, result));

    // Advance
    return advance(workflow, updated);
}

public WorkflowInstance cancelWorkflow(Workflow workflow, WorkflowInstance instance) {
    if (instance.status() == InstanceStatus.COMPLETED
            || instance.status() == InstanceStatus.FAILED
            || instance.status() == InstanceStatus.CANCELLED) {
        return instance;
    }

    WorkflowInstance cancelled = instance.toBuilder()
        .status(InstanceStatus.CANCELLED)
        .updatedOn(Instant.now())
        .build();
    fireEvent(l -> l.onWorkflowCancelled(cancelled));
    return cancelled;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && mvn test -Dtest=WorkflowEngineCompleteTest`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java
git add engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineCompleteTest.java
git commit -m "feat: add completeCurrentNode and cancelWorkflow to WorkflowEngine"
```

---

### Task 6: WorkflowEngine — Error Handling

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java` (error paths already wired in Task 4, this task tests them)
- Create: `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineErrorTest.java`

**Interfaces:**
- Consumes: `WorkflowEngine` from Tasks 4-5, `WorkflowErrorHandler`, `ErrorResolution`, `ErrorAction` from Task 1
- Produces: Verified error handling behavior

- [ ] **Step 1: Write failing tests**

```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowEngineErrorTest {

    private NodeExecutor failingExecutor(String actionType) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.FAILED, Map.of("error", "something broke"));
            }
        };
    }

    private NodeExecutor throwingExecutor(String actionType) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                throw new RuntimeException("executor exploded");
            }
        };
    }

    @Test
    void defaultHandlerFailsWorkflowOnNodeError() {
        WorkflowEngine engine = new WorkflowEngine(List.of(failingExecutor("test")), List.of(), null);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertNotNull(result.failureReason());
    }

    @Test
    void defaultHandlerFailsWorkflowOnException() {
        WorkflowEngine engine = new WorkflowEngine(List.of(throwingExecutor("test")), List.of(), null);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
    }

    @Test
    void retryReExecutesNode() {
        int[] callCount = {0};
        NodeExecutor retryableExecutor = new NodeExecutor() {
            public String actionType() { return "test"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                callCount[0]++;
                if (callCount[0] < 3) {
                    return new NodeResult(NodeResultStatus.FAILED, Map.of());
                }
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("done", true));
            }
        };

        WorkflowErrorHandler retryHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.retry();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(List.of(retryableExecutor), List.of(), retryHandler);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(3, callCount[0]);
    }

    @Test
    void transitionToErrorNode() {
        WorkflowErrorHandler transitionHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("error-end");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        Workflow workflow = new Workflow("w", "W", null,
            List.of(startNode("start"), actionNode("a", "fail"), endNode("end"), endNode("error-end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));

        WorkflowEngine engine = new WorkflowEngine(
            List.of(failingExecutor("fail")), List.of(), transitionHandler);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals("error-end", result.currentNodeId());
    }

    @Test
    void transitionToInvalidNodeFailsWorkflow() {
        WorkflowErrorHandler badHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("nonexistent");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            List.of(failingExecutor("test")), List.of(), badHandler);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("not found"));
    }

    @Test
    void errorHandlerExceptionFailsWorkflow() {
        WorkflowErrorHandler explodingHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                throw new RuntimeException("handler exploded");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                throw new RuntimeException("handler exploded");
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            List.of(failingExecutor("test")), List.of(), explodingHandler);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("Error handler threw"));
    }

    @Test
    void handleNodeErrorReceivesResultOnFailed() {
        NodeResult[] captured = {null};
        Exception[] capturedException = {null};

        WorkflowErrorHandler capturingHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                captured[0] = r;
                capturedException[0] = e;
                return ErrorResolution.fail();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            List.of(failingExecutor("test")), List.of(), capturingHandler);
        engine.startWorkflow(simpleActionWorkflow("test"), Map.of());

        assertNotNull(captured[0]);
        assertEquals(NodeResultStatus.FAILED, captured[0].status());
        assertNull(capturedException[0]);
    }

    @Test
    void handleNodeErrorReceivesExceptionOnThrow() {
        NodeResult[] captured = {null};
        Exception[] capturedException = {null};

        WorkflowErrorHandler capturingHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                captured[0] = r;
                capturedException[0] = e;
                return ErrorResolution.fail();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            List.of(throwingExecutor("test")), List.of(), capturingHandler);
        engine.startWorkflow(simpleActionWorkflow("test"), Map.of());

        assertNull(captured[0]);
        assertNotNull(capturedException[0]);
        assertEquals("executor exploded", capturedException[0].getMessage());
    }
}
```

- [ ] **Step 2: Run tests to verify they pass**

The error handling logic was already implemented in Task 4's `WorkflowEngine`. These tests verify that behavior.

Run: `cd engine && mvn test -Dtest=WorkflowEngineErrorTest`
Expected: All tests PASS (if any fail, fix the engine logic)

- [ ] **Step 3: Run full test suite**

Run: `cd engine && mvn test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineErrorTest.java
git commit -m "test: add comprehensive error handling tests for WorkflowEngine"
```

---

### Task 7: Event Correlation (matchesEvent)

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java`
- Create: `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineEventCorrelationTest.java`

**Interfaces:**
- Consumes: `WorkflowEngine` from Tasks 4-5, `ConditionEvaluator` from Task 2
- Produces: `WorkflowEngine.matchesEvent(Workflow, WorkflowInstance, Map<String, Object>): boolean`

- [ ] **Step 1: Write failing tests**

```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowEngineEventCorrelationTest {

    private WorkflowEngine engine;

    @BeforeEach
    void setUp() {
        engine = new WorkflowEngine(List.of(), List.of(), null);
    }

    private Workflow receiveEventWorkflow(String eventType) {
        return new Workflow("w", "W", null,
            List.of(startNode("start"), receiveEventNode("wait", eventType), endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
    }

    private Workflow receiveEventWorkflowWithMatch(String eventType, List<String> match) {
        return new Workflow("w", "W", null,
            List.of(startNode("start"), receiveEventNode("wait", eventType, match), endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
    }

    @Test
    void matchesEventByType() {
        Workflow workflow = receiveEventWorkflow("pr-merged");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, instance.status());

        assertTrue(engine.matchesEvent(workflow, instance, Map.of("type", "pr-merged")));
        assertFalse(engine.matchesEvent(workflow, instance, Map.of("type", "pr-opened")));
    }

    @Test
    void matchesEventWithELExpressions() {
        Workflow workflow = receiveEventWorkflowWithMatch("pr-merged", List.of(
            "event.repository == context.repo",
            "event.pr_number == context.prNum"
        ));
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("repo", "apitomy/axiom", "prNum", 42));

        assertTrue(engine.matchesEvent(workflow, instance,
            Map.of("type", "pr-merged", "repository", "apitomy/axiom", "pr_number", 42)));

        assertFalse(engine.matchesEvent(workflow, instance,
            Map.of("type", "pr-merged", "repository", "other/repo", "pr_number", 42)));
    }

    @Test
    void matchesEventWithNestedEventData() {
        Workflow workflow = receiveEventWorkflowWithMatch("pr-merged", List.of(
            "event.pull_request.number == context.prNum"
        ));
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of("prNum", 99));

        assertTrue(engine.matchesEvent(workflow, instance,
            Map.of("type", "pr-merged", "pull_request", Map.of("number", 99))));

        assertFalse(engine.matchesEvent(workflow, instance,
            Map.of("type", "pr-merged", "pull_request", Map.of("number", 100))));
    }

    @Test
    void matchesEventReturnsFalseForNonWaiting() {
        Workflow workflow = receiveEventWorkflow("test");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance completed = engine.completeCurrentNode(workflow, instance,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of()));

        assertFalse(engine.matchesEvent(workflow, completed, Map.of("type", "test")));
    }

    @Test
    void matchesEventReturnsFalseForNonReceiveEventNode() {
        Workflow workflow = simpleHumanTaskWorkflow();
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertFalse(engine.matchesEvent(workflow, instance, Map.of("type", "any")));
    }

    @Test
    void matchesEventWithEmptyMatchListMatchesAnyOfType() {
        Workflow workflow = receiveEventWorkflow("deploy");
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());

        assertTrue(engine.matchesEvent(workflow, instance,
            Map.of("type", "deploy", "extra", "data")));
    }

    @Test
    void completeReceiveEventMergesEventPayload() {
        Workflow workflow = receiveEventWorkflow("notify");
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        Map<String, Object> eventPayload = Map.of("message", "hello", "sender", "system");
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, eventPayload));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("hello", completed.context().get("message"));
        assertEquals("system", completed.context().get("sender"));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && mvn test -Dtest=WorkflowEngineEventCorrelationTest`
Expected: Compilation failure — `matchesEvent` doesn't exist

- [ ] **Step 3: Add matchesEvent to WorkflowEngine**

Add this method to `WorkflowEngine.java`:

```java
public boolean matchesEvent(Workflow workflow, WorkflowInstance instance, Map<String, Object> event) {
    if (instance.status() != InstanceStatus.WAITING) {
        return false;
    }

    WorkflowNode currentNode = workflow.findNodeById(instance.currentNodeId());
    if (currentNode == null || currentNode.type() != NodeType.RECEIVE_EVENT) {
        return false;
    }

    // Check event type
    String expectedType = (String) currentNode.config().get("eventType");
    if (expectedType == null) {
        return false;
    }
    Object actualType = event.get("type");
    if (!expectedType.equals(actualType)) {
        return false;
    }

    // Check match expressions
    Object matchConfig = currentNode.config().get("match");
    if (matchConfig instanceof List<?> matchExpressions) {
        for (Object expr : matchExpressions) {
            if (expr instanceof String expression) {
                try {
                    if (!conditionEvaluator.evaluate(expression, instance.context(), event)) {
                        return false;
                    }
                } catch (ConditionEvaluationException e) {
                    log.warn("Event match expression failed: {}", e.getMessage());
                    return false;
                }
            }
        }
    }

    return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && mvn test -Dtest=WorkflowEngineEventCorrelationTest`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd engine && mvn test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java
git add engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineEventCorrelationTest.java
git commit -m "feat: add matchesEvent for event correlation with EL-based matching"
```

---

## Note: UI Plan

The React visual editor (`ui/`) is an independent subsystem with its own build root and technology stack. It will be covered in a separate implementation plan: `docs/superpowers/plans/2026-08-17-apitomy-flow-ui.md`.
