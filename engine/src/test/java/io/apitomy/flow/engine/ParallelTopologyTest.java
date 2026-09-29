package io.apitomy.flow.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import io.apitomy.flow.validation.WorkflowValidator;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class ParallelTopologyTest {
    record Fixture(String name, JsonNode data) {
        /** Uses the scenario name in parameterized test diagnostics. */
        @Override
        public String toString() { return name; }
    }

    static Stream<Fixture> fixtures() throws Exception {
        JsonNode cases = new ObjectMapper().readTree(Path.of("../conformance/parallel-topology.json").toFile());
        List<Fixture> fixtures = new ArrayList<>();
        cases.forEach(data -> fixtures.add(new Fixture(data.path("name").asText(), data)));
        return fixtures.stream();
    }

    static Stream<Fixture> balancedFixtures() throws Exception {
        return fixtures().filter(fixture -> !fixture.data().has("problem"));
    }

    private Workflow workflow(JsonNode data) {
        List<WorkflowNode> nodes = new ArrayList<>();
        data.path("nodes").forEach(id -> nodes.add(switch (id.asText()) {
            case "start" -> startNode("start");
            case "end" -> endNode("end");
            default -> actionNode(id.asText(), "record");
        }));
        List<WorkflowEdge> edges = new ArrayList<>();
        data.path("edges").forEach(e -> {
            String id = "e" + edges.size();
            String source = e.get(0).asText();
            String target = e.get(1).asText();
            String condition = e.path(2).asText("");
            edges.add(condition.equals("default") ? defaultEdge(id, source, target)
                : edge(id, source, target, condition, edges.size()));
        });
        return new Workflow("topology", "Topology", null, null, nodes, edges);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("fixtures")
    void analyzerAndValidatorAgree(Fixture fixture) {
        Workflow workflow = workflow(fixture.data());
        ParallelRegions regions = ParallelRegions.analyze(workflow);
        WorkflowValidator validator = new WorkflowValidator();
        if (fixture.data().has("problem")) {
            JsonNode problem = fixture.data().path("problem");
            assertTrue(regions.problems().contains(new ParallelRegions.Problem(
                problem.path("code").asText(), problem.path("nodeId").asText())), regions.problems().toString());
            assertTrue(validator.validate(workflow).stream().anyMatch(p ->
                p.code().equals(problem.path("code").asText()) && p.nodeId().equals(problem.path("nodeId").asText())));
        } else {
            assertEquals(List.of(), regions.problems());
            assertFalse(validator.hasErrors(validator.validate(workflow)), validator.validate(workflow).toString());
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("fixtures")
    void rejectsBeforeSideEffectsOrCompletesBalancedRegions(Fixture fixture) {
        for (boolean choose : List.of(true, false)) {
            Map<String, Integer> visits = new HashMap<>();
            NodeExecutor executor = new NodeExecutor() {
                /** Identifies the recording executor used by every fixture action. */
                public String actionType() { return "record"; }
                /** Records actual execution and controls the fixture's second region iteration. */
                public NodeResult execute(NodeExecutionContext context) {
                    String id = context.node().id();
                    int count = visits.merge(id, 1, Integer::sum);
                    return new NodeResult(NodeResultStatus.COMPLETED,
                        output(fixture, id, count));
                }
            };
            WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(), null);
            Workflow workflow = workflow(fixture.data());
            if (fixture.data().has("problem")) {
                WorkflowValidationException exception = assertThrows(WorkflowValidationException.class,
                    () -> engine.startWorkflow(workflow, Map.of("choose", choose)));
                assertTrue(exception.getProblems().stream().anyMatch(p ->
                    p.code().equals(fixture.data().path("problem").path("code").asText())));
                assertEquals(Map.of(), visits, "invalid topology must not execute any actions");
            } else {
                WorkflowInstance result = assertDoesNotThrow(
                    () -> engine.startWorkflow(workflow, Map.of("choose", choose)));
                assertEquals(InstanceStatus.COMPLETED, result.status());
                assertTrue(result.joinArrivals().isEmpty());
                assertOutcome(fixture, choose, result);
            }
        }
    }

    @ParameterizedTest(name = "parked branches: {0}")
    @MethodSource("balancedFixtures")
    void balancedRegionsResumeInEitherOrder(Fixture fixture) {
        for (boolean choose : List.of(true, false)) {
            for (boolean reverse : List.of(true, false)) {
                assertResumedOutcome(fixture, choose, reverse);
            }
        }
    }

    private void assertResumedOutcome(Fixture fixture, boolean choose, boolean reverse) {
        NodeExecutor executor = new NodeExecutor() {
            /** Identifies the pending action executor. */
            public String actionType() { return "record"; }
            /** Parks every action to exercise branch-addressed completion. */
            public NodeResult execute(NodeExecutionContext context) {
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };
        Workflow workflow = workflow(fixture.data());
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(executor), List.of(), null);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of("choose", choose));
        for (int attempts = 0; result.status() == InstanceStatus.WAITING && attempts < 50; attempts++) {
            String id = (reverse ? result.activeBranches().getLast() : result.activeBranches().getFirst()).nodeId();
            long count = result.history().stream().filter(h -> h.nodeId().equals(id)).count();
            Map<String, Object> output = output(fixture, id, count);
            result = engine.completeNode(workflow, result, id, new NodeResult(NodeResultStatus.COMPLETED, output));
        }
        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertTrue(result.activeBranches().isEmpty());
        assertTrue(result.joinArrivals().isEmpty());
        assertOutcome(fixture, choose, result);
    }

    private static Map<String, Object> output(Fixture fixture, String id, long count) {
        if (id.equals(fixture.data().path("repeatAt").asText())) return Map.of("repeat", count < 2);
        JsonNode output = fixture.data().path("outputs").path(id);
        return output.isMissingNode() ? Map.of() : new ObjectMapper().convertValue(output, new TypeReference<>() {});
    }

    private static void assertOutcome(Fixture fixture, boolean choose, WorkflowInstance result) {
        for (JsonNode expected : fixture.data().path("cases")) {
            if (expected.path("choose").asBoolean() != choose) continue;
            Map<String, Integer> visits = new HashMap<>();
            fixture.data().path("nodes").forEach(id -> visits.put(id.asText(), 0));
            result.history().forEach(entry -> visits.merge(entry.nodeId(), 1, Integer::sum));
            ObjectMapper mapper = new ObjectMapper();
            assertEquals(expected.path("visits"), mapper.valueToTree(visits));
            assertEquals(expected.path("context"), mapper.valueToTree(result.context()));
            return;
        }
        assertFalse(fixture.data().has("cases"), "Missing per-input expectation for choose=" + choose);
        fixture.data().path("visits").properties().forEach(entry -> assertEquals(
            entry.getValue().asInt(), result.history().stream()
                .filter(h -> h.nodeId().equals(entry.getKey())).count(), entry.getKey()));
    }
}
