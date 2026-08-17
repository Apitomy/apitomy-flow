package io.apitomy.flow.validation;

public record ValidationProblem(
    ValidationSeverity severity,
    String code,
    String message,
    String nodeId,
    String edgeId
) {
    public static ValidationProblem error(String code, String message) {
        return new ValidationProblem(ValidationSeverity.ERROR, code, message, null, null);
    }

    public static ValidationProblem error(String code, String message, String nodeId) {
        return new ValidationProblem(ValidationSeverity.ERROR, code, message, nodeId, null);
    }

    public static ValidationProblem warning(String code, String message, String nodeId) {
        return new ValidationProblem(ValidationSeverity.WARNING, code, message, nodeId, null);
    }

    public static ValidationProblem edgeError(String code, String message, String edgeId) {
        return new ValidationProblem(ValidationSeverity.ERROR, code, message, null, edgeId);
    }

    public static ValidationProblem edgeWarning(String code, String message, String edgeId) {
        return new ValidationProblem(ValidationSeverity.WARNING, code, message, null, edgeId);
    }
}
