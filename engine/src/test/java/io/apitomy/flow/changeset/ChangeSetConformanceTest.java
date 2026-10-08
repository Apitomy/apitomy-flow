package io.apitomy.flow.changeset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Runs the shared change-set vectors against {@link ChangeSets}. */
class ChangeSetConformanceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static JsonNode fixtures;

    record Case(String name, JsonNode data) {
        @Override
        public String toString() {
            return name;
        }
    }

    static Stream<Case> cases() throws Exception {
        fixtures = MAPPER.readTree(Path.of("../conformance/changesets.json").toFile());
        List<Case> cases = new ArrayList<>();
        fixtures.path("cases").forEach(data -> cases.add(new Case(data.path("name").asText(), data)));
        return cases.stream();
    }

    @ParameterizedTest
    @MethodSource("cases")
    void matchesSharedVector(Case fixture) {
        JsonNode input = fixtures.path("workflows").path(fixture.data().path("workflow").asText());
        ObjectNode changeSet = (ObjectNode) fixture.data().path("changeSet").deepCopy();
        if ("@current".equals(changeSet.path("baseRevision").asText())) {
            changeSet.put("baseRevision", ContentRevision.of(input));
        }
        ChangeSetResult result = ChangeSets.applyChecked(input, changeSet);
        JsonNode expected = fixture.data().path("expected");
        if (!expected.isMissingNode()) {
            ChangeSetResult.Applied applied = assertInstanceOf(ChangeSetResult.Applied.class, result, result::toString);
            assertEquals(ContentRevision.stripLayout(expected), ContentRevision.stripLayout(applied.workflow()));
        } else {
            ChangeSetResult.Rejected rejected = assertInstanceOf(ChangeSetResult.Rejected.class, result);
            JsonNode error = fixture.data().path("error");
            assertEquals(error.path("code").asText(), rejected.error().code());
            assertEquals(error.has("opIndex") ? error.path("opIndex").asInt() : null, rejected.error().opIndex());
        }
    }

    @Test
    void doesNotMutateInput() throws Exception {
        JsonNode input = MAPPER.readTree("{\"id\":\"w\",\"name\":\"W\",\"nodes\":[{\"id\":\"s\",\"type\":\"start\","
            + "\"name\":\"S\",\"config\":{}}],\"edges\":[]}");
        JsonNode before = input.deepCopy();
        ChangeSets.apply(input, MAPPER.readTree("{\"ops\":[{\"op\":\"removeNode\",\"id\":\"s\"}]}"));
        assertEquals(before, input);
    }

    /**
     * A null or non-object change set is malformed, checked before the revision.
     */
    @Test
    void nonObjectChangeSetIsMalformed() throws Exception {
        JsonNode workflow = MAPPER.readTree("{\"id\":\"w\",\"nodes\":[],\"edges\":[]}");
        for (JsonNode changeSet : new JsonNode[] {null, MAPPER.readTree("\"x\""), MAPPER.readTree("[]")}) {
            ChangeSetResult.Rejected rejected = assertInstanceOf(ChangeSetResult.Rejected.class,
                ChangeSets.applyChecked(workflow, changeSet));
            assertEquals("malformed", rejected.error().code());
            assertEquals(null, rejected.error().opIndex());
        }
    }
}
