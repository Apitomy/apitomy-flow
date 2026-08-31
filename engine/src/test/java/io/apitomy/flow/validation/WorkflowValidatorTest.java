package io.apitomy.flow.validation;

import io.apitomy.flow.model.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests workflow definition validation: structural rules (start/end node presence,
 * edge references, duplicate IDs, start incoming/end outgoing constraints),
 * connectivity checks (outgoing edges, disconnected nodes), edge condition rules
 * (default edge requirements), semantic rules (missing action type, event type,
 * start inputs), and that a valid workflow produces no errors.
 */
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
        Workflow w = new Workflow("w", "W", null, null,
            List.of(endNode("end")), List.of());
        assertTrue(hasCode(validate(w), "NO_START_NODE"));
    }

    @Test
    void multipleStartNodes() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("s1"), startNode("s2"), endNode("end")),
            List.of(edge("e1", "s1", "end"), edge("e2", "s2", "end")));
        assertTrue(hasCode(validate(w), "MULTIPLE_START_NODES"));
    }

    @Test
    void noEndNode() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "test")),
            List.of(edge("e1", "start", "a")));
        assertTrue(hasCode(validate(w), "NO_END_NODE"));
    }

    @Test
    void invalidEdgeSource() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "nonexistent", "end")));
        assertTrue(hasCode(validate(w), "INVALID_EDGE_SOURCE"));
    }

    @Test
    void invalidEdgeTarget() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "nonexistent")));
        assertTrue(hasCode(validate(w), "INVALID_EDGE_TARGET"));
    }

    @Test
    void duplicateNodeId() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("dup"), endNode("dup")),
            List.of(edge("e1", "dup", "dup")));
        assertTrue(hasCode(validate(w), "DUPLICATE_NODE_ID"));
    }

    @Test
    void duplicateEdgeId() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("dup", "start", "end"), edge("dup", "start", "end")));
        assertTrue(hasCode(validate(w), "DUPLICATE_EDGE_ID"));
    }

    @Test
    void startHasIncoming() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "test"), endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "start"), edge("e3", "a", "end")));
        assertTrue(hasCode(validate(w), "START_HAS_INCOMING"));
    }

    @Test
    void endHasOutgoing() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end"), actionNode("a", "test")),
            List.of(edge("e1", "start", "end"), edge("e2", "end", "a")));
        assertTrue(hasCode(validate(w), "END_HAS_OUTGOING"));
    }

    @Test
    void missingActionInputs() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "test"), endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "MISSING_ACTION_INPUTS"));
    }

    @Test
    void missingActionOutputs() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "test"), endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "MISSING_ACTION_OUTPUTS"));
    }

    @Test
    void missingActionType() {
        WorkflowNode badAction = new WorkflowNode("a", NodeType.ACTION, "A", Map.of(), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), badAction, endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "MISSING_ACTION_TYPE"));
    }

    // --- Connectivity ---

    @Test
    void noOutgoingEdges() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "test"), endNode("end")),
            List.of(edge("e1", "start", "a")));
        assertTrue(hasCode(validate(w), "NO_OUTGOING_EDGES"));
    }

    @Test
    void disconnectedNode() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end"), actionNode("orphan", "test")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "DISCONNECTED_NODE"));
    }

    // --- Edge/Condition ---

    @Test
    void noDefaultEdge() {
        Workflow w2 = new Workflow("w", "W", null, null,
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
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end1"), endNode("end2")),
            List.of(defaultEdge("e1", "start", "end1"), defaultEdge("e2", "start", "end2")));
        assertTrue(hasCode(validate(w), "MULTIPLE_DEFAULT_EDGES"));
    }

    // --- Semantic ---

    @Test
    void missingEventType() {
        WorkflowNode badReceive = new WorkflowNode("r", NodeType.RECEIVE_EVENT, "R", Map.of(), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), badReceive, endNode("end")),
            List.of(edge("e1", "start", "r"), edge("e2", "r", "end")));
        assertTrue(hasCode(validate(w), "MISSING_EVENT_TYPE"));
    }

    @Test
    void missingTaskDescription() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), humanTaskNode("ht"), endNode("end")),
            List.of(edge("e1", "start", "ht"), edge("e2", "ht", "end")));
        assertTrue(hasCode(validate(w), "MISSING_TASK_DESCRIPTION"));
    }

    @Test
    void missingTaskOutputs() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), humanTaskNode("ht"), endNode("end")),
            List.of(edge("e1", "start", "ht"), edge("e2", "ht", "end")));
        assertTrue(hasCode(validate(w), "MISSING_TASK_OUTPUTS"));
    }

    private Workflow humanTaskWithOutputs(List<Map<String, Object>> outputs) {
        WorkflowNode task = new WorkflowNode("ht", NodeType.HUMAN_TASK, "HT",
            Map.of("description", "Do it", "outputs", outputs), new Position(200, 0));
        return new Workflow("w", "W", null, null,
            List.of(startNode("start"), task, endNode("end")),
            List.of(edge("e1", "start", "ht"), edge("e2", "ht", "end")));
    }

    @Test
    void selectWidgetWithoutOptionsWarns() {
        Workflow w = humanTaskWithOutputs(List.of(
            Map.of("name", "choice", "type", "string", "widget", "select")));
        assertTrue(hasCode(validate(w), "SELECT_MISSING_OPTIONS"));
    }

    @Test
    void selectWidgetWithOptionsIsClean() {
        Workflow w = humanTaskWithOutputs(List.of(Map.of(
            "name", "choice", "type", "string", "widget", "select",
            "options", List.of(Map.of("label", "A", "value", "a")))));
        assertFalse(hasCode(validate(w), "SELECT_MISSING_OPTIONS"));
    }

    @Test
    void malformedOptionWithoutValueWarns() {
        Workflow w = humanTaskWithOutputs(List.of(Map.of(
            "name", "choice", "type", "string", "widget", "select",
            "options", List.of(Map.of("label", "A")))));
        assertTrue(hasCode(validate(w), "MALFORMED_OUTPUT_OPTION"));
    }

    @Test
    void widgetOnNonStringTypeWarns() {
        Workflow w = humanTaskWithOutputs(List.of(
            Map.of("name", "n", "type", "number", "widget", "textarea")));
        assertTrue(hasCode(validate(w), "WIDGET_TYPE_MISMATCH"));
    }

    @Test
    void defaultValueTypeMismatchWarns() {
        Workflow w = humanTaskWithOutputs(List.of(
            Map.of("name", "n", "type", "number", "defaultValue", "not-a-number")));
        assertTrue(hasCode(validate(w), "DEFAULT_VALUE_TYPE_MISMATCH"));
    }

    @Test
    void minimalOutputsProduceNoMetadataWarnings() {
        Workflow w = humanTaskWithOutputs(List.of(
            Map.of("name", "decision", "type", "string", "required", true)));
        List<ValidationProblem> problems = validate(w);
        assertFalse(hasCode(problems, "SELECT_MISSING_OPTIONS"));
        assertFalse(hasCode(problems, "MALFORMED_OUTPUT_OPTION"));
        assertFalse(hasCode(problems, "WIDGET_TYPE_MISMATCH"));
        assertFalse(hasCode(problems, "DEFAULT_VALUE_TYPE_MISMATCH"));
    }

    @Test
    void missingWaitDuration() {
        WorkflowNode waitNoDuration = new WorkflowNode("w", NodeType.WAIT, "Wait", Map.of(), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), waitNoDuration, endNode("end")),
            List.of(edge("e1", "start", "w"), edge("e2", "w", "end")));
        assertTrue(hasCode(validate(w), "MISSING_WAIT_DURATION"));
    }

    @Test
    void missingStartInputs() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "MISSING_START_INPUTS"));
    }

    // --- Valid workflow produces no errors ---

    @Test
    void validWorkflowHasNoErrors() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(
                startNode("start", List.of(inputDef("input1", "string", true))),
                actionNode("a", "test"),
                endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        List<ValidationProblem> errors = validate(w).stream()
            .filter(p -> p.severity() == ValidationSeverity.ERROR).toList();
        assertTrue(errors.isEmpty(), "Valid workflow should have no errors: " + errors);
    }

    // ==========================================================================
    // New validation rules
    // ==========================================================================

    // --- Workflow identity ---

    @Test
    void missingWorkflowId() {
        Workflow w = new Workflow(null, "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "MISSING_WORKFLOW_ID"));
    }

    @Test
    void blankWorkflowId() {
        Workflow w = new Workflow("  ", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "MISSING_WORKFLOW_ID"));
    }

    @Test
    void missingWorkflowName() {
        Workflow w = new Workflow("w", null, null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "MISSING_WORKFLOW_NAME"));
    }

    @Test
    void blankWorkflowName() {
        Workflow w = new Workflow("w", "", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "MISSING_WORKFLOW_NAME"));
    }

    // --- Empty workflow ---

    @Test
    void emptyWorkflow() {
        Workflow w = new Workflow("w", "W", null, null, List.of(), List.of());
        List<ValidationProblem> problems = validate(w);
        assertTrue(hasCode(problems, "EMPTY_WORKFLOW"));
        // Should not report NO_START_NODE/NO_END_NODE since EMPTY_WORKFLOW covers it
        assertFalse(hasCode(problems, "NO_START_NODE"));
        assertFalse(hasCode(problems, "NO_END_NODE"));
    }

    // --- Node identity ---

    @Test
    void missingNodeId() {
        WorkflowNode noId = new WorkflowNode(null, NodeType.ACTION, "A",
            Map.of("actionType", "test"), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), noId, endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "MISSING_NODE_ID"));
    }

    @Test
    void missingNodeName() {
        WorkflowNode noName = new WorkflowNode("a", NodeType.ACTION, null,
            Map.of("actionType", "test"), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), noName, endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "MISSING_NODE_NAME"));
    }

    // --- Edge identity ---

    @Test
    void missingEdgeId() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(new WorkflowEdge(null, "start", "end", null, 0, false, null)));
        assertTrue(hasCode(validate(w), "MISSING_EDGE_ID"));
    }

    // --- Self-loop ---

    @Test
    void selfLoopEdge() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "test"), endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "a"), edge("e3", "a", "end")));
        assertTrue(hasCode(validate(w), "SELF_LOOP_EDGE"));
    }

    // --- Duplicate edge ---

    @Test
    void duplicateEdge() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "end"), edge("e2", "start", "end")));
        assertTrue(hasCode(validate(w), "DUPLICATE_EDGE"));
    }

    // --- Action type value ---

    @Test
    void invalidActionTypeValue() {
        WorkflowNode badAction = new WorkflowNode("a", NodeType.ACTION, "A",
            Map.of("actionType", 42), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), badAction, endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "INVALID_ACTION_TYPE_VALUE"));
    }

    @Test
    void blankActionTypeValue() {
        WorkflowNode badAction = new WorkflowNode("a", NodeType.ACTION, "A",
            Map.of("actionType", "  "), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), badAction, endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "INVALID_ACTION_TYPE_VALUE"));
    }

    // --- Invalid inputs type ---

    @Test
    void invalidInputsType() {
        WorkflowNode badAction = new WorkflowNode("a", NodeType.ACTION, "A",
            Map.of("actionType", "test", "inputs", "not-a-map"), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), badAction, endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "INVALID_INPUTS_TYPE"));
    }

    // --- Invalid outputs type ---

    @Test
    void invalidOutputsType() {
        WorkflowNode badAction = new WorkflowNode("a", NodeType.ACTION, "A",
            Map.of("actionType", "test", "outputs", "not-a-list"), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), badAction, endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "INVALID_OUTPUTS_TYPE"));
    }

    // --- Empty action input expression (Java parity) ---

    @Test
    void emptyActionInputExpression() {
        WorkflowNode actionWithEmptyInput = new WorkflowNode("a", NodeType.ACTION, "A",
            Map.of("actionType", "test", "inputs", Map.of("url", "", "method", "context.method")),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start", List.of(inputDef("x", "string", true))),
                actionWithEmptyInput, endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "EMPTY_ACTION_INPUT_EXPRESSION"));
    }

    // --- Empty task input expression (Java parity) ---

    @Test
    void emptyTaskInputExpression() {
        WorkflowNode taskWithEmptyInput = new WorkflowNode("ht", NodeType.HUMAN_TASK, "HT",
            Map.of("description", "Do it",
                "inputs", Map.of("score", ""),
                "outputs", List.of(Map.of("name", "decision", "type", "string", "required", true))),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start", List.of(inputDef("x", "string", true))),
                taskWithEmptyInput, endNode("end")),
            List.of(edge("e1", "start", "ht"), edge("e2", "ht", "end")));
        assertTrue(hasCode(validate(w), "EMPTY_TASK_INPUT_EXPRESSION"));
    }

    // --- Default edge with condition ---

    @Test
    void defaultEdgeWithCondition() {
        WorkflowEdge badDefault = new WorkflowEdge("e1", "start", "end",
            "context.x == 1", 0, true, null);
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(badDefault));
        assertTrue(hasCode(validate(w), "DEFAULT_EDGE_WITH_CONDITION"));
    }

    // --- Single conditional edge ---

    @Test
    void singleConditionalEdge() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(edge("e1", "start", "end", "context.x == 1", 0)));
        assertTrue(hasCode(validate(w), "SINGLE_CONDITIONAL_EDGE"));
    }

    @Test
    void singleUnconditionalEdgeNoProblem() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start", List.of(inputDef("x", "string", true))), endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertFalse(hasCode(validate(w), "SINGLE_CONDITIONAL_EDGE"));
    }

    // --- Invalid event type value ---

    @Test
    void invalidEventTypeValue() {
        WorkflowNode badReceive = new WorkflowNode("r", NodeType.RECEIVE_EVENT, "R",
            Map.of("eventType", 42), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), badReceive, endNode("end")),
            List.of(edge("e1", "start", "r"), edge("e2", "r", "end")));
        assertTrue(hasCode(validate(w), "INVALID_EVENT_TYPE_VALUE"));
    }

    @Test
    void blankEventTypeValue() {
        WorkflowNode badReceive = new WorkflowNode("r", NodeType.RECEIVE_EVENT, "R",
            Map.of("eventType", "  "), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), badReceive, endNode("end")),
            List.of(edge("e1", "start", "r"), edge("e2", "r", "end")));
        assertTrue(hasCode(validate(w), "INVALID_EVENT_TYPE_VALUE"));
    }

    // --- Invalid wait duration ---

    @Test
    void invalidWaitDuration() {
        WorkflowNode badWait = new WorkflowNode("w", NodeType.WAIT, "Wait",
            Map.of("duration", "30 minutes"), new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), badWait, endNode("end")),
            List.of(edge("e1", "start", "w"), edge("e2", "w", "end")));
        assertTrue(hasCode(validate(w), "INVALID_WAIT_DURATION"));
    }

    @Test
    void validWaitDuration() {
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start", List.of(inputDef("x", "string", true))),
                waitNode("wt", "PT30M"), endNode("end")),
            List.of(edge("e1", "start", "wt"), edge("e2", "wt", "end")));
        assertFalse(hasCode(validate(w), "INVALID_WAIT_DURATION"));
    }

    // --- Invalid input definition ---

    @Test
    void invalidInputDefinitionMissingName() {
        WorkflowNode startWithBadInput = new WorkflowNode("start", NodeType.START, "Start",
            Map.of("inputs", List.of(Map.of("type", "string", "required", true))),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startWithBadInput, endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "INVALID_INPUT_DEFINITION"));
    }

    // --- Duplicate input name ---

    @Test
    void duplicateInputName() {
        WorkflowNode startWithDupInput = new WorkflowNode("start", NodeType.START, "Start",
            Map.of("inputs", List.of(
                inputDef("x", "string", true),
                inputDef("x", "number", false))),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startWithDupInput, endNode("end")),
            List.of(edge("e1", "start", "end")));
        assertTrue(hasCode(validate(w), "DUPLICATE_INPUT_NAME"));
    }

    // --- Duplicate output name ---

    @Test
    void duplicateOutputName() {
        WorkflowNode actionWithDupOutput = new WorkflowNode("a", NodeType.ACTION, "A",
            Map.of("actionType", "test",
                "outputs", List.of(
                    Map.of("name", "result", "type", "string", "required", true),
                    Map.of("name", "result", "type", "number", "required", false))),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start", List.of(inputDef("x", "string", true))),
                actionWithDupOutput, endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        assertTrue(hasCode(validate(w), "DUPLICATE_OUTPUT_NAME"));
    }

    @Test
    void duplicateOutputNameOnHumanTask() {
        WorkflowNode taskWithDupOutput = new WorkflowNode("ht", NodeType.HUMAN_TASK, "HT",
            Map.of("description", "Do it",
                "outputs", List.of(
                    Map.of("name", "decision", "type", "string", "required", true),
                    Map.of("name", "decision", "type", "boolean", "required", false))),
            new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start", List.of(inputDef("x", "string", true))),
                taskWithDupOutput, endNode("end")),
            List.of(edge("e1", "start", "ht"), edge("e2", "ht", "end")));
        assertTrue(hasCode(validate(w), "DUPLICATE_OUTPUT_NAME"));
    }

    // --- Null-safety ---

    @Test
    void validatorHandlesNullEdgeTarget() {
        WorkflowEdge nullTargetEdge = new WorkflowEdge("e-bad", "start", null, null, 0, false, null);
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(nullTargetEdge, edge("e1", "start", "end")));
        List<ValidationProblem> problems = validate(w);
        assertNotNull(problems, "Validator should not throw NPE on null edge target");
    }

    @Test
    void validatorHandlesNullEdgeSource() {
        WorkflowEdge nullSourceEdge = new WorkflowEdge("e-bad", null, "end", null, 0, false, null);
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), endNode("end")),
            List.of(nullSourceEdge, edge("e1", "start", "end")));
        List<ValidationProblem> problems = validate(w);
        assertNotNull(problems, "Validator should not throw NPE on null edge source");
    }

    @Test
    void validatorHandlesNullConfigNode() {
        WorkflowNode nullConfigAction = new WorkflowNode("a", NodeType.ACTION, "A", null, new Position(0, 0));
        Workflow w = new Workflow("w", "W", null, null,
            List.of(startNode("start"), nullConfigAction, endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end")));
        List<ValidationProblem> problems = validate(w);
        assertTrue(hasCode(problems, "MISSING_ACTION_TYPE"),
            "Null config should be treated as empty map, triggering MISSING_ACTION_TYPE");
    }
}
