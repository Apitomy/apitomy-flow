package io.apitomy.flow.changeset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/**
 * Applies editor change sets to workflow JSON documents with the same semantics and error codes as
 * {@code applyChangeSet} in {@code @apitomy/flow-ui}. Nodes are not positioned.
 */
public final class ChangeSets {

    private static final Set<String> NODE_TYPES =
        Set.of("start", "end", "action", "human-task", "receive-event", "wait");
    private static final List<String> REQUIRED_EDGE_FIELDS = List.of("id", "source", "target", "priority", "isDefault");
    private static final Set<String> METADATA_KEYS = Set.of("name", "description", "version");

    private ChangeSets() {
    }

    /**
     * Applies every op atomically without checking {@code baseRevision}.
     *
     * @param workflow the workflow JSON object; never mutated
     * @param changeSet the change set JSON object
     * @return {@link ChangeSetResult.Applied} or {@link ChangeSetResult.Rejected}
     */
    public static ChangeSetResult apply(JsonNode workflow, JsonNode changeSet) {
        if (workflow == null || !workflow.isObject()) {
            throw new IllegalArgumentException("workflow must be a JSON object");
        }
        JsonNode ops = changeSet == null ? null : changeSet.get("ops");
        if (ops == null || !ops.isArray()) {
            return new ChangeSetResult.Rejected(new ChangeSetError("malformed", null, "A change set must have an \"ops\" array"));
        }
        ObjectNode draft = (ObjectNode) workflow.deepCopy();
        for (int i = 0; i < ops.size(); i++) {
            try {
                applyOp(draft, ops.get(i));
            } catch (OpFailure failure) {
                return new ChangeSetResult.Rejected(new ChangeSetError(failure.code, i, failure.getMessage()));
            }
        }
        return new ChangeSetResult.Applied(draft);
    }

    /**
     * Applies the change set only if its {@code baseRevision} equals {@link ContentRevision#of(JsonNode)}.
     *
     * @param workflow the workflow JSON object; never mutated
     * @param changeSet the change set JSON object
     * @return the result, or a {@code stale} rejection without op index
     */
    public static ChangeSetResult applyChecked(JsonNode workflow, JsonNode changeSet) {
        String current = ContentRevision.of(workflow);
        String base = changeSet == null ? null : changeSet.path("baseRevision").asText(null);
        if (!current.equals(base)) {
            return new ChangeSetResult.Rejected(new ChangeSetError("stale", null,
                "Change set is based on " + base + " but the workflow is at " + current));
        }
        return apply(workflow, changeSet);
    }

    private static final class OpFailure extends RuntimeException {
        private final String code;

        OpFailure(String code, String reason) {
            super(reason, null, false, false);
            this.code = code;
        }
    }

    private static OpFailure fail(String code, String reason) {
        return new OpFailure(code, reason);
    }

    private static boolean isString(JsonNode node) {
        return node != null && node.isTextual() && !node.asText().isEmpty();
    }

    private static ObjectNode requireObject(JsonNode node, String label) {
        if (node == null || !node.isObject()) {
            throw fail("malformed", label + " must be an object");
        }
        return (ObjectNode) node;
    }

    private static String requireString(JsonNode op, String key) {
        JsonNode value = op.get(key);
        if (!isString(value)) {
            throw fail("malformed", "\"" + key + "\" must be a non-empty string");
        }
        return value.asText();
    }

    private static ObjectNode optionalPatch(ObjectNode op) {
        return op.has("patch") ? requireObject(op.get("patch"), "\"patch\"") : op.objectNode();
    }

    private static List<String> unsetList(ObjectNode op) {
        List<String> keys = new ArrayList<>();
        if (!op.has("unset")) {
            return keys;
        }
        JsonNode unset = op.get("unset");
        if (!unset.isArray()) {
            throw fail("malformed", "\"unset\" must be an array of strings");
        }
        for (JsonNode key : unset) {
            if (!isString(key)) {
                throw fail("malformed", "\"unset\" must be an array of strings");
            }
            keys.add(key.asText());
        }
        return keys;
    }

