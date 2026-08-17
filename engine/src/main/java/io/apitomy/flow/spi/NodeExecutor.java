package io.apitomy.flow.spi;

public interface NodeExecutor {
    String actionType();
    NodeResult execute(NodeExecutionContext context);
}
