package io.apitomy.flow.changeset;

import com.fasterxml.jackson.databind.node.ObjectNode;

/** Outcome of applying a change set. */
public sealed interface ChangeSetResult permits ChangeSetResult.Applied, ChangeSetResult.Rejected {

    /**
     * The change set applied cleanly.
     *
     * @param workflow the resulting workflow document
     */
    record Applied(ObjectNode workflow) implements ChangeSetResult {
    }

    /**
     * The change set was rejected and nothing changed.
     *
     * @param error the failure
     */
    record Rejected(ChangeSetError error) implements ChangeSetResult {
    }
}
