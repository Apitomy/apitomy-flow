package io.apitomy.flow.model;

import java.util.Comparator;
import java.util.List;

public record Workflow(
    String id,
    String name,
    String description,
    Integer version,
    List<WorkflowNode> nodes,
    List<WorkflowEdge> edges
) {
    public WorkflowNode findNodeById(String nodeId) {
        return nodes.stream()
            .filter(n -> n.id().equals(nodeId))
            .findFirst()
            .orElse(null);
    }

    public WorkflowNode findStartNode() {
        return nodes.stream()
            .filter(n -> n.type() == NodeType.START)
            .findFirst()
            .orElse(null);
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
