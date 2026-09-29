package io.apitomy.flow.model;

import java.util.List;
import java.util.Optional;

public record Workflow(
    String id,
    String name,
    String description,
    Integer version,
    List<WorkflowNode> nodes,
    List<WorkflowEdge> edges
) {
    /** Owns definition collections, including when constructed directly or deserialized. */
    public Workflow {
        nodes = JsonSnapshots.list(nodes == null ? List.of() : nodes);
        edges = JsonSnapshots.list(edges == null ? List.of() : edges);
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
