package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests the optional {@code contextKey} override on output declarations: it's parsed into
 * {@link OutputDefinition#contextKey()} by {@link WorkflowEngine#getActionInfo} and
 * {@link WorkflowEngine#getHumanTaskInfo}, and the engine merges each output's value into the
 * instance context under its effective context key (the override when present, else the declared
 * output {@code name}) rather than always under {@code name}.
 */
class WorkflowEngineContextKeyTest {

    private WorkflowEngine engine(NodeExecutor... executors) {
        return new WorkflowEngine(NodeExecutorProvider.fromList(executors), List.of(), null);
    }

    @Test
    void actionNodeSuccessMergesOutputUnderContextKeyOverride() {
        NodeExecutor executor = new NodeExecutor() {
            public String actionType() { return "process"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("result", "42"));
            }
        };
        WorkflowEngine engine = engine(executor);
        WorkflowNode action = actionNode("action", "process", Map.of(),
            List.of(Map.of("name", "result", "type", "string", "required", true,
                "contextKey", "orderResult")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), action, endNode("end")),
            List.of(edge("e1", "start", "action"), edge("e2", "action", "end")));

        WorkflowInstance completed = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("42", completed.context().get("orderResult"));
        assertNull(completed.context().get("result"), "raw declared name must not also land in context");
    }

    @Test
    void actionNodeWithoutContextKeyMergesUnderDeclaredName() {
        NodeExecutor executor = new NodeExecutor() {
            public String actionType() { return "process"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("result", "42"));
            }
        };
        WorkflowEngine engine = engine(executor);
        WorkflowNode action = actionNode("action", "process", Map.of(),
            List.of(Map.of("name", "result", "type", "string", "required", true)));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), action, endNode("end")),
            List.of(edge("e1", "start", "action"), edge("e2", "action", "end")));

        WorkflowInstance completed = engine.startWorkflow(workflow, Map.of());

        assertEquals("42", completed.context().get("result"));
    }

    @Test
    void twoActionsOfSameTypeDoNotShadowEachOtherWithDistinctContextKeys() {
        NodeExecutor executor = new NodeExecutor() {
            public String actionType() { return "process"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("result", ctx.node().id()));
            }
        };
        WorkflowEngine engine = engine(executor);
        WorkflowNode first = actionNode("first", "process", Map.of(),
            List.of(Map.of("name", "result", "type", "string", "required", true, "contextKey", "firstResult")));
        WorkflowNode second = actionNode("second", "process", Map.of(),
            List.of(Map.of("name", "result", "type", "string", "required", true, "contextKey", "secondResult")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), first, second, endNode("end")),
            List.of(edge("e1", "start", "first"), edge("e2", "first", "second"), edge("e3", "second", "end")));

        WorkflowInstance completed = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals("first", completed.context().get("firstResult"));
        assertEquals("second", completed.context().get("secondResult"));
    }

    @Test
    void humanTaskCompletionMergesOutputUnderContextKeyOverride() {
        WorkflowEngine engine = engine();
        WorkflowNode task = humanTaskNode("task", "Approve", Map.of(),
            List.of(Map.of("name", "approved", "type", "boolean", "required", true,
                "contextKey", "managerApproved")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), task, endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance completed = engine.completeCurrentNode(workflow, waiting,
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("approved", true)));

        assertEquals(InstanceStatus.COMPLETED, completed.status());
        assertEquals(true, completed.context().get("managerApproved"));
        assertNull(completed.context().get("approved"));
    }

    @Test
    void getActionInfoParsesContextKey() {
        NodeExecutor executor = new NodeExecutor() {
            public String actionType() { return "process"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.PENDING, Map.of());
            }
        };
        WorkflowEngine engine = engine(executor);
        WorkflowNode action = actionNode("action", "process", Map.of(),
            List.of(Map.of("name", "result", "type", "string", "required", true, "contextKey", "orderResult")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), action, endNode("end")),
            List.of(edge("e1", "start", "action"), edge("e2", "action", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.WAITING, waiting.status());
        ActionInfo info = engine.getActionInfo(workflow, waiting, "action");

        assertEquals("orderResult", info.expectedOutputs().get(0).contextKey());
        assertEquals("orderResult", info.expectedOutputs().get(0).effectiveContextKey());
    }

    @Test
    void getHumanTaskInfoParsesContextKey() {
        WorkflowEngine engine = engine();
        WorkflowNode task = humanTaskNode("task", "Approve", Map.of(),
            List.of(Map.of("name", "approved", "type", "boolean", "required", true,
                "contextKey", "managerApproved")));
        Workflow workflow = new Workflow("wf", "W", null, null,
            List.of(startNode("start"), task, endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "task", "end")));

        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        HumanTaskInfo info = engine.getHumanTaskInfo(workflow, waiting);

        assertEquals("managerApproved", info.outputs().get(0).contextKey());
    }
}
