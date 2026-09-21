package io.apitomy.flow.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.nio.file.Path;
import io.apitomy.flow.validation.WorkflowValidator;

import static org.junit.jupiter.api.Assertions.*;

class NodeConfigTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void sharedInvalidConfigsAreRejectedBeforeTypedSemanticAccess() throws Exception {
        JsonNode cases = mapper.readTree(Path.of("../conformance/config-invalid-v1.json").toFile());
        for (JsonNode example : cases) {
            WorkflowNode node = new WorkflowNode("bad", mapper.treeToValue(example.get("type"), NodeType.class),
                "Bad", mapper.convertValue(example.get("config"),
                    new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {}), null);
            Workflow workflow = new Workflow("bad", "Bad", null, 1, List.of(node), List.of());
            assertTrue(new WorkflowValidator().validate(workflow).stream()
                .anyMatch(problem -> problem.code().equals(example.get("code").asText())));
        }
    }

    @Test
    void sharedExampleKeepsEveryConfigAndOptionalPosition() throws Exception {
        JsonNode fixture = mapper.readTree(Path.of("../conformance/config-v1.json").toFile());
        Workflow workflow = mapper.treeToValue(fixture.get("workflow"), Workflow.class);
        WorkflowValidator validator = new WorkflowValidator();
        assertFalse(validator.hasErrors(validator.validate(workflow)));
        assertNull(workflow.nodes().getFirst().position());
        assertNull(workflow.nodes().get(1).position());
        for (int i = 0; i < workflow.nodes().size(); i++) {
            WorkflowNode node = workflow.nodes().get(i);
            assertEquals(fixture.at("/workflow/nodes/" + i + "/config"), mapper.valueToTree(node.typedConfig()));
        }
        NodeConfig.HumanTask human = (NodeConfig.HumanTask) workflow.nodes().get(2).typedConfig();
        assertTrue(human.inputs().isEmpty());
        assertNull(human.outputs().getFirst().defaultValue());
        assertEquals("answer", human.outputs().getFirst().effectiveContextKey());
        assertEquals("renamed", ((NodeConfig.Action) workflow.nodes().get(1).typedConfig())
            .outputs().getFirst().effectiveContextKey());
    }

    @Test
    void adaptersPreserveWireNullsExtensionsAndDefaults() throws Exception {
        String json = """
            {"id":"a","type":"action","name":"Action","config":{
              "actionType":"host","inputs":{"literal":[null,true,42]},
              "outputs":[{"name":"result","type":null,"required":null,"x-field":{"a":1}}],
              "x-host":{"nested":[null,{"enabled":true}]}
            },"position":null}
            """;
        WorkflowNode node = mapper.readValue(json, WorkflowNode.class);
        NodeConfig.Action config = assertInstanceOf(NodeConfig.Action.class, node.typedConfig());
        assertEquals("host", config.actionType());
        assertEquals("string", config.outputs().getFirst().type());
        assertFalse(config.outputs().getFirst().required());
        assertEquals("result", config.outputs().getFirst().effectiveContextKey());
        assertEquals(mapper.readTree(json), mapper.readTree(mapper.writeValueAsString(node)));
        assertEquals(mapper.valueToTree(node.config()), mapper.valueToTree(config));
        NodeConfig.Action restored = mapper.readValue(mapper.writeValueAsString(config), NodeConfig.Action.class);
        assertEquals(config, restored);
        assertThrows(UnsupportedOperationException.class, () -> config.inputs().put("lost", 1));
    }

    @Test
    void perKindViewsExposeSupportedFieldsWithoutCoercion() {
        NodeConfig.Start start = new NodeConfig.Start(Map.of("inputs", List.of(Map.of("name", "id"))));
        assertEquals("id", start.inputs().getFirst().name());
        NodeConfig.HumanTask human = new NodeConfig.HumanTask(Map.of("description", "Review",
            "outputs", List.of(Map.of("name", "answer", "contextKey", "result", "options",
                List.of(Map.of("label", "Yes", "value", "yes"))))));
        assertEquals("Review", human.description());
        assertEquals("result", human.outputs().getFirst().effectiveContextKey());
        assertEquals("yes", human.outputs().getFirst().options().getFirst().value());
        NodeConfig.ReceiveEvent event = new NodeConfig.ReceiveEvent(Map.of("eventType", "done",
            "match", List.of("${event.id == context.id}"), "outputs",
            List.of(Map.of("contextKey", "result", "expression", "${event.value}"))));
        assertEquals("done", event.eventType());
        assertEquals(1, event.match().size());
        assertEquals("${event.value}", event.outputs().getFirst().expression());
        assertEquals("PT1S", new NodeConfig.Wait(Map.of("duration", "PT1S")).duration());
        assertThrows(IllegalArgumentException.class, () -> new NodeConfig.Wait(Map.of("duration", 1)).duration());
    }
}
