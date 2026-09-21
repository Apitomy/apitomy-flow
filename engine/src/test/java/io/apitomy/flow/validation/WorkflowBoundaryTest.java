package io.apitomy.flow.validation;

import io.apitomy.flow.model.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.DynamicTest;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowBoundaryTest {
    private final WorkflowValidator validator = new WorkflowValidator();

    private void assertError(Workflow workflow, String code) {
        List<ValidationProblem> problems = assertDoesNotThrow(() -> validator.validate(workflow));
        assertTrue(problems.stream().anyMatch(p -> p.code().equals(code)
            && p.severity() == ValidationSeverity.ERROR), () -> problems.toString());
    }

    @Test
    void rejectsNullWorkflowAndGraphEntriesWithoutIncidentalExceptions() {
        assertError(null, "INVALID_WORKFLOW");
        assertError(new Workflow("w", "W", null, null, Arrays.asList((WorkflowNode) null), List.of()), "INVALID_NODE");
        assertError(new Workflow("w", "W", null, null, List.of(startNode("s"), endNode("e")),
            Arrays.asList((WorkflowEdge) null)), "INVALID_EDGE");
    }

    @Test
    void rejectsMissingNodeKindsAndIdsBeforeTraversal() {
        assertError(withNode(new WorkflowNode("a", null, "A", Map.of(), null)), "INVALID_NODE_TYPE");
        assertError(withNode(new WorkflowNode(null, NodeType.START, "A", Map.of(), null)), "MISSING_NODE_ID");
    }

    @TestFactory
    Stream<DynamicTest> rejectsMalformedNestedCollectionsAndPrimitives() {
        Object[][] cases = {
            {NodeType.ACTION, Map.of("actionType", "noop", "inputs", List.of()), "INVALID_INPUTS_TYPE"},
            {NodeType.ACTION, Map.of("actionType", "noop", "outputs", Map.of()), "INVALID_OUTPUTS_TYPE"},
            {NodeType.ACTION, Map.of("outputs", Arrays.asList((Object) null)), "INVALID_OUTPUT_DEFINITION"},
            {NodeType.ACTION, Map.of("outputs", List.of(Map.of("name", 3))), "INVALID_OUTPUT_DEFINITION"},
            {NodeType.START, Map.of("inputs", Map.of()), "INVALID_INPUTS_TYPE"},
            {NodeType.START, Map.of("inputs", Arrays.asList((Object) null)), "INVALID_INPUT_DEFINITION"},
            {NodeType.START, Map.of("inputs", List.of(Map.of("name", "x", "required", "false"))), "INVALID_INPUT_DEFINITION"},
            {NodeType.HUMAN_TASK, Map.of("description", Map.of()), "INVALID_TASK_DESCRIPTION"},
            {NodeType.HUMAN_TASK, Map.of("outputs", List.of(Map.of("name", "x", "options", Map.of()))), "INVALID_OUTPUT_DEFINITION"},
            {NodeType.HUMAN_TASK, Map.of("outputs", List.of(Map.of("name", "x", "options", Arrays.asList((Object) null)))), "MALFORMED_OUTPUT_OPTION"},
            {NodeType.RECEIVE_EVENT, Map.of("match", Map.of()), "INVALID_MATCH_TYPE"},
            {NodeType.RECEIVE_EVENT, Map.of("match", Arrays.asList((Object) null)), "INVALID_MATCH_TYPE"},
            {NodeType.WAIT, Map.of("duration", 3), "INVALID_WAIT_DURATION"},
        };
        return Arrays.stream(cases).map(testCase -> DynamicTest.dynamicTest(testCase[0] + " " + testCase[1], () -> {
            @SuppressWarnings("unchecked")
            Map<String, Object> config = (Map<String, Object>) testCase[1];
            assertError(withNode(new WorkflowNode("a", (NodeType) testCase[0], "A", config, null)),
                (String) testCase[2]);
        }));
    }

    @Test
    void rejectsJsonNullEntriesAfterDeserialization() throws Exception {
        Workflow workflow = new ObjectMapper().readValue("""
            {"id":"w","name":"W","nodes":[null],"edges":[null]}
            """, Workflow.class);
        assertError(workflow, "INVALID_NODE");
        assertError(workflow, "INVALID_EDGE");
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void rejectsRawCollectionElementsWithoutClassCastExceptions() {
        assertError(new Workflow("w", "W", null, null, (List) List.of("bad"), List.of()), "INVALID_NODE");
        assertError(new Workflow("w", "W", null, null, List.of(), (List) List.of(Map.of())), "INVALID_EDGE");
    }

    @Test
    void rejectsNonFinitePositionAndBlankEndpoints() {
        assertError(withNode(new WorkflowNode("a", NodeType.ACTION, "A", Map.of(),
            new Position(Double.NaN, 0))), "INVALID_NODE_POSITION");
        assertError(new Workflow("w", "W", null, null, List.of(startNode("s"), endNode("e")),
            List.of(edge("bad", " ", "e"))), "MISSING_EDGE_SOURCE");
    }

    @Test
    void acceptsLiteralInputsAndAbsentLayoutWithHostConfig() {
        WorkflowNode node = new WorkflowNode("a", NodeType.ACTION, "A", Map.of(
            "actionType", "noop", "inputs", Map.of("count", 3, "enabled", false, "data", Map.of("x", List.of(1))),
            "outputs", List.of(), "host", Map.of("custom", true)), null);
        assertFalse(validator.hasErrors(validator.validate(withNode(node))));
    }

    private Workflow withNode(WorkflowNode node) {
        return new Workflow("w", "W", null, null, List.of(startNode("s"), node, endNode("e")),
            List.of(edge("sa", "s", "a"), edge("ae", "a", "e")));
    }
}