    private static ArrayNode nodes(ObjectNode draft) {
        return (ArrayNode) draft.get("nodes");
    }

    private static ArrayNode edges(ObjectNode draft) {
        return (ArrayNode) draft.get("edges");
    }

    private static ObjectNode findById(ArrayNode items, String id) {
        for (JsonNode item : items) {
            if (id.equals(item.path("id").asText(null))) {
                return (ObjectNode) item;
            }
        }
        return null;
    }

    private static void requireEndpoints(ObjectNode draft, String source, String target) {
        for (String id : List.of(source, target)) {
            if (findById(nodes(draft), id) == null) {
                throw fail("edge-endpoint-missing", "Edge endpoint \"" + id + "\" does not exist");
            }
        }
    }

    private static void removeById(ArrayNode items, String id) {
        for (Iterator<JsonNode> it = items.iterator(); it.hasNext();) {
            if (id.equals(it.next().path("id").asText(null))) {
                it.remove();
            }
        }
    }

    private static void applyOp(ObjectNode draft, JsonNode raw) {
        ObjectNode op = requireObject(raw, "Each op");
        String kind = op.path("op").asText("");
        switch (kind) {
            case "addNode" -> addNode(draft, op);
            case "updateNode" -> updateNode(draft, op);
            case "renameNode" -> renameNode(draft, op);
            case "removeNode" -> removeNode(draft, op);
            case "addEdge" -> addEdge(draft, op);
            case "updateEdge" -> updateEdge(draft, op);
            case "removeEdge" -> {
                String id = requireString(op, "id");
                if (findById(edges(draft), id) == null) {
                    throw fail("target-missing", "Edge \"" + id + "\" does not exist");
                }
                removeById(edges(draft), id);
            }
            case "metadata" -> metadata(draft, op);
            default -> throw fail("malformed", "Unknown op \"" + kind + "\"");
        }
    }

    private static void addNode(ObjectNode draft, ObjectNode op) {
        ObjectNode node = requireObject(op.get("node"), "\"node\"");
        if (!isString(node.get("id")) || !node.path("type").isTextual() || !NODE_TYPES.contains(node.path("type").asText())
            || !isString(node.get("name")) || !node.path("config").isObject()) {
            throw fail("malformed", "addNode requires a node with id, a known type, name and an object config");
        }
        if (findById(nodes(draft), node.get("id").asText()) != null) {
            throw fail("duplicate-id", "Node \"" + node.get("id").asText() + "\" already exists");
        }
        nodes(draft).add(node.deepCopy());
    }

    private static void updateNode(ObjectNode draft, ObjectNode op) {
        String id = requireString(op, "id");
        ObjectNode patch = optionalPatch(op);
        List<String> unset = unsetList(op);
        for (Iterator<String> it = patch.fieldNames(); it.hasNext();) {
            String key = it.next();
            if (!key.equals("name") && !key.equals("config")) {
                throw fail("malformed", "updateNode patch may only contain \"name\" and \"config\", not \"" + key + "\"");
            }
        }
        if (patch.has("name") && !isString(patch.get("name"))) {
            throw fail("malformed", "\"patch.name\" must be a non-empty string");
        }
        ObjectNode config = patch.has("config") ? requireObject(patch.get("config"), "\"patch.config\"") : patch.objectNode();
        for (String key : unset) {
            if (config.has(key)) {
                throw fail("malformed", "\"" + key + "\" appears in both patch.config and unset");
            }
        }
        ObjectNode node = findById(nodes(draft), id);
        if (node == null) {
            throw fail("target-missing", "Node \"" + id + "\" does not exist");
        }
        if (patch.has("name")) {
            node.set("name", patch.get("name").deepCopy());
        }
        ObjectNode merged = node.path("config").isObject() ? (ObjectNode) node.get("config").deepCopy() : node.objectNode();
        merged.setAll(config.deepCopy());
        unset.forEach(merged::remove);
        node.set("config", merged);
    }

