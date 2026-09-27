package io.apitomy.flow.engine;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.apitomy.flow.model.*;
import io.apitomy.flow.validation.WorkflowValidator;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

class ConformanceTest {
    private static final ObjectMapper MAPPER = new ObjectMapper().registerModule(new JavaTimeModule());
    private static final ConditionEvaluator EVALUATOR = new ConditionEvaluator();

    record Fixture(String name, JsonNode data) {
        /** Displays the shared fixture name in test reports. */
        @Override
        public String toString() { return name; }
    }

    static Stream<Fixture> expressions() throws Exception { return fixtures("expressions"); }
    static Stream<Fixture> routing() throws Exception { return fixtures("routing"); }
    static Stream<Fixture> budgets() throws Exception { return fixtures("budgets"); }
    static Stream<Fixture> validation() throws Exception { return fixtures("validation"); }

    private static Stream<Fixture> fixtures(String file) throws Exception {
        List<Fixture> fixtures = new ArrayList<>();
        MAPPER.readTree(Path.of("../conformance/" + file + ".json").toFile())
            .forEach(data -> fixtures.add(new Fixture(data.path("name").asText(), data)));
        return fixtures.stream();
    }

    private static Map<String, Object> map(JsonNode data) {
        return data.isMissingNode() ? Map.of() : MAPPER.convertValue(data, new TypeReference<>() {});
    }

    @ParameterizedTest(name = "expression: {0}")
    @MethodSource("expressions")
    void expressionContract(Fixture fixture) {
        JsonNode data = fixture.data();
        String expression = data.path("expression").asText();
        if (data.path("invalid").asBoolean()) {
            assertFalse(EVALUATOR.isValid(expression));
            assertThrows(ConditionEvaluationException.class,
                () -> EVALUATOR.resolve(expression, map(data.path("context")), map(data.path("event"))));
        } else {
            if (!expression.isBlank()) assertTrue(EVALUATOR.isValid(expression));
            Object value = EVALUATOR.resolve(expression, map(data.path("context")), map(data.path("event")));
            assertJson(data.get("value"), MAPPER.valueToTree(value));
            assertEquals(data.has("condition") ? data.path("condition").asBoolean() : data.path("value").isBoolean()
                && data.path("value").asBoolean(),
                EVALUATOR.evaluate(expression, map(data.path("context")), map(data.path("event"))));
        }
    }

    @ParameterizedTest(name = "validation: {0}")
    @MethodSource("expressions")
    void expressionValidationContract(Fixture fixture) {
        String expression = fixture.data().path("expression").asText();
        if (expression.isBlank()) return;
        Workflow workflow = new Workflow("expression", "Expression", null, null, List.of(
            new WorkflowNode("start", NodeType.START, "Start", Map.of("inputs", List.of()), new Position(0, 0)),
            new WorkflowNode("event", NodeType.RECEIVE_EVENT, "Event", Map.of("eventType", "test", "outputs",
                List.of(Map.of("contextKey", "result", "expression", expression))), new Position(100, 0)),
            new WorkflowNode("end", NodeType.END, "End", Map.of(), new Position(200, 0))
        ), List.of(
            new WorkflowEdge("condition", "start", "event", expression, 0, false, null),
            new WorkflowEdge("fallback", "start", "end", null, 1, true, null),
            new WorkflowEdge("finish", "event", "end", null, 0, false, null)
        ));
        List<String> problems = new WorkflowValidator().validate(workflow).stream()
            .map(problem -> problem.code() + ":" + problem.severity().toString().toLowerCase()
                + ":" + (problem.edgeId() != null ? problem.edgeId() : problem.nodeId())).toList();
        assertEquals(fixture.data().path("invalid").asBoolean()
            ? List.of("INVALID_CONDITION:warning:condition", "INVALID_OUTPUT_EXPRESSION:error:event")
            : List.of(), problems);
    }

