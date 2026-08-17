package io.apitomy.flow.validation;

import io.apitomy.flow.engine.ConditionEvaluator;
import io.apitomy.flow.model.*;

import java.util.*;
import java.util.stream.Collectors;

public class WorkflowValidator {

    private final ConditionEvaluator conditionEvaluator = new ConditionEvaluator();

    public List<ValidationProblem> validate(Workflow workflow) {
        List<ValidationProblem> problems = new ArrayList<>();
        validateStructure(workflow, problems);
        validateConnectivity(workflow, problems);
        validateEdgeConditions(workflow, problems);
        validateSemantics(workflow, problems);
        return problems;
    }

    public boolean hasErrors(List<ValidationProblem> problems) {
        return problems.stream().anyMatch(p -> p.severity() == ValidationSeverity.ERROR);
    }

    private void validateStructure(Workflow workflow, List<ValidationProblem> problems) {
        List<WorkflowNode> nodes = workflow.nodes();
        List<WorkflowEdge> edges = workflow.edges();
        Set<String> nodeIds = new HashSet<>();

        // Duplicate node IDs
        for (WorkflowNode node : nodes) {
            if (!nodeIds.add(node.id())) {
                problems.add(ValidationProblem.error("DUPLICATE_NODE_ID",
                    "Duplicate node ID: " + node.id(), node.id()));
            }
        }

        // Duplicate edge IDs
        Set<String> edgeIds = new HashSet<>();
        for (WorkflowEdge edge : edges) {
            if (!edgeIds.add(edge.id())) {
                problems.add(ValidationProblem.edgeError("DUPLICATE_EDGE_ID",
                    "Duplicate edge ID: " + edge.id(), edge.id()));
            }
        }

        // Start node checks
        List<WorkflowNode> startNodes = nodes.stream()
            .filter(n -> n.type() == NodeType.START).toList();
        if (startNodes.isEmpty()) {
            problems.add(ValidationProblem.error("NO_START_NODE", "No start node found"));
        } else if (startNodes.size() > 1) {
            problems.add(ValidationProblem.error("MULTIPLE_START_NODES",
                "Found " + startNodes.size() + " start nodes"));
        }

        // End node check
        boolean hasEnd = nodes.stream().anyMatch(n -> n.type() == NodeType.END);
        if (!hasEnd) {
            problems.add(ValidationProblem.error("NO_END_NODE", "No end node found"));
        }

        // Edge reference checks
        for (WorkflowEdge edge : edges) {
            if (!nodeIds.contains(edge.source())) {
                problems.add(ValidationProblem.edgeError("INVALID_EDGE_SOURCE",
                    "Edge " + edge.id() + " references nonexistent source: " + edge.source(), edge.id()));
            }
            if (!nodeIds.contains(edge.target())) {
                problems.add(ValidationProblem.edgeError("INVALID_EDGE_TARGET",
                    "Edge " + edge.id() + " references nonexistent target: " + edge.target(), edge.id()));
            }
        }

        // Start must not have incoming edges
        for (WorkflowNode start : startNodes) {
            boolean hasIncoming = edges.stream().anyMatch(e -> e.target().equals(start.id()));
            if (hasIncoming) {
                problems.add(ValidationProblem.error("START_HAS_INCOMING",
                    "Start node must not have incoming edges", start.id()));
            }
        }

        // End must not have outgoing edges
        nodes.stream().filter(n -> n.type() == NodeType.END).forEach(end -> {
            boolean hasOutgoing = edges.stream().anyMatch(e -> e.source().equals(end.id()));
            if (hasOutgoing) {
                problems.add(ValidationProblem.error("END_HAS_OUTGOING",
                    "End node must not have outgoing edges", end.id()));
            }
        });

        // Action nodes must have actionType
        nodes.stream().filter(n -> n.type() == NodeType.ACTION).forEach(action -> {
            if (!action.config().containsKey("actionType")) {
                problems.add(ValidationProblem.error("MISSING_ACTION_TYPE",
                    "Action node missing actionType in config", action.id()));
            }
        });
    }

