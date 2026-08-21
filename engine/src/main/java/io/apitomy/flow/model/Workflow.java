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
    public Workflow {
        if (nodes == null) nodes = List.of();
        if (edges == null) edges = List.of();
    }

    public Optional<WorkflowNode> findNodeById(String nodeId) {
        return nodes.stream()
            .filter(n -> n.id().equals(nodeId))
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