    @ParameterizedTest(name = "routing and serialization: {0}")
    @MethodSource("routing")
    void routingContract(Fixture fixture) throws Exception {
        JsonNode data = fixture.data();
        Workflow workflow = MAPPER.treeToValue(data.path("workflow"), Workflow.class);
        assertJson(data.path("problems"), MAPPER.valueToTree(new WorkflowValidator().validate(workflow).stream()
            .map(p -> p.code() + ":" + p.severity().toString().toLowerCase() + ":"
                + (p.edgeId() != null ? p.edgeId() : p.nodeId())).toList()));
        // Jackson emits absent optional fields as null/defaults; assert every supplied wire field survives.
        assertSuppliedFields(data.path("workflow"), MAPPER.valueToTree(workflow));
        workflow = MAPPER.readValue(MAPPER.writeValueAsString(workflow), Workflow.class);
        NodeExecutor executor = new NodeExecutor() {
            /** Identifies the pending action used in the shared routing fixtures. */
            public String actionType() { return "pending"; }
            /** Checks actual resolved inputs before parking the action. */
            public NodeResult execute(NodeExecutionContext context) {
                JsonNode inputs = data.path("inputs").path(context.node().id());
                if (!inputs.isMissingNode()) assertJson(inputs, MAPPER.valueToTree(context.inputs()));
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(), null);
        WorkflowInstance instance = engine.startWorkflow(workflow, map(data.path("context")));
        for (JsonNode step : data.path("steps")) {
            instance = MAPPER.readValue(MAPPER.writeValueAsString(instance), WorkflowInstance.class);
            if (step.has("resume")) {
                instance = engine.completeNode(workflow, instance, step.path("resume").asText(),
                    new NodeResult(NodeResultStatus.COMPLETED, map(step.path("output"))));
            }
            assertEquals(step.path("completed").asBoolean() ? InstanceStatus.COMPLETED : InstanceStatus.WAITING,
                instance.status());
            assertJson(step.path("activeBranches"), MAPPER.valueToTree(instance.activeBranches()));
            assertJson(step.path("joinArrivals"), MAPPER.valueToTree(instance.joinArrivals()));
            assertJson(step.path("context"), MAPPER.valueToTree(instance.context()));
            assertJson(step.path("visited"), MAPPER.valueToTree(instance.history().stream().map(HistoryEntry::nodeId).toList()));
        }
    }

    @ParameterizedTest(name = "budget: {0}")
    @MethodSource("budgets")
    void budgetContract(Fixture fixture) {
        JsonNode data = fixture.data();
        List<WorkflowNode> nodes = new ArrayList<>(List.of(
            node("start", NodeType.START, Map.of()), node("task", NodeType.HUMAN_TASK, Map.of()),
            node("end", NodeType.END, Map.of())));
        List<WorkflowEdge> edges = new ArrayList<>(List.of(
            new WorkflowEdge("begin", "start", "task", null, 0, false, null)));
        String source = "task";
        for (int i = 1; i < data.path("transitionsPerResume").asInt(); i++) {
            String id = "auto" + i;
            nodes.add(node(id, NodeType.ACTION, Map.of("actionType", "complete")));
            edges.add(new WorkflowEdge("e" + i, source, id, null, 0, false, null));
            source = id;
        }
        edges.add(new WorkflowEdge("repeat", source, "task", "context.repeat", 0, false, null));
        edges.add(new WorkflowEdge("finish", source, "end", null, 1, true, null));
        Workflow workflow = new Workflow("budget", "Budget", null, null, nodes, edges);
        NodeExecutor executor = new NodeExecutor() {
            /** Identifies the immediate action standing in for simulator automatic steps. */
            public String actionType() { return "complete"; }
            /** Completes without host side effects. */
            public NodeResult execute(NodeExecutionContext context) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            }
        };
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(), null);
        WorkflowInstance instance = engine.startWorkflow(workflow, Map.of());
        for (int i = 0; i < data.path("resumes").asInt(); i++) {
            assertEquals(InstanceStatus.WAITING, instance.status());
            instance = engine.completeNode(workflow, instance, "task", new NodeResult(NodeResultStatus.COMPLETED,
                Map.of("repeat", i < data.path("resumes").asInt() - 1)));
        }
        assertEquals(data.path("status").asText(), instance.status().toString().toLowerCase());
        if (instance.status() == InstanceStatus.FAILED) assertTrue(instance.failureReason().contains("transition limit"));
    }

    @ParameterizedTest(name = "duration: {0}")
    @MethodSource("validation")
    void durationContract(Fixture fixture) {
        JsonNode data = fixture.data();
        Workflow workflow = new Workflow("duration", "Duration", null, null, List.of(
            node("start", NodeType.START, Map.of("inputs", List.of())),
            node("wait", NodeType.WAIT, data.has("duration") ? Map.of("duration", data.path("duration").asText()) : Map.of()),
            node("end", NodeType.END, Map.of())
        ), List.of(new WorkflowEdge("begin", "start", "wait", null, 0, false, null),
            new WorkflowEdge("finish", "wait", "end", null, 0, false, null)));
        assertJson(data.path("problems"), MAPPER.valueToTree(new WorkflowValidator().validate(workflow).stream()
            .map(p -> p.code() + ":" + p.severity().toString().toLowerCase() + ":" + p.nodeId()).toList()));
    }

    private static WorkflowNode node(String id, NodeType type, Map<String, Object> config) {
        return new WorkflowNode(id, type, id, config, new Position(0, 0));
    }

    private static void assertSuppliedFields(JsonNode expected, JsonNode actual) {
        if (expected.isObject()) {
            expected.properties().forEach(entry -> assertSuppliedFields(entry.getValue(), actual.path(entry.getKey())));
        } else if (expected.isArray()) {
            assertEquals(expected.size(), actual.size());
            for (int i = 0; i < expected.size(); i++) assertSuppliedFields(expected.get(i), actual.path(i));
        } else {
            assertJson(expected, actual);
        }
    }

    /** Compares JSON semantically, including integral versus floating-point JSON numbers. */
    private static void assertJson(JsonNode expected, JsonNode actual) {
        if (expected.isNumber() && actual.isNumber()) {
            assertEquals(0, expected.decimalValue().compareTo(actual.decimalValue()));
        } else if (expected.isObject() && actual.isObject()) {
            assertEquals(expected.size(), actual.size());
            expected.properties().forEach(entry -> assertJson(entry.getValue(), actual.path(entry.getKey())));
        } else if (expected.isArray() && actual.isArray()) {
            assertEquals(expected.size(), actual.size());
            for (int i = 0; i < expected.size(); i++) assertJson(expected.get(i), actual.path(i));
        } else {
            assertEquals(expected, actual);
        }
    }
}
