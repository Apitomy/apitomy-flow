package io.apitomy.flow.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class WorkflowInstanceModelTest {

    @Test
    void builderTracksActiveBranchesAndJoinArrivals() {
        WorkflowInstance instance = WorkflowInstance.builder()
            .id("i").workflowId("w").currentNodeId("a")
            .status(InstanceStatus.RUNNING)
            .addActiveBranch(new ActiveBranch("root", "a"))
            .addActiveBranch(new ActiveBranch("root.0", "b"))
            .recordJoinArrival("j", "e1")
            .createdOn(Instant.now()).updatedOn(Instant.now())
            .build();

        assertEquals(2, instance.activeBranches().size());
        assertEquals(List.of("e1"), instance.joinArrivals().get("j"));
    }

    @Test
    void removeActiveBranchRemovesById() {
        WorkflowInstance instance = WorkflowInstance.builder()
            .id("i").workflowId("w")
            .status(InstanceStatus.RUNNING)
            .addActiveBranch(new ActiveBranch("root", "a"))
            .addActiveBranch(new ActiveBranch("root.0", "b"))
            .removeActiveBranch("root")
            .createdOn(Instant.now()).updatedOn(Instant.now())
            .build();

        assertEquals(1, instance.activeBranches().size());
        assertEquals("root.0", instance.activeBranches().getFirst().branchId());
    }

    @Test
    void toBuilderDeepCopiesBranchState() {
        WorkflowInstance original = WorkflowInstance.builder()
            .id("i").workflowId("w").status(InstanceStatus.RUNNING)
            .addActiveBranch(new ActiveBranch("root", "a"))
            .recordJoinArrival("j", "e1")
            .createdOn(Instant.now()).updatedOn(Instant.now())
            .build();

        WorkflowInstance copy = original.toBuilder()
            .addActiveBranch(new ActiveBranch("root.0", "b"))
            .recordJoinArrival("j", "e2")
            .build();

        // original must be untouched (immutability)
        assertEquals(1, original.activeBranches().size());
        assertEquals(List.of("e1"), original.joinArrivals().get("j"));
        assertEquals(2, copy.activeBranches().size());
        assertEquals(List.of("e1", "e2"), copy.joinArrivals().get("j"));
    }

    @Test
    void legacyHistoryEntryConstructorDefaultsBranchIdToNull() {
        HistoryEntry entry = new HistoryEntry("n", "N", "e", null,
            Instant.now(), null, Map.of());
        assertNull(entry.branchId());
    }

    @Test
    void serializesActiveBranchesToJson() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());
        WorkflowInstance instance = WorkflowInstance.builder()
            .id("i").workflowId("w").currentNodeId("a")
            .status(InstanceStatus.RUNNING)
            .addActiveBranch(new ActiveBranch("root", "a"))
            .createdOn(Instant.now()).updatedOn(Instant.now())
            .build();

        String json = mapper.writeValueAsString(instance);
        assertTrue(json.contains("\"activeBranches\""));
        WorkflowInstance roundTripped = mapper.readValue(json, WorkflowInstance.class);
        assertEquals("root", roundTripped.activeBranches().getFirst().branchId());
    }

    @Test
    void deserializesLegacyJsonWithoutActiveBranches() throws Exception {
        // Simulate JSON written before the active-branch model (missing activeBranches/joinArrivals)
        String oldFormatJson = """
            {
              "id": "inst-1",
              "workflowId": "wf-1",
              "currentNodeId": "task-1",
              "status": "running",
              "context": {"key": "value"},
              "history": [],
              "failureReason": null,
              "createdOn": "2026-09-04T12:00:00Z",
              "updatedOn": "2026-09-04T12:00:00Z"
            }
            """;

        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());
        WorkflowInstance instance = mapper.readValue(oldFormatJson, WorkflowInstance.class);

        // Accessors should return empty collections, not null
        assertNotNull(instance.activeBranches());
        assertTrue(instance.activeBranches().isEmpty());
        assertNotNull(instance.joinArrivals());
        assertTrue(instance.joinArrivals().isEmpty());

        // toBuilder() should not NPE
        WorkflowInstance copy = instance.toBuilder().build();
        assertNotNull(copy.activeBranches());
        assertNotNull(copy.joinArrivals());
    }
}
