package io.apitomy.flow.changeset;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.apitomy.flow.model.Workflow;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.erdtman.jcs.JsonCanonicalizer;

/**
 * Computes workflow content revisions identical to {@code computeContentRevision} in {@code @apitomy/flow-ui}:
 * {@code "sha256:" + hex(SHA-256(JCS(stripLayout(workflow))))}.
 */
public final class ContentRevision {

    private static final ObjectMapper MAPPER = new ObjectMapper()
        .registerModule(new JavaTimeModule())
        .setDefaultPropertyInclusion(
            JsonInclude.Value.construct(JsonInclude.Include.NON_NULL, JsonInclude.Include.ALWAYS));

    private ContentRevision() {
    }

    /**
     * Computes the revision of a workflow JSON document. Hosts must hash exactly the document sent to the
     * editor, without host-specific fields.
     *
     * @param workflow the workflow JSON object
     * @return the revision string, for example {@code sha256:e09f...}
     * @throws IllegalArgumentException if the document is not a JSON object
     */
    public static String of(JsonNode workflow) {
        if (workflow == null || !workflow.isObject()) {
            throw new IllegalArgumentException("workflow must be a JSON object");
        }
        try {
            String canonical = new JsonCanonicalizer(MAPPER.writeValueAsString(stripLayout(workflow)))
                .getEncodedString();
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8));
            return "sha256:" + HexFormat.of().formatHex(digest);
        } catch (IOException | NoSuchAlgorithmException e) {
            throw new IllegalStateException("Unable to compute content revision", e);
        }
    }

    /**
     * Computes the revision of a workflow record. Null record properties are omitted, as they would be
     * absent from the editor's JSON document; null values inside config maps are kept.
     *
     * @param workflow the workflow
     * @return the revision string
     */
    public static String of(Workflow workflow) {
        return of(MAPPER.valueToTree(workflow));
    }

    /**
     * Returns a deep copy of the workflow with {@code position} removed from every node.
     *
     * @param workflow the workflow JSON object
     * @return the stripped copy; the input is not mutated
     */
    public static ObjectNode stripLayout(JsonNode workflow) {
        ObjectNode copy = (ObjectNode) workflow.deepCopy();
        JsonNode nodes = copy.path("nodes");
        if (nodes.isArray()) {
            nodes.forEach(node -> {
                if (node instanceof ObjectNode object) {
                    object.remove("position");
                }
            });
        }
        return copy;
    }
}
