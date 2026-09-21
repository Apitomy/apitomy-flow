package io.apitomy.flow.model;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Definition-owned topology only; never retains the workflow or interprets mutable host config values. */
final class WorkflowGraphIndex {
    private static final WeakIdentityCache<Workflow, WorkflowGraphIndex> CACHE = new WeakIdentityCache<>();
    final Map<String, WorkflowNode> nodes = new HashMap<>();
    final Map<String, List<WorkflowEdge>> outgoing = new HashMap<>();
    final Map<String, List<WorkflowEdge>> incoming = new HashMap<>();
    final WorkflowNode start;

    private WorkflowGraphIndex(Workflow workflow) {
        WorkflowNode firstStart = null;
        for (WorkflowNode node : workflow.nodes()) {
            // Malformed definitions are still constructible so preflight can report structured errors.
            if (node == null) continue;
            nodes.putIfAbsent(node.id(), node);
            if (firstStart == null && node.type() == NodeType.START) firstStart = node;
        }
        start = firstStart;
        for (WorkflowEdge edge : workflow.edges()) {
            if (edge == null) continue;
            outgoing.computeIfAbsent(edge.source(), ignored -> new ArrayList<>()).add(edge);
            incoming.computeIfAbsent(edge.target(), ignored -> new ArrayList<>()).add(edge);
        }
        outgoing.replaceAll((id, edges) -> edges.stream()
            .sorted(Comparator.comparingInt(WorkflowEdge::priority)).toList());
        incoming.replaceAll((id, edges) -> List.copyOf(edges));
    }

    static WorkflowGraphIndex of(Workflow workflow) {
        return CACHE.get(workflow, WorkflowGraphIndex::new);
    }
}
