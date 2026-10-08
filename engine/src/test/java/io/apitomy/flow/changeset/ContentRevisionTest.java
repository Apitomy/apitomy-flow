package io.apitomy.flow.changeset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.apitomy.flow.model.Workflow;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Verifies {@link ContentRevision} against the shared conformance vectors. */
class ContentRevisionTest {

    private static final ObjectMapper MAPPER = new ObjectMapper().registerModule(new JavaTimeModule());

    record Vector(String name, JsonNode data) {
        @Override
        public String toString() {
            return name;
        }
    }

    static Stream<Vector> vectors() throws Exception {
        List<Vector> vectors = new ArrayList<>();
        MAPPER.readTree(Path.of("../conformance/content-revision.json").toFile())
            .forEach(data -> vectors.add(new Vector(data.path("name").asText(), data)));
        return vectors.stream();
    }

    @ParameterizedTest
    @MethodSource("vectors")
    void matchesSharedVector(Vector vector) {
        assertEquals(vector.data().path("revision").asText(), ContentRevision.of(vector.data().path("workflow")));
    }

    @Test
    void recordOverloadMatchesJsonOverload() throws Exception {
        JsonNode json = vectors().findFirst().orElseThrow().data().path("workflow");
        Workflow workflow = MAPPER.treeToValue(json, Workflow.class);
        assertEquals(ContentRevision.of(json), ContentRevision.of(workflow));
    }

    @Test
    void stripLayoutDoesNotMutateInput() throws Exception {
        JsonNode json = MAPPER.readTree("{\"nodes\":[{\"id\":\"a\",\"position\":{\"x\":1,\"y\":2}}]}");
        ContentRevision.stripLayout(json);
        assertFalse(json.path("nodes").get(0).path("position").isMissingNode());
    }
}
