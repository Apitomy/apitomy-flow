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
    void missingTaskDescription() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), humanTaskNode("ht"), endNode("end")),
            List.of(edge("e1", "start", "ht"), edge("e2", "ht", "end")));
        assertTrue(hasCode(validate(w), "MISSING_TASK_DESCRIPTION"));
    }

    @Test
    void missingTaskOutputs() {
        Workflow w = new Workflow("w", "W", null,
            List.of(startNode("start"), humanTaskNode("ht"), endNode("end")),
            List.of(edge("e1", "start", "ht"), edge("e2", "ht", "end")));
        assertTrue(hasCode(validate(w), "MISSING_TASK_OUTPUTS"));
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
