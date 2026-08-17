package io.apitomy.flow.spi;

public record ErrorResolution(
    ErrorAction action,
    String targetNodeId
) {
    public static ErrorResolution fail() {
        return new ErrorResolution(ErrorAction.FAIL, null);
    }

    public static ErrorResolution retry() {
        return new ErrorResolution(ErrorAction.RETRY, null);
    }

    public static ErrorResolution transitionTo(String nodeId) {
        return new ErrorResolution(ErrorAction.TRANSITION, nodeId);
    }
}
