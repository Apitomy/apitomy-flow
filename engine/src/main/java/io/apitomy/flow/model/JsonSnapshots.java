package io.apitomy.flow.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.BinaryNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.POJONode;

import java.util.AbstractList;
import java.util.AbstractMap;
import java.util.AbstractSet;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.RandomAccess;
import java.util.Set;

/**
 * Ownership snapshots for acyclic JSON-like data. Maps and lists are recursively read-only; Jackson
 * trees are detached on ingress and on read. Nulls and scalar types are preserved. Other values are
 * opaque host-owned references: callers must keep them immutable for the lifetime of a snapshot.
 * Already-owned collections are shared, so unchanged payloads need not be traversed on each transition.
 */
public final class JsonSnapshots {
    private JsonSnapshots() {
    }

    /** Returns an owned map, preserving a null map and any null keys or values. */
    @SuppressWarnings("unchecked")
    public static <K, V> Map<K, V> map(Map<K, V> source) {
        return source == null ? null : (Map<K, V>) snapshot(source);
    }

    /** Returns an owned list, preserving a null list and any null elements. */
    @SuppressWarnings("unchecked")
    public static <T> List<T> list(List<T> source) {
        return source == null ? null : (List<T>) snapshot(source);
    }

    /** Merges non-null maps into an owned snapshot, sharing already-owned values without exposing trees. */
    @SuppressWarnings("unchecked")
    public static <K, V> Map<K, V> merge(Map<K, V> source, Map<K, V> additions) {
        Map<Object, Object> values = new LinkedHashMap<>(((SnapshotMap) map(source)).values);
        values.putAll(((SnapshotMap) map(additions)).values);
        return (Map<K, V>) new SnapshotMap(values);
    }

    private static Object snapshot(Object value) {
        if (value instanceof SnapshotMap || value instanceof SnapshotList) return value;
        if (value instanceof Map<?, ?> source) {
            Map<Object, Object> values = new LinkedHashMap<>();
            source.forEach((key, element) -> values.put(key, snapshot(element)));
            return new SnapshotMap(values);
        }
        if (value instanceof List<?> source) {
            List<Object> values = new ArrayList<>(source.size());
            source.forEach(element -> values.add(snapshot(element)));
            return new SnapshotList(values);
        }
        if (value instanceof JsonNode tree) return copyTree(tree);
        return value;
    }

    private static Object expose(Object value) {
        return value instanceof JsonNode tree ? copyTree(tree) : value;
    }

    private static JsonNode copyTree(JsonNode tree) {
        if (tree instanceof ObjectNode object) {
            ObjectNode copy = object.objectNode();
            object.properties().forEach(entry -> copy.set(entry.getKey(), copyTree(entry.getValue())));
            return copy;
        }
        if (tree instanceof ArrayNode array) {
            ArrayNode copy = array.arrayNode();
            array.forEach(element -> copy.add(copyTree(element)));
            return copy;
        }
        if (tree instanceof BinaryNode binary) return BinaryNode.valueOf(binary.binaryValue().clone());
        if (tree instanceof POJONode pojo) return new POJONode(snapshot(pojo.getPojo()));
        return tree.deepCopy();
    }

    private static final class SnapshotMap extends AbstractMap<Object, Object> {
        private final Map<Object, Object> values;
        private final Set<Entry<Object, Object>> entries;

        private SnapshotMap(Map<Object, Object> values) {
            this.values = values;
            this.entries = Collections.unmodifiableSet(new AbstractSet<>() {
                /** Returns detached entries without allowing iterator removal. */
                @Override
                public Iterator<Entry<Object, Object>> iterator() {
                    Iterator<Entry<Object, Object>> iterator = values.entrySet().iterator();
                    return new Iterator<>() {
                        /** Reports whether another entry exists. */
                        @Override
                        public boolean hasNext() { return iterator.hasNext(); }

                        /** Returns an immutable entry with a detached tree value. */
                        @Override
                        public Entry<Object, Object> next() {
                            Entry<Object, Object> entry = iterator.next();
                            return new SimpleImmutableEntry<>(entry.getKey(), expose(entry.getValue()));
                        }
                    };
                }

                /** Returns the number of entries. */
                @Override
                public int size() { return values.size(); }
            });
        }

        /** Returns a value, detaching Jackson trees from this snapshot. */
        @Override
        public Object get(Object key) { return expose(values.get(key)); }

        /** Checks presence without copying a tree value. */
        @Override
        public boolean containsKey(Object key) { return values.containsKey(key); }

        /** Returns entries whose values never expose an owned mutable tree. */
        @Override
        public Set<Entry<Object, Object>> entrySet() { return entries; }
    }

    private static final class SnapshotList extends AbstractList<Object> implements RandomAccess {
        private final List<Object> values;

        private SnapshotList(List<Object> values) { this.values = values; }

        /** Returns an element, detaching Jackson trees from this snapshot. */
        @Override
        public Object get(int index) { return expose(values.get(index)); }

        /** Returns the number of elements in this snapshot. */
        @Override
        public int size() { return values.size(); }
    }
}