    private static void renameNode(ObjectNode draft, ObjectNode op) {
        String id = requireString(op, "id");
        String newId = requireString(op, "newId");
        ObjectNode node = findById(nodes(draft), id);
        if (node == null) {
            throw fail("target-missing", "Node \"" + id + "\" does not exist");
        }
        if (newId.equals(id)) {
            return;
        }
        if (findById(nodes(draft), newId) != null) {
            throw fail("duplicate-id", "Node \"" + newId + "\" already exists");
        }
        node.put("id", newId);
        for (JsonNode edge : edges(draft)) {
            ObjectNode e = (ObjectNode) edge;
            if (id.equals(e.path("source").asText(null))) {
                e.put("source", newId);
            }
            if (id.equals(e.path("target").asText(null))) {
                e.put("target", newId);
            }
        }
    }

    private static void removeNode(ObjectNode draft, ObjectNode op) {
        String id = requireString(op, "id");
        if (findById(nodes(draft), id) == null) {
            throw fail("target-missing", "Node \"" + id + "\" does not exist");
        }
        removeById(nodes(draft), id);
        for (Iterator<JsonNode> it = edges(draft).iterator(); it.hasNext();) {
            JsonNode edge = it.next();
            if (id.equals(edge.path("source").asText(null)) || id.equals(edge.path("target").asText(null))) {
                it.remove();
            }
        }
    }

    private static void addEdge(ObjectNode draft, ObjectNode op) {
        ObjectNode edge = requireObject(op.get("edge"), "\"edge\"");
        if (!isString(edge.get("id")) || !isString(edge.get("source")) || !isString(edge.get("target"))
            || !edge.path("priority").isNumber() || !edge.path("isDefault").isBoolean()) {
            throw fail("malformed", "addEdge requires id, source, target, a numeric priority and a boolean isDefault");
        }
        if (findById(edges(draft), edge.get("id").asText()) != null) {
            throw fail("duplicate-id", "Edge \"" + edge.get("id").asText() + "\" already exists");
        }
        requireEndpoints(draft, edge.get("source").asText(), edge.get("target").asText());
        edges(draft).add(edge.deepCopy());
    }

    private static void updateEdge(ObjectNode draft, ObjectNode op) {
        String id = requireString(op, "id");
        ObjectNode patch = optionalPatch(op);
        List<String> unset = unsetList(op);
        if (patch.has("id")) {
            throw fail("malformed", "updateEdge patch may not change \"id\"");
        }
        for (String key : unset) {
            if (REQUIRED_EDGE_FIELDS.contains(key)) {
                throw fail("malformed", "\"" + key + "\" is required and cannot be unset");
            }
        }
        for (String key : unset) {
            if (patch.has(key)) {
                throw fail("malformed", "\"" + key + "\" appears in both patch and unset");
            }
        }
        if ((patch.has("source") && !isString(patch.get("source"))) || (patch.has("target") && !isString(patch.get("target")))
            || (patch.has("priority") && !patch.get("priority").isNumber())
            || (patch.has("isDefault") && !patch.get("isDefault").isBoolean())) {
            throw fail("malformed", "updateEdge patch has a field of the wrong type");
        }
        ObjectNode edge = findById(edges(draft), id);
        if (edge == null) {
            throw fail("target-missing", "Edge \"" + id + "\" does not exist");
        }
        ObjectNode merged = edge.deepCopy();
        merged.setAll(patch.deepCopy());
        unset.forEach(merged::remove);
        requireEndpoints(draft, merged.path("source").asText(), merged.path("target").asText());
        edge.removeAll();
        edge.setAll(merged);
    }

    private static void metadata(ObjectNode draft, ObjectNode op) {
        ObjectNode patch = requireObject(op.get("patch"), "\"patch\"");
        for (Iterator<String> it = patch.fieldNames(); it.hasNext();) {
            String key = it.next();
            if (!METADATA_KEYS.contains(key)) {
                throw fail("malformed", "metadata patch may only contain name, description and version, not \"" + key + "\"");
            }
        }
        if ((patch.has("name") && !isString(patch.get("name")))
            || (patch.has("description") && !patch.get("description").isTextual())
            || (patch.has("version") && !patch.get("version").isNumber())) {
            throw fail("malformed", "metadata patch has a field of the wrong type");
        }
        draft.setAll(patch.deepCopy());
    }
}