    private void validateConnectivity(Workflow workflow, List<ValidationProblem> problems) {
        List<WorkflowNode> nodes = workflow.nodes();
        List<WorkflowEdge> edges = workflow.edges();

        for (WorkflowNode node : nodes) {
            List<WorkflowEdge> incoming = workflow.getIncomingEdges(node.id());
            List<WorkflowEdge> outgoing = workflow.getOutgoingEdges(node.id());

            // Disconnected node (no incoming AND no outgoing, except start)
            if (node.type() != NodeType.START && incoming.isEmpty() && outgoing.isEmpty()) {
                problems.add(ValidationProblem.error("DISCONNECTED_NODE",
                    "Node is completely disconnected", node.id()));
                continue;
            }

            // No outgoing edges (except end)
            if (node.type() != NodeType.END && outgoing.isEmpty()) {
                problems.add(ValidationProblem.error("NO_OUTGOING_EDGES",
                    "Non-end node has no outgoing edges", node.id()));
            }

            // No incoming edges (except start)
            if (node.type() != NodeType.START && incoming.isEmpty()) {
                problems.add(ValidationProblem.warning("NO_INCOMING_EDGES",
                    "Node has no incoming edges — unreachable", node.id()));
            }
        }

        // Unreachable from start (BFS)
        WorkflowNode startNode = workflow.findStartNode();
        if (startNode != null) {
            Set<String> reachable = new HashSet<>();
            Queue<String> queue = new LinkedList<>();
            queue.add(startNode.id());
            while (!queue.isEmpty()) {
                String current = queue.poll();
                if (reachable.add(current)) {
                    edges.stream().filter(e -> e.source().equals(current))
                        .map(WorkflowEdge::target).forEach(queue::add);
                }
            }
            for (WorkflowNode node : nodes) {
                if (!reachable.contains(node.id()) && node.type() != NodeType.START) {
                    problems.add(ValidationProblem.warning("UNREACHABLE_NODE",
                        "Node cannot be reached from start", node.id()));
                }
            }

            // No path to end (reverse BFS from all end nodes)
            Set<String> canReachEnd = new HashSet<>();
            Queue<String> reverseQueue = new LinkedList<>();
            nodes.stream().filter(n -> n.type() == NodeType.END)
                .map(WorkflowNode::id).forEach(id -> { reverseQueue.add(id); canReachEnd.add(id); });
            while (!reverseQueue.isEmpty()) {
                String current = reverseQueue.poll();
                edges.stream().filter(e -> e.target().equals(current))
                    .map(WorkflowEdge::source)
                    .filter(canReachEnd::add)
                    .forEach(reverseQueue::add);
            }
            for (WorkflowNode node : nodes) {
                if (reachable.contains(node.id()) && !canReachEnd.contains(node.id())
                        && node.type() != NodeType.END) {
                    problems.add(ValidationProblem.warning("NO_PATH_TO_END",
                        "Node has no path to any end node", node.id()));
                }
            }
        }
    }

    private void validateEdgeConditions(Workflow workflow, List<ValidationProblem> problems) {
        Map<String, List<WorkflowEdge>> edgesBySource = workflow.edges().stream()
            .collect(Collectors.groupingBy(WorkflowEdge::source));

        for (var entry : edgesBySource.entrySet()) {
            List<WorkflowEdge> outgoing = entry.getValue();
            if (outgoing.size() <= 1) continue;

            // Multiple default edges
            List<WorkflowEdge> defaults = outgoing.stream().filter(WorkflowEdge::isDefault).toList();
            if (defaults.size() > 1) {
                problems.add(ValidationProblem.warning("MULTIPLE_DEFAULT_EDGES",
                    "Node has multiple default edges", entry.getKey()));
            }

            // No default edge when there are conditional edges
            boolean hasConditional = outgoing.stream()
                .anyMatch(e -> e.condition() != null && !e.condition().isBlank());
            if (hasConditional && defaults.isEmpty()) {
                problems.add(ValidationProblem.warning("NO_DEFAULT_EDGE",
                    "Node has conditional edges but no default fallback", entry.getKey()));
            }

            // No conditions at all on multiple edges
            boolean allUnconditional = outgoing.stream()
                .allMatch(e -> e.condition() == null || e.condition().isBlank());
            if (allUnconditional && defaults.isEmpty()) {
                problems.add(ValidationProblem.warning("UNCONDITIONAL_MULTIPLE_EDGES",
                    "Node has multiple outgoing edges with no conditions", entry.getKey()));
            }

            // Duplicate priorities
            Map<Integer, Long> priorityCounts = outgoing.stream()
                .collect(Collectors.groupingBy(WorkflowEdge::priority, Collectors.counting()));
            priorityCounts.entrySet().stream().filter(e -> e.getValue() > 1).forEach(e ->
                problems.add(ValidationProblem.edgeWarning("DUPLICATE_EDGE_PRIORITY",
                    "Multiple edges from node " + entry.getKey() + " share priority " + e.getKey(),
                    entry.getKey())));
        }

        // Invalid EL conditions
        for (WorkflowEdge edge : workflow.edges()) {
            if (edge.condition() != null && !edge.condition().isBlank()) {
                if (!conditionEvaluator.isValid(edge.condition())) {
                    problems.add(ValidationProblem.edgeWarning("INVALID_CONDITION",
                        "Edge condition is not valid EL: " + edge.condition(), edge.id()));
                }
            }
        }
    }

