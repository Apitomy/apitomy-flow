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

    @Test
    void completingWithNoMappingsPreservesFlatMerge() {
        WorkflowEngine engine = engine();
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), receiveEventNode("wait", "order.created"), endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        WorkflowInstance completed = engine.completeNode(workflow, waiting, "wait",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("orderId", "ord-42", "storeId", "s1")));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("ord-42", completed.context().get("orderId"));
        assertEquals("s1", completed.context().get("storeId"));
    }

    @Test
    void completingWithMappingsStoresOnlyMappedContextKeys() {
        WorkflowEngine engine = engine();
        WorkflowNode receive = receiveEventNode("wait", "order.created", List.of(),
            List.of(Map.of("contextKey", "orderId", "expression", "event.payload.id")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        WorkflowInstance completed = engine.completeNode(workflow, waiting, "wait",
            new NodeResult(NodeResultStatus.COMPLETED,
                Map.of("payload", Map.of("id", "ord-42"), "storeId", "s1")));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("ord-42", completed.context().get("orderId"));
        assertNull(completed.context().get("storeId"), "unmapped raw event fields must not flat-merge");
        assertNull(completed.context().get("payload"), "unmapped raw event fields must not flat-merge");
    }

    @Test
    void mappingExpressionCanReferenceExistingContext() {
        WorkflowEngine engine = engine();
        WorkflowNode receive = receiveEventNode("wait", "order.created", List.of(),
            List.of(Map.of("contextKey", "region", "expression", "context.defaultRegion")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), receive, endNode("end")),
            List.of(edge("e1", "start", "wait"), edge("e2", "wait", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of("defaultRegion", "us-east"));

        WorkflowInstance completed = engine.completeNode(workflow, waiting, "wait",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("orderId", "ord-42")));

        assertEquals("us-east", completed.context().get("region"));
    }

    @Test
    void twoReceiveEventNodesOfTheSameTypeDoNotCollideWithDistinctContextKeys() {
        WorkflowEngine engine = engine();
        WorkflowNode first = receiveEventNode("first", "order.created", List.of(),
            List.of(Map.of("contextKey", "firstOrderId", "expression", "event.id")));
        WorkflowNode second = receiveEventNode("second", "order.created", List.of(),
            List.of(Map.of("contextKey", "secondOrderId", "expression", "event.id")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), first, second, endNode("end")),
            List.of(edge("e1", "start", "first"), edge("e2", "first", "second"), edge("e3", "second", "end")));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());

        WorkflowInstance afterFirst = engine.completeNode(workflow, waiting, "first",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("id", "A")));
        WorkflowInstance afterSecond = engine.completeNode(workflow, afterFirst, "second",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("id", "B")));

        assertEquals("A", afterSecond.context().get("firstOrderId"));
        assertEquals("B", afterSecond.context().get("secondOrderId"));
    }
}
