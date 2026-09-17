package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests the optional output-mapping declarations on receive-event nodes: parsing into
 * {@link ReceiveEventInfo#outputMappings()}, and (once wired in later tasks) merge-time
 * evaluation of each mapping's expression against the incoming event and context.
 */
class WorkflowEngineReceiveEventOutputMappingsTest {

    private WorkflowEngine engine() {
        return new WorkflowEngine(NodeExecutorProvider.fromList(), List.of(), null);
    }

    @Test
    void getReceiveEventInfoParsesOutputMappings() {
        WorkflowEngine engine = engine();
        WorkflowNode receive = receiveEventNode("wait", "order.created", List.of(),
            List.of(Map.of("contextKey", "orderId", "expression", "event.payload.id")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        ReceiveEventInfo info = engine.getReceiveEventInfo(workflow, waiting);

        assertEquals(1, info.outputMappings().size());
        assertEquals("orderId", info.outputMappings().get(0).contextKey());
        assertEquals("event.payload.id", info.outputMappings().get(0).expression());
    }

    @Test
    void getReceiveEventInfoReturnsEmptyOutputMappingsWhenNoneDeclared() {
        WorkflowEngine engine = engine();
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), receiveEventNode("wait", "order.created"), endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        ReceiveEventInfo info = engine.getReceiveEventInfo(workflow, waiting);

        assertTrue(info.outputMappings().isEmpty());
    }
}
