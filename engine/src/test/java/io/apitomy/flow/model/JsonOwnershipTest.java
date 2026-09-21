package io.apitomy.flow.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.BinaryNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.POJONode;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.apitomy.flow.spi.NodeExecutionContext;
import io.apitomy.flow.spi.NodeResult;
import io.apitomy.flow.spi.NodeResultStatus;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class JsonOwnershipTest {
    private final ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());

    @Test
    void constructorsOwnNestedMapsListsAndNulls() {
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("value", 1);
        nested.put("nothing", null);
        List<Object> items = new ArrayList<>(Arrays.asList(nested, null));
        Map<String, Object> supplied = new LinkedHashMap<>(Map.of("items", items));
        WorkflowNode node = new WorkflowNode("task", NodeType.HUMAN_TASK, "Task", supplied, null);
        HistoryEntry entry = new HistoryEntry("task", "Task", null, null, null, null, supplied);
        WorkflowInstance direct = instance(supplied, new ArrayList<>(List.of(entry)), new ArrayList<>(),
            new LinkedHashMap<>());
        WorkflowInstance built = WorkflowInstance.builder().context(supplied).build();
        nested.put("value", 2);
        items.add("late");
        supplied.clear();

        for (Map<String, Object> snapshot : List.of(node.config(), entry.output(), direct.context(), built.context())) {
            List<?> saved = (List<?>) snapshot.get("items");
            assertNotNull(saved, "clearing the caller map must not clear the snapshot");
            assertEquals(2, saved.size());
            assertEquals(1, ((Map<?, ?>) saved.getFirst()).get("value"));
            assertTrue(((Map<?, ?>) saved.getFirst()).containsKey("nothing"));
            assertNull(saved.get(1));
            assertThrows(UnsupportedOperationException.class, snapshot::clear);
            assertThrows(UnsupportedOperationException.class, saved::clear);
            assertThrows(UnsupportedOperationException.class, ((Map<?, ?>) saved.getFirst())::clear);
        }
    }

    @Test
    void directConstructionOwnsDefinitionAndInstanceCollections() {
        List<WorkflowNode> nodes = new ArrayList<>(List.of(
            new WorkflowNode("start", NodeType.START, "Start", null, null)));
        List<WorkflowEdge> edges = new ArrayList<>();
        Workflow workflow = new Workflow("wf", "Workflow", null, null, nodes, edges);
        List<HistoryEntry> history = new ArrayList<>();
        List<ActiveBranch> branches = new ArrayList<>();
        List<String> arrivals = new ArrayList<>(List.of("edge"));
        Map<String, List<String>> joins = new LinkedHashMap<>(Map.of("join", arrivals));
        WorkflowInstance instance = instance(Map.of(), history, branches, joins);
        nodes.clear();
        edges.add(new WorkflowEdge("edge", "start", "end", null, 0, false, null));
        history.add(new HistoryEntry("start", null, null, null, null, null, null));
        branches.add(new ActiveBranch("branch", "start"));
        arrivals.clear();
        joins.clear();

        assertEquals(1, workflow.nodes().size());
        assertTrue(workflow.edges().isEmpty());
        assertTrue(instance.history().isEmpty());
        assertTrue(instance.activeBranches().isEmpty());
        assertEquals(List.of("edge"), instance.joinArrivals().get("join"));
        assertThrows(UnsupportedOperationException.class, workflow.nodes()::clear);
        assertThrows(UnsupportedOperationException.class, instance.joinArrivals().get("join")::clear);
    }

    @Test
    void jacksonTreesAreDetachedOnInputAndEveryAccessorPath() {
        ObjectNode tree = mapper.createObjectNode().put("value", 1);
        tree.putArray("items").addObject().put("value", 1);
        Map<String, Object> supplied = Map.of("tree", tree, "list", List.of(tree));
        WorkflowNode node = new WorkflowNode("task", NodeType.HUMAN_TASK, "Task", supplied, null);
        HistoryEntry history = new HistoryEntry("task", null, null, null, null, null, supplied);
        WorkflowInstance instance = WorkflowInstance.builder().context(supplied).build();
        NodeExecutionContext execution = new NodeExecutionContext(node, supplied, supplied);
        NodeResult result = new NodeResult(NodeResultStatus.COMPLETED, supplied);
        tree.put("value", 2);

        for (Map<String, Object> snapshot : List.of(node.config(), history.output(), instance.context(),
                execution.inputs(), execution.nodeConfig(), result.output())) {
            assertEquals(1, ((JsonNode) snapshot.get("tree")).path("value").asInt());
            ((ObjectNode) snapshot.get("tree")).put("value", 3);
            snapshot.values().stream().filter(JsonNode.class::isInstance)
                .forEach(value -> ((ObjectNode) value).put("value", 4));
            snapshot.entrySet().stream().filter(entry -> entry.getKey().equals("tree"))
                .forEach(entry -> ((ObjectNode) entry.getValue()).put("value", 5));
            snapshot.forEach((key, value) -> {
                if (value instanceof ObjectNode object) object.put("value", 6);
            });
            ((ObjectNode) ((List<?>) snapshot.get("list")).getFirst()).put("value", 7);
            ((ObjectNode) ((JsonNode) snapshot.get("tree")).path("items").get(0)).put("value", 8);
            assertEquals(1, ((JsonNode) snapshot.get("tree")).path("value").asInt());
            assertEquals(1, ((JsonNode) ((List<?>) snapshot.get("list")).getFirst()).path("value").asInt());
            assertEquals(1, ((JsonNode) snapshot.get("tree")).path("items").get(0).path("value").asInt());
        }
    }

    @Test
    void jacksonRoundTripsKeepFieldShapesNullsAndOwnedCollections() throws Exception {
        JsonNode definition = mapper.readTree("""
            {"id":"wf","name":"Workflow","description":null,"version":1,
             "nodes":[{"id":"task","type":"human-task","name":"Task",
                       "config":{"extension":{"items":[{"value":1},null]}},"position":null}],"edges":[]}
            """);
        Workflow workflow = mapper.treeToValue(definition, Workflow.class);
        assertEquals(definition, mapper.valueToTree(workflow));
        Map<?, ?> extension = (Map<?, ?>) workflow.nodes().getFirst().config().get("extension");
        assertThrows(UnsupportedOperationException.class, extension::clear);

        Map<String, Object> context = new LinkedHashMap<>();
        context.put("tree", mapper.createObjectNode().putNull("nothing"));
        context.put("nothing", null);
        WorkflowInstance original = instance(context,
            List.of(new HistoryEntry("task", null, null, null, Instant.EPOCH, null, context)), List.of(), Map.of());
        JsonNode serialized = mapper.valueToTree(original);
        WorkflowInstance restored = mapper.treeToValue(serialized, WorkflowInstance.class);
        assertEquals(serialized, mapper.valueToTree(restored));
        assertThrows(UnsupportedOperationException.class, ((Map<?, ?>) restored.context().get("tree"))::clear);
        assertThrows(UnsupportedOperationException.class, restored.history().getFirst().output()::clear);
        assertNull(new HistoryEntry("task", null, null, null, null, null, null).output());
    }

    @Test
    void opaqueExtensionObjectsRemainHostOwnedWithoutConversion() {
        StringBuilder opaque = new StringBuilder("host");
        WorkflowInstance instance = WorkflowInstance.builder().context(Map.of("opaque", opaque)).build();
        assertSame(opaque, instance.context().get("opaque"));
    }

    @Test
    void binaryAndPojoTreeValuesDoNotLeakMutableJsonPayloads() throws Exception {
        byte[] bytes = {1, 2};
        Map<String, Object> pojo = new LinkedHashMap<>(Map.of("value", 1));
        ArrayNode array = mapper.createArrayNode();
        array.addObject().put("value", 1);
        ObjectNode tree = mapper.createObjectNode();
        tree.set("binary", BinaryNode.valueOf(bytes));
        tree.set("pojo", new POJONode(pojo));
        tree.set("array", array);
        WorkflowInstance instance = WorkflowInstance.builder().context(Map.of("tree", tree)).build();
        bytes[0] = 9;
        pojo.put("value", 9);
        array.removeAll();

        ObjectNode read = (ObjectNode) instance.context().get("tree");
        assertEquals(1, read.path("binary").binaryValue()[0]);
        assertEquals(1, ((Map<?, ?>) ((POJONode) read.path("pojo")).getPojo()).get("value"));
        assertEquals(1, read.path("array").size());
        read.path("binary").binaryValue()[0] = 8;
        ((ArrayNode) read.path("array")).removeAll();
        assertThrows(UnsupportedOperationException.class,
            ((Map<?, ?>) ((POJONode) read.path("pojo")).getPojo())::clear);
        ObjectNode reread = (ObjectNode) instance.context().get("tree");
        assertEquals(1, reread.path("binary").binaryValue()[0]);
        assertEquals(1, reread.path("array").size());
        assertThrows(UnsupportedOperationException.class,
            () -> instance.context().entrySet().iterator().next().setValue("replacement"));
    }

    @Test
    void keyIterationDoesNotCopyTreeValuesOrAllowSnapshotMutation() {
        AtomicInteger treeCreations = new AtomicInteger();
        JsonNodeFactory factory = new JsonNodeFactory(false) {
            /** Counts tree creation while preserving normal Jackson object-node behavior. */
            @Override
            public ObjectNode objectNode() {
                treeCreations.incrementAndGet();
                return super.objectNode();
            }
        };
        ObjectNode tree = factory.objectNode();
        tree.putObject("nested").put("value", 1);
        Map<String, Object> supplied = new LinkedHashMap<>();
        supplied.put("payload", tree);
        supplied.put("nothing", null);
        Map<String, Object> snapshot = WorkflowInstance.builder().context(supplied).build().context();
        supplied.clear();
        treeCreations.set(0);

        Set<String> keys = snapshot.keySet();
        List<String> expected = List.of("payload", "nothing");
        assertEquals(expected, new ArrayList<>(keys));
        assertEquals(expected, keys.stream().toList());
        List<String> visited = new ArrayList<>();
        keys.forEach(visited::add);
        assertEquals(expected, visited);
        Iterator<String> iterator = keys.iterator();
        assertEquals("payload", iterator.next());
        assertThrows(UnsupportedOperationException.class, iterator::remove);
        assertThrows(UnsupportedOperationException.class, () -> keys.remove("payload"));
        assertThrows(UnsupportedOperationException.class, keys::clear);
        assertEquals(0, treeCreations.get(), "key-only reads must not copy any tree values");

        ObjectNode read = (ObjectNode) snapshot.get("payload");
        assertTrue(treeCreations.get() > 0, "the counter must detect an actual detached tree read");
        ((ObjectNode) read.path("nested")).put("value", 2);
        assertEquals(1, ((JsonNode) snapshot.get("payload")).path("nested").path("value").asInt());
        assertEquals(expected, new ArrayList<>(keys));
    }

    @Test
    void representativeLargePayloadIsSharedAcrossUnchangedAndMergingTransitions() {
        List<Object> rows = new ArrayList<>();
        for (int index = 0; index < 10_000; index++) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", index);
            row.put("tags", new ArrayList<>(Arrays.asList("one", "two", null)));
            row.put("tree", mapper.createObjectNode().put("value", index));
            rows.add(row);
        }
        assertTimeout(Duration.ofSeconds(10), () -> {
            WorkflowInstance first = WorkflowInstance.builder().context(Map.of("rows", rows)).build();
            WorkflowInstance current = first;
            Object ownedRows = first.context().get("rows");
            for (int step = 0; step < 200; step++) {
                WorkflowInstance unchanged = current.toBuilder().updatedOn(Instant.EPOCH).build();
                assertSame(current.context(), unchanged.context(), "metadata updates share the owned context");
                current = unchanged.toBuilder().mergeContext(Map.of("step", step)).build();
                assertSame(ownedRows, current.context().get("rows"), "merges share unchanged nested payloads");
            }
            rows.clear();
            List<?> savedRows = (List<?>) current.context().get("rows");
            assertEquals(10_000, savedRows.size());
            ObjectNode lastTree = (ObjectNode) ((Map<?, ?>) savedRows.getLast()).get("tree");
            lastTree.put("value", -1);
            assertEquals(9_999, ((JsonNode) ((Map<?, ?>) savedRows.getLast()).get("tree")).path("value").asInt());
            assertFalse(first.context().containsKey("step"));
            assertEquals(199, current.context().get("step"));
        });
    }

    private WorkflowInstance instance(Map<String, Object> context, List<HistoryEntry> history,
                                      List<ActiveBranch> branches, Map<String, List<String>> arrivals) {
        return new WorkflowInstance("instance", "wf", "task", InstanceStatus.WAITING, context,
            history, branches, arrivals, null, Instant.EPOCH, Instant.EPOCH);
    }
}
