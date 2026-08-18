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

/**
 * Tests Jackson serialization and deserialization of workflow models: round-trip
 * fidelity for workflows and instances, kebab-case enum serialization for node
 * types and instance status, and workflow helper methods like findStartNode and
 * getOutgoingEdges.
 */
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
