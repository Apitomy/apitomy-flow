package io.apitomy.flow.engine;

public class ConditionEvaluationException extends RuntimeException {
    public ConditionEvaluationException(String expression, Throwable cause) {
        super("Failed to evaluate condition: " + expression, cause);
    }
}
