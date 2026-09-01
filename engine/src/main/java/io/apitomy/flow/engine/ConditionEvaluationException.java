package io.apitomy.flow.engine;

public class ConditionEvaluationException extends RuntimeException {
    private final String expression;

    public ConditionEvaluationException(String expression, Throwable cause) {
        super("Failed to evaluate condition: " + expression, cause);
        this.expression = expression;
    }

    /**
     * The condition expression that failed to evaluate.
     */
    public String expression() {
        return expression;
    }
}
