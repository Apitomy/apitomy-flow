package io.apitomy.flow.spi;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@FunctionalInterface
public interface NodeExecutorProvider {

    /** Returns an executor for the action type, or null if unavailable. Exceptions enter engine recovery. */
    NodeExecutor getExecutor(String actionType);

    /**
     * Snapshots registrations in list order. Null list/elements and null/blank action types are rejected;
     * duplicate types fail at the second registration rather than silently replacing the first executor.
     * An exception from actionType() propagates to the registry caller before a workflow can execute.
     */
    static NodeExecutorProvider fromList(List<NodeExecutor> executors) {
        Objects.requireNonNull(executors, "executors must not be null");
        Map<String, NodeExecutor> map = new HashMap<>();
        for (NodeExecutor executor : executors) {
            Objects.requireNonNull(executor, "executor must not be null");
            String actionType = executor.actionType();
            if (actionType == null || actionType.isBlank()) {
                throw new IllegalArgumentException("Executor actionType must not be null or blank");
            }
            if (map.putIfAbsent(actionType, executor) != null) {
                throw new IllegalArgumentException("Duplicate executor actionType: " + actionType);
            }
        }
        return map::get;
    }

    /** Builds a registry with the same validation and ordering as {@link #fromList(List)}. */
    static NodeExecutorProvider fromList(NodeExecutor... executors) {
        return fromList(List.of(executors));
    }
}
