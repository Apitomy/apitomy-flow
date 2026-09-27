package io.apitomy.flow.model;

import java.util.Comparator;
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

    public Optional<WorkflowNode> findNodeById(String nodeId) {
        if (nodeId == null) return Optional.empty();
        return nodes.stream()
            .filter(n -> nodeId.equals(n.id()))
            .findFirst();
    }

    public Optional<WorkflowNode> findStartNode() {
        return nodes.stream()
            .filter(n -> n.type() == NodeType.START)
            .findFirst();
    }

    public List<WorkflowEdge> getOutgoingEdges(String nodeId) {
        if (nodeId == null) return List.of();
        return edges.stream()
            .filter(e -> nodeId.equals(e.source()))
            .sorted(Comparator.comparingInt(WorkflowEdge::priority))
            .toList();
    }

    public List<WorkflowEdge> getIncomingEdges(String nodeId) {
        if (nodeId == null) return List.of();
        return edges.stream()
            .filter(e -> nodeId.equals(e.target()))
            .toList();
    }
}
