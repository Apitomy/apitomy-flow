package io.apitomy.flow.spi;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@FunctionalInterface
public interface NodeExecutorProvider {

    NodeExecutor getExecutor(String actionType);

    static NodeExecutorProvider fromList(List<NodeExecutor> executors) {
        Map<String, NodeExecutor> map = new HashMap<>();
        for (NodeExecutor executor : executors) {
            map.put(executor.actionType(), executor);
        }
        return map::get;
    }

    static NodeExecutorProvider fromList(NodeExecutor... executors) {
        return fromList(List.of(executors));
    }
}
