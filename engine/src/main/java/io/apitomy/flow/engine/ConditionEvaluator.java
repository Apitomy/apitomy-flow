package io.apitomy.flow.engine;

import jakarta.el.ELProcessor;
import java.util.Map;

public class ConditionEvaluator {

    public boolean evaluate(String expression, Map<String, Object> context) {
        if (expression == null || expression.isBlank()) {
            return true;
        }
        try {
            ELProcessor processor = new ELProcessor();
            processor.defineBean("context", context);
            Object result = processor.eval(expression);
            return Boolean.TRUE.equals(result);
        } catch (Exception e) {
            throw new ConditionEvaluationException(expression, e);
        }
    }

    public boolean evaluate(String expression, Map<String, Object> context, Map<String, Object> event) {
        if (expression == null || expression.isBlank()) {
            return true;
        }
        try {
            ELProcessor processor = new ELProcessor();
            processor.defineBean("context", context);
            processor.defineBean("event", event);
            Object result = processor.eval(expression);
            return Boolean.TRUE.equals(result);
        } catch (Exception e) {
            throw new ConditionEvaluationException(expression, e);
        }
    }

    public boolean isValid(String expression) {
        try {
            ELProcessor processor = new ELProcessor();
            processor.defineBean("context", Map.of());
            processor.getELManager().getExpressionFactory()
                .createValueExpression(processor.getELManager().getELContext(),
                    "${" + expression + "}", Object.class);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
