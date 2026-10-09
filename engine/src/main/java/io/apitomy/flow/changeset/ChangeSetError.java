package io.apitomy.flow.changeset;

/**
 * Why a change set was rejected.
 *
 * @param code one of {@code target-missing}, {@code duplicate-id}, {@code edge-endpoint-missing},
 *             {@code malformed}, {@code read-only}, {@code stale}
 * @param opIndex index of the failing op, or {@code null} for whole-set failures
 * @param reason human-readable explanation
 */
public record ChangeSetError(String code, Integer opIndex, String reason) {
}
