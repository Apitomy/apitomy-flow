package io.apitomy.flow.engine;

import io.apitomy.flow.validation.ValidationProblem;
import java.util.List;

public class WorkflowValidationException extends RuntimeException {
    private final List<ValidationProblem> problems;

    public WorkflowValidationException(List<ValidationProblem> problems) {
        super("Workflow validation failed: " + problems.stream()
            .map(ValidationProblem::message).toList());
        this.problems = problems;
    }

    public List<ValidationProblem> getProblems() { return problems; }
}