    private void validateSemantics(Workflow workflow, List<ValidationProblem> problems) {
        // Missing event type on receive-event nodes
        workflow.nodes().stream()
            .filter(n -> n.type() == NodeType.RECEIVE_EVENT)
            .forEach(node -> {
                if (!node.config().containsKey("eventType")) {
                    problems.add(ValidationProblem.warning("MISSING_EVENT_TYPE",
                        "Receive-event node has no eventType configured", node.id()));
                }
            });

        // Duplicate event receivers
        List<WorkflowNode> receivers = workflow.nodes().stream()
            .filter(n -> n.type() == NodeType.RECEIVE_EVENT)
            .filter(n -> n.config().containsKey("eventType"))
            .toList();
        for (int i = 0; i < receivers.size(); i++) {
            for (int j = i + 1; j < receivers.size(); j++) {
                if (hasSameEventConfig(receivers.get(i), receivers.get(j))) {
                    problems.add(ValidationProblem.warning("DUPLICATE_EVENT_RECEIVER",
                        "Multiple receive-event nodes match the same events",
                        receivers.get(j).id()));
                }
            }
        }

        // Missing start inputs
        WorkflowNode start = workflow.findStartNode();
        if (start != null && !start.config().containsKey("inputs")) {
            problems.add(ValidationProblem.warning("MISSING_START_INPUTS",
                "Start node has no inputs defined", start.id()));
        }

        // Automated cycles (cycles with only action nodes)
        detectAutomatedCycles(workflow, problems);
    }

    private boolean hasSameEventConfig(WorkflowNode a, WorkflowNode b) {
        Object typeA = a.config().get("eventType");
        Object typeB = b.config().get("eventType");
        if (!Objects.equals(typeA, typeB)) return false;
        Object matchA = a.config().get("match");
        Object matchB = b.config().get("match");
        return Objects.equals(matchA, matchB);
    }

    private void detectAutomatedCycles(Workflow workflow, List<ValidationProblem> problems) {
        // Find cycles using DFS, then check if any cycle contains only action nodes
        Set<String> actionNodeIds = workflow.nodes().stream()
            .filter(n -> n.type() == NodeType.ACTION)
            .map(WorkflowNode::id).collect(Collectors.toSet());

        Set<String> visited = new HashSet<>();
        Set<String> inStack = new HashSet<>();

        for (WorkflowNode node : workflow.nodes()) {
            if (node.type() == NodeType.ACTION && !visited.contains(node.id())) {
                if (hasAutomatedCycle(workflow, node.id(), actionNodeIds, visited, inStack)) {
                    problems.add(ValidationProblem.warning("AUTOMATED_CYCLE",
                        "Cycle detected containing only action nodes", node.id()));
                    return;
                }
            }
        }
    }

    private boolean hasAutomatedCycle(Workflow workflow, String nodeId, Set<String> actionNodeIds,
                                      Set<String> visited, Set<String> inStack) {
        visited.add(nodeId);
        inStack.add(nodeId);
        for (WorkflowEdge edge : workflow.getOutgoingEdges(nodeId)) {
            String target = edge.target();
            if (!actionNodeIds.contains(target)) continue;
            if (inStack.contains(target)) return true;
            if (!visited.contains(target) && hasAutomatedCycle(workflow, target, actionNodeIds, visited, inStack)) {
                return true;
            }
        }
        inStack.remove(nodeId);
        return false;
    }
}
