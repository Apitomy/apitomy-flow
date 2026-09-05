package io.apitomy.flow.model;

/**
 * A single live position in a running workflow — one concurrent branch (token). The engine holds a set
 * of these on the {@link WorkflowInstance}; a non-parallel workflow always has exactly one (the root).
 *
 * @param branchId a stable id for this branch; the root branch is {@code "root"}, fork children are
 *                 {@code "<parent>.<index>"}
 * @param nodeId   the id of the node this branch currently sits at
 */
public record ActiveBranch(String branchId, String nodeId) {}
