package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.Map;
import java.util.Optional;

public record Workflow(
    String id,
    String name,
    String description,
    Integer version,
    List<WorkflowNode> nodes,
    List<WorkflowEdge> edges,
    @JsonInclude(JsonInclude.Include.NON_NULL) Map<String, Object> defaults
) {
    /** Owns definition collections, including when constructed directly or deserialized. */
    public Workflow {
        nodes = JsonSnapshots.list(nodes == null ? List.of() : nodes);
        edges = JsonSnapshots.list(edges == null ? List.of() : edges);
        defaults = defaults == null ? null : JsonSnapshots.map(defaults);
    }

    /** Back-compat constructor for definitions without workflow-level defaults. */
    public Workflow(String id, String name, String description, Integer version,
                    List<WorkflowNode> nodes, List<WorkflowEdge> edges) {
        this(id, name, description, version, nodes, edges, null);
    }

    /**
     * Returns the workflow-level default retry policy ({@code defaults.retry}), if declared.
     *
     * @return the default policy, or empty
     * @throws IllegalArgumentException if {@code defaults.retry} is present but not an object
     */
    @SuppressWarnings("unchecked")
    public Optional<RetryPolicy> defaultRetryPolicy() {
        Object retry = defaults == null ? null : defaults.get("retry");
        if (retry == null) return Optional.empty();
        if (retry instanceof Map<?, ?> map) return Optional.of(new RetryPolicy((Map<String, Object>) map));
        throw new IllegalArgumentException("defaults.retry must be an object");
    }

    /** Finds the first declared node with this id using the immutable definition's topology index. */
    public Optional<WorkflowNode> findNodeById(String nodeId) {
        if (nodeId == null) return Optional.empty();
        return Optional.ofNullable(WorkflowGraphIndex.of(this).nodes.get(nodeId));
    }

    /** Returns the first declared start node. */
    public Optional<WorkflowNode> findStartNode() {
        return Optional.ofNullable(WorkflowGraphIndex.of(this).start);
    }

    /** Returns immutable priority-sorted outgoing adjacency; ties retain definition order. */
    public List<WorkflowEdge> getOutgoingEdges(String nodeId) {
        if (nodeId == null) return List.of();
        return WorkflowGraphIndex.of(this).outgoing.getOrDefault(nodeId, List.of());
    }

    /** Returns immutable incoming adjacency in definition order (the existing join contract). */
    public List<WorkflowEdge> getIncomingEdges(String nodeId) {
        if (nodeId == null) return List.of();
        return WorkflowGraphIndex.of(this).incoming.getOrDefault(nodeId, List.of());
    }
}
