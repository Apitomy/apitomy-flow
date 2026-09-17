package io.apitomy.flow.model;

/**
 * A single output mapping declared on a {@code receive-event} node: an EL {@code expression}
 * (evaluated against the {@code event} and {@code context} root beans) whose result is stored
 * under {@code contextKey} when the node's branch completes.
 *
 * @param contextKey the context key the computed value is stored under
 * @param expression the EL expression to evaluate
 */
public record EventOutputMapping(String contextKey, String expression) {}
