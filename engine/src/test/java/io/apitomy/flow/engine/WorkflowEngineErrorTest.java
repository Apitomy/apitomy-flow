package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests error handling in the workflow engine: default failure behavior for node errors
 * and executor exceptions, retry resolution, transition-to-error-node resolution,
 * invalid error transitions, error handler exceptions, and verification that the
 * handler receives the correct result or exception.
 */
class WorkflowEngineErrorTest {

    private NodeExecutor failingExecutor(String actionType) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.FAILED, Map.of("error", "something broke"));
            }
        };
    }

    private NodeExecutor throwingExecutor(String actionType) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                throw new RuntimeException("executor exploded");
            }
        };
    }

    @Test
    void defaultHandlerFailsWorkflowOnNodeError() {
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(failingExecutor("test")), List.of(), null);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertNotNull(result.failureReason());
    }

    @Test
    void defaultHandlerFailsWorkflowOnException() {
        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(throwingExecutor("test")), List.of(), null);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
    }

    @Test
    void retryReExecutesNode() {
        int[] callCount = {0};
        NodeExecutor retryableExecutor = new NodeExecutor() {
            public String actionType() { return "test"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                callCount[0]++;
                if (callCount[0] < 3) {
                    return new NodeResult(NodeResultStatus.FAILED, Map.of());
                }
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("done", true));
            }
        };

        WorkflowErrorHandler retryHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.retry();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(NodeExecutorProvider.fromList(retryableExecutor), List.of(), retryHandler);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(3, callCount[0]);
    }

    @Test
    void transitionToErrorNode() {
        WorkflowErrorHandler transitionHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("error-end");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        Workflow workflow = new Workflow("w", "W", null,
            List.of(startNode("start", List.of()), actionNode("a", "fail"), endNode("end"), endNode("error-end")),
            List.of(edge("e1", "start", "a"), edge("e2", "a", "end"), edge("e3", "a", "error-end")));

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("fail")), List.of(), transitionHandler);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals("error-end", result.currentNodeId());
    }

    @Test
    void transitionToInvalidNodeFailsWorkflow() {
        WorkflowErrorHandler badHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                return ErrorResolution.transitionTo("nonexistent");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("test")), List.of(), badHandler);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("not found"));
    }

    @Test
    void errorHandlerExceptionFailsWorkflow() {
        WorkflowErrorHandler explodingHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                throw new RuntimeException("handler exploded");
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                throw new RuntimeException("handler exploded");
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("test")), List.of(), explodingHandler);
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());

        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("Error handler threw"));
    }

    @Test
    void handleNodeErrorReceivesResultOnFailed() {
        NodeResult[] captured = {null};
        Exception[] capturedException = {null};

        WorkflowErrorHandler capturingHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                captured[0] = r;
                capturedException[0] = e;
                return ErrorResolution.fail();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(failingExecutor("test")), List.of(), capturingHandler);
        engine.startWorkflow(simpleActionWorkflow("test"), Map.of());

        assertNotNull(captured[0]);
        assertEquals(NodeResultStatus.FAILED, captured[0].status());
        assertNull(capturedException[0]);
    }

    @Test
    void handleNodeErrorReceivesExceptionOnThrow() {
        NodeResult[] captured = {null};
        Exception[] capturedException = {null};

        WorkflowErrorHandler capturingHandler = new WorkflowErrorHandler() {
            public ErrorResolution handleNodeError(WorkflowInstance i, WorkflowNode n,
                                                    NodeResult r, Exception e) {
                captured[0] = r;
                capturedException[0] = e;
                return ErrorResolution.fail();
            }
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance i, WorkflowNode n) {
                return ErrorResolution.fail();
            }
        };

        WorkflowEngine engine = new WorkflowEngine(
            NodeExecutorProvider.fromList(throwingExecutor("test")), List.of(), capturingHandler);
        engine.startWorkflow(simpleActionWorkflow("test"), Map.of());

        assertNull(captured[0]);
        assertNotNull(capturedException[0]);
        assertEquals("executor exploded", capturedException[0].getMessage());
    }
}
