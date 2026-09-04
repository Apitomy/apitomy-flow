package io.apitomy.flow.engine;

import io.apitomy.flow.model.NodeType;
import io.apitomy.flow.model.Workflow;
import io.apitomy.flow.model.WorkflowEdge;
import io.apitomy.flow.model.WorkflowNode;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Static structural analysis of a workflow's parallel regions. Classifies fork nodes (all-unconditional
 * multi-out), pairs each fork with its synchronizing join, and reports structural problems that make a
 * region ill-formed. Pure and side-effect free; shared by the validator and the engine so both agree on
 * what a fork is, what its join is, and what a well-formed region looks like.
 */
public final class ParallelRegions {

    /** A structural problem discovered during analysis. */
    public record Problem(String code, String nodeId) {}

    private final Set<String> forks;
    private final Map<String, String> forkToJoin;
    private final Set<String> joins;
    private final Map<String, Set<String>> joinIncomingEdgeIds;
    private final List<Problem> problems;

    private ParallelRegions(Set<String> forks, Map<String, String> forkToJoin, Set<String> joins,
                            Map<String, Set<String>> joinIncomingEdgeIds, List<Problem> problems) {
        this.forks = forks;
        this.forkToJoin = forkToJoin;
        this.joins = joins;
        this.joinIncomingEdgeIds = joinIncomingEdgeIds;
        this.problems = problems;
    }

    /**
     * Analyzes a workflow's parallel structure.
     *
     * @param workflow the workflow to analyze
     * @return the computed regions and any structural problems
     */
    public static ParallelRegions analyze(Workflow workflow) {
        Set<String> forks = new LinkedHashSet<>();
        Map<String, String> forkToJoin = new LinkedHashMap<>();
        Set<String> joins = new LinkedHashSet<>();
        Map<String, Set<String>> joinIncoming = new LinkedHashMap<>();
        List<Problem> problems = new ArrayList<>();

        for (WorkflowNode node : workflow.nodes()) {
            List<WorkflowEdge> outgoing = workflow.getOutgoingEdges(node.id());
            if (outgoing.size() < 2) {
                continue;
            }
            boolean anyUnconditionalNonDefault = outgoing.stream()
                .anyMatch(e -> isUnconditional(e) && !e.isDefault());
            boolean allUnconditionalNonDefault = outgoing.stream()
                .allMatch(e -> isUnconditional(e) && !e.isDefault());

            if (allUnconditionalNonDefault) {
                forks.add(node.id());
            } else if (anyUnconditionalNonDefault) {
                // mixes fork-shaped edges with conditional/default edges — ambiguous
                problems.add(new Problem("MIXED_FORK_EDGES", node.id()));
            }
        }

        for (String forkId : forks) {
            String join = findJoin(workflow, forkId, problems);
            if (join != null) {
                forkToJoin.put(forkId, join);
                joins.add(join);
                Set<String> incoming = new LinkedHashSet<>();
                for (WorkflowEdge e : workflow.getIncomingEdges(join)) {
                    incoming.add(e.id());
                }
                joinIncoming.put(join, incoming);
            }
        }

        return new ParallelRegions(forks, forkToJoin, joins, joinIncoming, problems);
    }

    private static boolean isUnconditional(WorkflowEdge e) {
        return e.condition() == null || e.condition().isBlank();
    }

    /**
     * Finds the synchronizing join for a fork: the first node where every branch leaving the fork
     * re-converges. Adds a {@code FORK_WITHOUT_JOIN} / {@code PARALLEL_BRANCH_REACHES_END} /
     * {@code UNBALANCED_PARALLEL} problem when no single balanced convergence node exists.
     */
    private static String findJoin(Workflow workflow, String forkId, List<Problem> problems) {
        List<WorkflowEdge> branches = workflow.getOutgoingEdges(forkId);
        List<Set<String>> reachablePerBranch = new ArrayList<>();
        boolean anyBranchReachesEnd = false;

        for (WorkflowEdge branch : branches) {
            Set<String> reachable = new LinkedHashSet<>();
            Deque<String> queue = new ArrayDeque<>();
            queue.add(branch.target());
            while (!queue.isEmpty()) {
                String current = queue.poll();
                if (!reachable.add(current)) {
                    continue;
                }
                WorkflowNode node = workflow.findNodeById(current).orElse(null);
                if (node != null && node.type() == NodeType.END) {
                    anyBranchReachesEnd = true;
                }
                for (WorkflowEdge out : workflow.getOutgoingEdges(current)) {
                    queue.add(out.target());
                }
            }
            reachablePerBranch.add(reachable);
        }

        // The join is the earliest node reachable from ALL branches.
        Set<String> common = new LinkedHashSet<>(reachablePerBranch.get(0));
        for (int i = 1; i < reachablePerBranch.size(); i++) {
            common.retainAll(reachablePerBranch.get(i));
        }
        if (common.isEmpty()) {
            problems.add(new Problem(anyBranchReachesEnd ? "PARALLEL_BRANCH_REACHES_END"
                : "FORK_WITHOUT_JOIN", forkId));
            return null;
        }

        // Earliest common node = the one whose incoming edges come from every branch. Choose the common
        // node reachable in the fewest steps from the fork along any branch (BFS order preserved above).
        String join = firstCommon(reachablePerBranch, common);

        // Balance check: every branch must reach the join without first hitting END.
        for (WorkflowEdge branch : branches) {
            if (reachesEndBeforeJoin(workflow, branch.target(), join)) {
                problems.add(new Problem("PARALLEL_BRANCH_REACHES_END", forkId));
                return null;
            }
        }
        return join;
    }

    private static String firstCommon(List<Set<String>> reachablePerBranch, Set<String> common) {
        // Use the first branch's insertion order (BFS) as the canonical ordering and return the first
        // element that is common to all branches.
        for (String candidate : reachablePerBranch.get(0)) {
            if (common.contains(candidate)) {
                return candidate;
            }
        }
        return common.iterator().next();
    }

    private static boolean reachesEndBeforeJoin(Workflow workflow, String start, String join) {
        Set<String> visited = new HashSet<>();
        Deque<String> queue = new ArrayDeque<>();
        queue.add(start);
        while (!queue.isEmpty()) {
            String current = queue.poll();
            if (current.equals(join) || !visited.add(current)) {
                continue;
            }
            WorkflowNode node = workflow.findNodeById(current).orElse(null);
            if (node != null && node.type() == NodeType.END) {
                return true;
            }
            for (WorkflowEdge out : workflow.getOutgoingEdges(current)) {
                queue.add(out.target());
            }
        }
        return false;
    }

    /** @return true if the node is a fork (all-unconditional, ≥2 outgoing edges). */
    public boolean isFork(String nodeId) { return forks.contains(nodeId); }

    /** @return true if the node is the synchronizing join of some fork. */
    public boolean isJoin(String nodeId) { return joins.contains(nodeId); }

    /** @return the join node id paired with the given fork, or {@code null} if none. */
    public String joinFor(String forkNodeId) { return forkToJoin.get(forkNodeId); }

    /** @return the incoming edge ids a join must collect before it fires. */
    public Set<String> incomingEdgeIds(String joinNodeId) {
        return joinIncomingEdgeIds.getOrDefault(joinNodeId, Set.of());
    }

    /** @return the structural problems discovered during analysis. */
    public List<Problem> problems() { return problems; }
}
