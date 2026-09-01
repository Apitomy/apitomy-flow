package io.apitomy.flow.model;

/**
 * A single selectable choice for a human-task output rendered with the {@code select} widget.
 *
 * @param label the human-readable text shown to the person completing the task
 * @param value the value stored in the workflow context when this option is chosen
 */
public record OutputOption(
    String label,
    String value
) {}
