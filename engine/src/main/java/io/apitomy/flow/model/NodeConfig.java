package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonValue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Typed, immutable views of the existing config map. {@link #wire()} retains absent versus null fields,
 * nested host extensions, and original spelling; Jackson writes that map without adapter metadata.
 * Accessors apply runtime defaults without rewriting the wire data. Structural validation should run
 * before adaptation; incorrectly typed fields throw an IllegalArgumentException rather than coerce.
 */
public sealed interface NodeConfig permits NodeConfig.Start, NodeConfig.End, NodeConfig.Action,
        NodeConfig.HumanTask, NodeConfig.ReceiveEvent, NodeConfig.Wait {
    /** Returns the original immutable JSON shape, including host-owned fields. */
    @JsonValue
    Map<String, Object> wire();

    /** Adapts a node without changing its record constructor or map-based serialization contract. */
    static NodeConfig from(WorkflowNode node) {
        return switch (node.type()) {
            case START -> new Start(node.config());
            case END -> new End(node.config());
            case ACTION -> new Action(node.config());
            case HUMAN_TASK -> new HumanTask(node.config());
            case RECEIVE_EVENT -> new ReceiveEvent(node.config());
            case WAIT -> new Wait(node.config());
        };
    }

    /** Start input declarations; absent/null lists have no declarations. */
    record Start(Map<String, Object> wire) implements NodeConfig {
        /** Snapshots caller-owned configuration. */
        public Start { wire = snapshot(wire); }
        /** Returns input declarations in authored order. */
        public List<Field> inputs() { return records(wire, "inputs", Field::new); }
    }

    /** End nodes have only host-owned configuration. */
    record End(Map<String, Object> wire) implements NodeConfig {
        /** Snapshots caller-owned configuration. */
        public End { wire = snapshot(wire); }
    }

    /** Action executor selection, expression/literal inputs, and output declarations. */
    record Action(Map<String, Object> wire) implements NodeConfig {
        /** Snapshots caller-owned configuration. */
        public Action { wire = snapshot(wire); }
        /** Returns the executor's registered action type, or null. */
        public String actionType() { return text(wire, "actionType"); }
        /** Returns literal or expression-valued inputs; absent/null means empty. */
        public Map<String, Object> inputs() { return object(wire.get("inputs")); }
        /** Returns output declarations in authored order. */
        public List<Field> outputs() { return records(wire, "outputs", Field::new); }
    }

    /** Human-task instructions, expression/literal inputs, and form output metadata. */
    record HumanTask(Map<String, Object> wire) implements NodeConfig {
        /** Snapshots caller-owned configuration. */
        public HumanTask { wire = snapshot(wire); }
        /** Returns task instructions, or null. */
        public String description() { return text(wire, "description"); }
        /** Returns literal or expression-valued inputs; absent/null means empty. */
        public Map<String, Object> inputs() { return object(wire.get("inputs")); }
        /** Returns output declarations including presentation metadata. */
        public List<Field> outputs() { return records(wire, "outputs", Field::new); }
    }

    /** Event correlation and expression-based output mappings. */
    record ReceiveEvent(Map<String, Object> wire) implements NodeConfig {
        /** Snapshots caller-owned configuration. */
        public ReceiveEvent { wire = snapshot(wire); }
        /** Returns the event type, or null. */
        public String eventType() { return text(wire, "eventType"); }
        /** Returns match expressions; absent/null means no additional predicates. */
        public List<String> match() {
            return list(wire, "match").stream().map(value -> {
                if (value instanceof String text) return text;
                throw new IllegalArgumentException("config.match entries must be strings");
            }).toList();
        }
        /** Returns output mappings; empty means legacy flat event merge. */
        public List<Mapping> outputs() { return records(wire, "outputs", Mapping::new); }
    }

    /** Wait duration as authored ISO-8601 text (semantic validation checks its syntax). */
    record Wait(Map<String, Object> wire) implements NodeConfig {
        /** Snapshots caller-owned configuration. */
        public Wait { wire = snapshot(wire); }
        /** Returns duration text, or null. */
        public String duration() { return text(wire, "duration"); }
    }

    /** Shared input/output declaration with optional human-task metadata and host extensions. */
    record Field(@JsonValue Map<String, Object> wire) {
        /** Snapshots caller-owned declaration data. */
        public Field { wire = snapshot(wire); }
        /** Returns the declared name. */
        public String name() { return text(wire, "name"); }
        /** Returns the declared type, defaulting to string for absent/null. */
        public String type() { String value = text(wire, "type"); return value == null ? "string" : value; }
        /** Returns requiredness, defaulting to false for absent/null. */
        public boolean required() {
            Object value = wire.get("required");
            if (value == null) return false;
            if (value instanceof Boolean flag) return flag;
            throw new IllegalArgumentException("required must be a boolean");
        }
        /** Returns the authored context-key override, or null. */
        public String contextKey() { return text(wire, "contextKey"); }
        /** Resolves a nonblank context-key override, falling back to name. */
        public String effectiveContextKey() {
            String key = contextKey();
            return key == null || key.isBlank() ? name() : key;
        }
        /** Returns the authored label, or null. */
        public String label() { return text(wire, "label"); }
        /** Returns the authored description, or null. */
        public String description() { return text(wire, "description"); }
        /** Returns the authored widget, or null. */
        public String widget() { return text(wire, "widget"); }
        /** Returns the immutable default JSON value, including explicit null. */
        public Object defaultValue() { return wire.get("defaultValue"); }
        /** Returns select options; absent/null means empty. */
        public List<Option> options() { return records(wire, "options", Option::new); }
    }

    /** Select option with lossless host metadata. */
    record Option(@JsonValue Map<String, Object> wire) {
        /** Snapshots caller-owned option data. */
        public Option { wire = snapshot(wire); }
        /** Returns the authored label, or null. */
        public String label() { return text(wire, "label"); }
        /** Returns the authored value, or null. */
        public String value() { return text(wire, "value"); }
    }

    /** Receive-event output mapping with lossless host metadata. */
    record Mapping(@JsonValue Map<String, Object> wire) {
        /** Snapshots caller-owned mapping data. */
        public Mapping { wire = snapshot(wire); }
        /** Returns the target context key, or null. */
        public String contextKey() { return text(wire, "contextKey"); }
        /** Returns the expression, or null. */
        public String expression() { return text(wire, "expression"); }
    }

    private static Map<String, Object> snapshot(Map<String, Object> value) {
        return JsonSnapshots.map(value == null ? Map.of() : value);
    }

    private static String text(Map<String, Object> value, String key) {
        Object field = value.get(key);
        if (field == null) return null;
        if (field instanceof String text) return text;
        throw new IllegalArgumentException(key + " must be a string");
    }

    private static Map<String, Object> object(Object value) {
        if (value == null) return Map.of();
        if (!(value instanceof Map<?, ?> map)) throw new IllegalArgumentException("Expected config object");
        Map<String, Object> result = new LinkedHashMap<>();
        map.forEach((key, entry) -> {
            if (!(key instanceof String name)) throw new IllegalArgumentException("Expected string key");
            result.put(name, entry);
        });
        return snapshot(result);
    }

    private static List<?> list(Map<String, Object> wire, String key) {
        Object value = wire.get(key);
        if (value == null) return List.of();
        if (value instanceof List<?> list) return list;
        throw new IllegalArgumentException(key + " must be a list");
    }

    private static <T> List<T> records(Map<String, Object> wire, String key,
                                      Function<Map<String, Object>, T> factory) {
        return list(wire, key).stream().map(value -> {
            if (value == null) throw new IllegalArgumentException(key + " entries must be objects");
            return factory.apply(object(value));
        }).toList();
    }
}
