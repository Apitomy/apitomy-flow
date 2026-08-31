package io.apitomy.flow.model;

import java.util.List;

/**
 * Definition of a single output produced by an action node or filled in when completing a
 * human-task node.
 *
 * <p>The first three fields ({@code name}, {@code type}, {@code required}) form the original,
 * always-present contract. The remaining fields carry optional authoring metadata used by
 * human-task nodes to render a richer completion form; they are {@code null} for action nodes and
 * for human-task outputs that declare only the minimal shape.</p>
 *
 * @param name         the context key the answer is stored under
 * @param type         the semantic type ({@code string}/{@code number}/{@code boolean}/{@code object})
 * @param required     whether the output must be provided to complete the task
 * @param label        human-readable field label; defaults to {@code name} when omitted
 * @param description  optional help/hint text shown under the field
 * @param widget       rendering hint ({@code text}/{@code textarea}/{@code select}); inferred from
 *                     {@code type} when omitted
 * @param defaultValue optional pre-filled value
 * @param options      choices for {@code widget: select}; {@code null} otherwise
 */
public record OutputDefinition(
    String name,
    String type,
    boolean required,
    String label,
    String description,
    String widget,
    Object defaultValue,
    List<OutputOption> options
) {
    /**
     * Backward-compatible constructor for the minimal {@code (name, type, required)} shape. Used by
     * action nodes and by human-task outputs that carry no presentation metadata; the optional
     * metadata fields default to {@code null}.
     *
     * @param name     the context key the answer is stored under
     * @param type     the semantic type
     * @param required whether the output must be provided
     */
    public OutputDefinition(String name, String type, boolean required) {
        this(name, type, required, null, null, null, null, null);
    }
}
