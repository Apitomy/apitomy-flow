package io.apitomy.flow.model;

import java.util.List;
import java.util.Map;

/**
 * Describes a parked human task so a host can present it, e.g. as an item in a task inbox.
 *
 * @param nodeId      the human-task node id
 * @param nodeName    the human-task node name
 * @param description the task instructions, or {@code null}
 * @param inputs      the resolved input values to show the assignee
 * @param outputs     the form fields the assignee completes
 * @param title       the task title (e.g. an inbox subject): the node's {@code title} expression resolved
 *                    against the instance context, or the node name when no title is configured or it
 *                    cannot be resolved to a non-null value; never {@code null} when the node name is set
 * @param body        the task body as raw markdown: the node's {@code body} template with its embedded
 *                    {@code ${...}} expressions resolved against the instance context, or the description
 *                    when no body is configured or the template cannot be parsed; may be {@code null}.
 *                    The value is not escaped or sanitized — hosts are responsible for rendering it safely
 */
public record HumanTaskInfo(
    String nodeId,
    String nodeName,
    String description,
    Map<String, Object> inputs,
    List<OutputDefinition> outputs,
    String title,
    String body
) {
    /**
     * Back-compat constructor for callers that predate task titles; the title is the node name and the body
     * is the description.
     *
     * @param nodeId      the human-task node id
     * @param nodeName    the human-task node name, also used as the title
     * @param description the task instructions, or {@code null}; also used as the body
     * @param inputs      the resolved input values
     * @param outputs     the form fields
     */
    public HumanTaskInfo(String nodeId, String nodeName, String description, Map<String, Object> inputs,
                         List<OutputDefinition> outputs) {
        this(nodeId, nodeName, description, inputs, outputs, nodeName, description);
    }

    /**
     * Back-compat constructor for callers that predate task bodies; the body is the description.
     *
     * @param nodeId      the human-task node id
     * @param nodeName    the human-task node name
     * @param description the task instructions, or {@code null}; also used as the body
     * @param inputs      the resolved input values
     * @param outputs     the form fields
     * @param title       the task title
     */
    public HumanTaskInfo(String nodeId, String nodeName, String description, Map<String, Object> inputs,
                         List<OutputDefinition> outputs, String title) {
        this(nodeId, nodeName, description, inputs, outputs, title, description);
    }
}
