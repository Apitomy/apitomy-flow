package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.Map;

/**
 * A single node visit in a workflow instance's history.
 *
 * @param nodeId        the visited node id
 * @param nodeName      the visited node name
 * @param edgeId        the edge traversed to reach the node, if any
 * @param edgeCondition the condition of that edge, if any
 * @param enteredOn     when the node was entered
 * @param completedOn   when the node completed, or {@code null} while open
 * @param output        the output the node produced, or {@code null} when none was recorded
 * @param branchId      the branch this visit belongs to ({@code null} denotes the root branch)
 * @param input         the input values the node received on this visit, resolved at entry time:
 *                      declared workflow inputs for a start node, resolved {@code inputs} expressions
 *                      for action and human-task nodes; {@code null} when the node takes no inputs
 *                      or they could not be resolved
 */
public record HistoryEntry(
    String nodeId,
    String nodeName,
    String edgeId,
    String edgeCondition,
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant enteredOn,
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant completedOn,
    Map<String, Object> output,
    String branchId,
    @JsonInclude(JsonInclude.Include.NON_NULL) Map<String, Object> input
) {
    /** Owns output and input data while preserving null for an entry without them. */
    public HistoryEntry {
        output = JsonSnapshots.map(output);
        input = JsonSnapshots.map(input);
    }

    /**
     * Back-compat constructor for callers that predate input recording; sets {@code input} to
     * {@code null}.
     */
    public HistoryEntry(String nodeId, String nodeName, String edgeId, String edgeCondition,
                        Instant enteredOn, Instant completedOn, Map<String, Object> output, String branchId) {
        this(nodeId, nodeName, edgeId, edgeCondition, enteredOn, completedOn, output, branchId, null);
    }

    /**
     * Back-compat constructor for callers that predate branch attribution; sets {@code branchId} to
     * {@code null} (the root/non-parallel branch).
     */
    public HistoryEntry(String nodeId, String nodeName, String edgeId, String edgeCondition,
                        Instant enteredOn, Instant completedOn, Map<String, Object> output) {
        this(nodeId, nodeName, edgeId, edgeCondition, enteredOn, completedOn, output, null);
    }
}
