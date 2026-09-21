package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowEngineStructuredErrorTest {
    @ParameterizedTest
    @ValueSource(strings = {"input", "output", "edge", "mapping", "execution", "lookup", "no-edge"})
    void structuredCallbackAndFailureListenerRetainIdentityAndCause(String path) {
        AtomicReference<WorkflowError> captured = new AtomicReference<>();
        AtomicReference<Exception> notified = new AtomicReference<>();
        IllegalStateException cause = new IllegalStateException("host unavailable");
        WorkflowErrorHandler handler = new DefaultErrorHandler() {
            /** Exercises the additive callback without replacing the legacy SPI. */
            public ErrorResolution handleError(WorkflowInstance instance, WorkflowNode node,
                                               NodeResult result, WorkflowError error) {
                captured.set(error);
                return ErrorResolution.fail();
            }
        };
        WorkflowEventListener listener = new WorkflowEventListener() {
            /** Captures the final diagnostic for an observational failure sink. */
            public void onWorkflowFailed(WorkflowInstance instance, Exception error) { notified.set(error); }
        };
        NodeExecutorProvider executors = path.equals("lookup") ? type -> { throw cause; }
            : provider(context -> {
                if (path.equals("execution")) throw cause;
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
            });
        Workflow workflow = actionWorkflow(path.equals("input") ? Map.of("amount", "1 +") : Map.of(),
            path.equals("output") ? List.of(inputDef("receipt", "string", true)) : List.of());
        if (path.equals("edge") || path.equals("no-edge")) {
            workflow = new Workflow("w", "W", null, null, List.of(startNode("start"), endNode("end")),
                List.of(edge("bad-edge", "start", "end", path.equals("edge") ? "1 +" : "false", 0)));
        } else if (path.equals("mapping")) {
            workflow = new Workflow("w", "W", null, null,
                List.of(startNode("start"), receiveEventNode("event", "approved", List.of(),
                    List.of(Map.of("contextKey", "amount", "expression", "event.amount + 1"))), endNode("end")),
                List.of(edge("start-event", "start", "event"), edge("event-end", "event", "end")));
        }
        WorkflowEngine engine = new WorkflowEngine(executors, List.of(listener), handler);
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        if (path.equals("mapping")) result = engine.completeNode(workflow, result, "event",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("amount", "bad")));
        WorkflowError error = captured.get();
        assertNotNull(error);
        assertSame(error, notified.get());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains(error.phase().name()));
        assertTrue(result.failureReason().contains(error.nodeId()));
        switch (path) {
            case "input" -> {
                assertEquals(WorkflowError.Phase.INPUT_RESOLUTION, error.phase());
                assertEquals("amount", error.field());
                assertEquals("1 +", error.expression());
                assertInstanceOf(ConditionEvaluationException.class, error.getCause());
            }
            case "output" -> {
                assertEquals(WorkflowError.Phase.OUTPUT_VALIDATION, error.phase());
                assertEquals("receipt", error.field());
            }
            case "edge" -> {
                assertEquals(WorkflowError.Phase.EDGE_CONDITION, error.phase());
                assertEquals("bad-edge", error.edgeId());
                assertEquals("1 +", error.expression());
                assertTrue(result.failureReason().contains("bad-edge"));
                assertInstanceOf(ConditionEvaluationException.class, error.getCause());
            }
            case "mapping" -> {
                assertEquals(WorkflowError.Phase.OUTPUT_MAPPING, error.phase());
                assertEquals("event", error.nodeId());
                assertEquals("amount", error.field());
                assertEquals("event.amount + 1", error.expression());
                assertInstanceOf(ConditionEvaluationException.class, error.getCause());
            }
            case "no-edge" -> assertEquals(WorkflowError.Phase.EDGE_SELECTION, error.phase());
            default -> {
                assertEquals(path.equals("lookup") ? WorkflowError.Phase.EXECUTOR_LOOKUP
                    : WorkflowError.Phase.EXECUTION, error.phase());
                assertSame(cause, error.getCause());
                assertTrue(result.failureReason().contains("host unavailable"));
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"fail", "retry", "transition"})
    void invalidHumanInputsAreRecoverableOnEntryWithoutWakingSibling(String recovery) {
        AtomicInteger errors = new AtomicInteger();
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), humanTaskNode("sibling"),
                new WorkflowNode("human", NodeType.HUMAN_TASK, "Human", Map.of("inputs", Map.of("amount", "1 +")), null),
                humanTaskNode("repair"), endNode("end")),
            List.of(edge("start-sibling", "start", "sibling"), edge("start-human", "start", "human"),
                edge("human-repair", "human", "repair"), edge("repair-end", "repair", "end"),
                edge("sibling-end", "sibling", "end")));
        WorkflowEngine engine = new WorkflowEngine(null, List.of(), handler(error -> {
            assertNotNull(error);
            assertTrue(error.getMessage().contains("1 +"));
            int count = errors.incrementAndGet();
            return count > 150 ? ErrorResolution.fail() : switch (recovery) {
                case "retry" -> ErrorResolution.retry();
                case "transition" -> ErrorResolution.transitionTo("repair");
                default -> ErrorResolution.fail();
            };
        }));
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        assertEquals(recovery.equals("transition") ? InstanceStatus.WAITING : InstanceStatus.FAILED, result.status());
        assertTrue(errors.get() > 0 && errors.get() <= 100);
        assertNull(result.history().stream().filter(entry -> entry.nodeId().equals("sibling"))
            .findFirst().orElseThrow().completedOn());
        assertTrue(result.activeBranches().stream().anyMatch(branch -> branch.nodeId().equals("sibling")));
        if (recovery.equals("retry")) {
            assertTrue(result.failureReason().contains("transition limit"));
            assertTrue(result.failureReason().contains("amount"), result.failureReason());
            assertTrue(result.failureReason().contains("1 +"), result.failureReason());
        }
        if (recovery.equals("transition")) assertNotNull(engine.getHumanTaskInfo(workflow, result, "repair"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "null-status"})
    void malformedExternalCompletionIsRecoverableAndDoesNotMergeOutput(String kind) {
        WorkflowEngine engine = new WorkflowEngine(provider(context -> new NodeResult(NodeResultStatus.PENDING, null)),
            List.of(), handler(error -> ErrorResolution.transitionTo("end")));
        Workflow workflow = simpleActionWorkflow("test");
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance result = assertDoesNotThrow(() -> engine.completeNode(workflow, waiting, "action",
            kind.equals("null") ? null : new NodeResult(null, Map.of("leaked", true))));
        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertFalse(result.context().containsKey("leaked"));
    }

    @Test
    void malformedHumanCompletionRetryAwaitsAnotherDelivery() {
        Workflow workflow = new Workflow("w", "W", null, null,
            List.of(startNode("start"), humanTaskNode("human"), endNode("end")),
            List.of(edge("sh", "start", "human"), edge("he", "human", "end")));
        WorkflowEngine engine = new WorkflowEngine(null, List.of(), handler(error -> ErrorResolution.retry()));
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        WorkflowInstance retried = engine.completeNode(workflow, waiting, "human", null);
        assertEquals(waiting, retried);
        assertEquals(InstanceStatus.COMPLETED, engine.completeNode(workflow, retried, "human",
            new NodeResult(NodeResultStatus.COMPLETED, null)).status());
    }

    @Test
    void listenerRegistrationIsSnapshottedAndRejectsNullEntries() {
        List<String> events = new ArrayList<>();
        List<WorkflowEventListener> listeners = new ArrayList<>();
        listeners.add(new WorkflowEventListener() {
            /** Observes start without changing engine registration. */
            public void onWorkflowStarted(WorkflowInstance instance) { events.add("started"); }
        });
        WorkflowEngine engine = new WorkflowEngine(provider(context -> new NodeResult(NodeResultStatus.COMPLETED, null)),
            listeners, null);
        listeners.clear();
        assertEquals(InstanceStatus.COMPLETED, engine.startWorkflow(simpleActionWorkflow("test"), Map.of()).status());
        assertEquals(List.of("started"), events);
        assertThrows(NullPointerException.class,
            () -> new WorkflowEngine(null, java.util.Arrays.asList((WorkflowEventListener) null), null));
    }

    @Test
    void nestedCauseMessageSurvivesFinalStateAndHandlerFailure() {
        AtomicReference<Exception> notified = new AtomicReference<>();
        IllegalArgumentException root = new IllegalArgumentException("remote account rejected");
        IllegalStateException original = new IllegalStateException("payment failed", root);
        IllegalStateException handlerFailure = new IllegalStateException("recovery offline");
        WorkflowEngine engine = new WorkflowEngine(provider(context -> { throw original; }),
            List.of(new WorkflowEventListener() {
                /** Records the failure tree for inspection. */
                public void onWorkflowFailed(WorkflowInstance instance, Exception error) { notified.set(error); }
            }), handler(error -> { throw handlerFailure; }));
        WorkflowInstance result = engine.startWorkflow(simpleActionWorkflow("test"), Map.of());
        assertTrue(result.failureReason().contains("remote account rejected"), result.failureReason());
        WorkflowError error = assertInstanceOf(WorkflowError.class, notified.get());
        assertSame(handlerFailure, error.getCause());
        assertSame(original, error.getSuppressed()[0].getCause());
    }

    @Test
    void executorThrownStructuredErrorStillIdentifiesExecutingNode() {
        WorkflowError hostError = new WorkflowError(WorkflowError.Phase.OUTPUT_MAPPING, "other", null, null,
            "hostField", "remote mapping failed", null);
        AtomicReference<WorkflowError> captured = new AtomicReference<>();
        WorkflowEngine engine = new WorkflowEngine(provider(context -> { throw hostError; }), List.of(),
            new DefaultErrorHandler() {
                /** Verifies engine context is not replaced by a host exception's unrelated identity. */
                public ErrorResolution handleError(WorkflowInstance instance, WorkflowNode node,
                                                   NodeResult result, WorkflowError error) {
                    captured.set(error);
                    return ErrorResolution.fail();
                }
            });
        assertEquals(InstanceStatus.FAILED, engine.startWorkflow(simpleActionWorkflow("test"), Map.of()).status());
        assertEquals(WorkflowError.Phase.EXECUTION, captured.get().phase());
        assertEquals("action", captured.get().nodeId());
        assertSame(hostError, captured.get().getCause());
    }

    @Test
    void legitimateNullInputIsNotAnExpressionFailure() {
        WorkflowEngine engine = new WorkflowEngine(provider(context -> {
            assertTrue(context.inputs().containsKey("optional"));
            assertNull(context.inputs().get("optional"));
            return new NodeResult(NodeResultStatus.COMPLETED, null);
        }), List.of(), null);
        assertEquals(InstanceStatus.COMPLETED, engine.startWorkflow(
            actionWorkflow(Map.of("optional", "context.missing"), List.of()), Map.of()).status());
    }

    @ParameterizedTest
    @ValueSource(strings = {"retry", "transition"})
    void actionInputRecoveryIsBoundedAndNeverExecutesInvalidInputs(String recovery) {
        AtomicInteger calls = new AtomicInteger();
        AtomicInteger errors = new AtomicInteger();
        WorkflowEngine engine = new WorkflowEngine(provider(context -> {
            calls.incrementAndGet();
            return new NodeResult(NodeResultStatus.COMPLETED, null);
        }), List.of(), handler(error -> {
            errors.incrementAndGet();
            return recovery.equals("retry") ? ErrorResolution.retry() : ErrorResolution.transitionTo("end");
        }));
        WorkflowInstance result = engine.startWorkflow(actionWorkflow(Map.of("amount", "1 +"), List.of()), Map.of());
        assertEquals(0, calls.get());
        assertEquals(recovery.equals("retry") ? InstanceStatus.FAILED : InstanceStatus.COMPLETED, result.status());
        assertEquals(recovery.equals("retry") ? 11 : 1, errors.get());
        if (recovery.equals("retry")) assertTrue(result.failureReason().contains("amount"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null-key", "numeric-key"})
    @SuppressWarnings({"rawtypes", "unchecked"})
    void malformedOutputKeysCannotLeakOrEscapeRecovery(String kind) {
        Map output = new HashMap();
        output.put(kind.equals("null-key") ? null : 42, "value");
        WorkflowEngine engine = new WorkflowEngine(provider(context -> new NodeResult(NodeResultStatus.COMPLETED, output)),
            List.of(), null);
        WorkflowInstance result = assertDoesNotThrow(() -> engine.startWorkflow(simpleActionWorkflow("test"), Map.of()));
        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("RESULT_VALIDATION"));
        assertTrue(result.context().isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"null-actionType", "blank-actionType", "null-element", "null-list"})
    void malformedRegistrationsAreRejectedBeforeExecution(String kind) {
        NodeExecutor executor = new NodeExecutor() {
            /** Supplies an invalid registry key. */
            public String actionType() { return kind.equals("null-actionType") ? null : " "; }
            /** Must not be invoked during registration. */
            public NodeResult execute(NodeExecutionContext context) { throw new AssertionError("executed"); }
        };
        assertThrows(RuntimeException.class, () -> NodeExecutorProvider.fromList(
            kind.equals("null-list") ? (List<NodeExecutor>) null
                : kind.equals("null-element") ? java.util.Arrays.asList((NodeExecutor) null) : List.of(executor)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"edge", "no-edge", "mapping"})
    void invalidRecoveryIsCheckedAcrossRoutingAndCompletionPaths(String path) {
        Workflow workflow = path.equals("mapping")
            ? new Workflow("w", "W", null, null,
                List.of(startNode("start"), receiveEventNode("event", "approved", List.of(),
                    List.of(Map.of("contextKey", "amount", "expression", "event.amount + 1"))), endNode("end")),
                List.of(edge("se", "start", "event"), edge("ee", "event", "end")))
            : new Workflow("w", "W", null, null, List.of(startNode("start"), endNode("end")),
                List.of(edge("bad", "start", "end", path.equals("edge") ? "1 +" : "false", 0)));
        WorkflowEngine engine = new WorkflowEngine(null, List.of(), handler(error -> null));
        WorkflowInstance result = assertDoesNotThrow(() -> engine.startWorkflow(workflow, Map.of()));
        if (path.equals("mapping")) {
            WorkflowInstance waiting = result;
            result = assertDoesNotThrow(() -> engine.completeNode(workflow, waiting, "event",
                new NodeResult(NodeResultStatus.COMPLETED, Map.of("amount", "bad"))));
        }
        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("ERROR_HANDLER"));
        assertTrue(result.failureReason().contains(path.equals("mapping") ? "amount"
            : path.equals("edge") ? "bad" : "No matching outgoing edge"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"action", "human"})
    void readOnlyInputIntrospectionReportsFailureWithoutMutatingParkedState(String kind) {
        WorkflowNode node = kind.equals("action") ? actionNode("node", "test") : humanTaskNode("node");
        Workflow workflow = new Workflow("w", "W", null, null, List.of(startNode("start"), node, endNode("end")),
            List.of(edge("sn", "start", "node"), edge("ne", "node", "end")));
        WorkflowEngine engine = new WorkflowEngine(provider(context -> new NodeResult(NodeResultStatus.PENDING, null)),
            List.of(), null);
        WorkflowInstance waiting = engine.startWorkflow(workflow, Map.of());
        WorkflowNode changed = new WorkflowNode("node", node.type(), "Node",
            Map.of("actionType", "test", "inputs", Map.of("amount", "1 +")), null);
        Workflow revised = new Workflow("w", "W", null, null, List.of(startNode("start"), changed, endNode("end")),
            workflow.edges());
        WorkflowError error = assertThrows(WorkflowError.class, () -> {
            if (kind.equals("action")) engine.getActionInfo(revised, waiting, "node");
            else engine.getHumanTaskInfo(revised, waiting, "node");
        });
        assertEquals("amount", error.field());
        assertEquals(InstanceStatus.WAITING, waiting.status());
        assertNull(waiting.history().getLast().completedOn());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void missingRequiredOutputReachesLegacyHandlerAndFinalState(boolean async) {
        AtomicReference<Exception> captured = new AtomicReference<>();
        Workflow workflow = actionWorkflow(Map.of(), List.of(inputDef("receipt", "string", true)));
        WorkflowEngine engine = new WorkflowEngine(provider(context -> new NodeResult(
            async ? NodeResultStatus.PENDING : NodeResultStatus.COMPLETED, Map.of())), List.of(),
            handler(error -> { captured.set(error); return ErrorResolution.fail(); }));
        WorkflowInstance result = engine.startWorkflow(workflow, Map.of());
        if (async) result = engine.completeNode(workflow, result, "action", new NodeResult(NodeResultStatus.COMPLETED, Map.of()));
        assertEquals(InstanceStatus.FAILED, result.status());
        assertNotNull(captured.get(), "Validation must supply a diagnostic to legacy handlers");
        assertTrue(captured.get().getMessage().contains("receipt"));
        assertTrue(result.failureReason().contains("receipt"), result.failureReason());
        assertTrue(result.failureReason().contains("action"));
    }

    @Test
    void invalidInputFailsBeforeExecutorSideEffects() {
        AtomicInteger calls = new AtomicInteger();
        WorkflowEngine engine = new WorkflowEngine(provider(context -> {
            calls.incrementAndGet();
            return new NodeResult(NodeResultStatus.COMPLETED, Map.of());
        }), List.of(), null);
        WorkflowInstance result = engine.startWorkflow(actionWorkflow(Map.of("amount", "1 +"), List.of()), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
        assertEquals(0, calls.get());
        assertTrue(result.failureReason().contains("amount"));
        assertTrue(result.failureReason().contains("1 +"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null-result", "null-status", "provider-throw", "missing-executor", "executor-throw"})
    void invalidExtensionsBecomeRecoverableFailures(String scenario) {
        AtomicInteger handled = new AtomicInteger();
        NodeExecutorProvider executors = switch (scenario) {
            case "provider-throw" -> type -> { throw new IllegalStateException("registry offline"); };
            case "missing-executor" -> type -> null;
            default -> provider(context -> {
                if (scenario.equals("executor-throw")) throw new IllegalStateException("service offline");
                return scenario.equals("null-result") ? null : new NodeResult(null, Map.of("leaked", true));
            });
        };
        WorkflowEngine engine = new WorkflowEngine(executors, List.of(), handler(error -> {
            handled.incrementAndGet();
            return ErrorResolution.transitionTo("end");
        }));
        WorkflowInstance result = assertDoesNotThrow(() -> engine.startWorkflow(simpleActionWorkflow("test"), Map.of()));
        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(1, handled.get());
        assertFalse(result.context().containsKey("leaked"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "null-action", "null-target", "blank-target", "unknown-target", "extra-target", "throw"})
    void malformedHandlerResponsesFailWithOriginalDiagnostic(String scenario) {
        WorkflowErrorHandler handler = handler(error -> switch (scenario) {
            case "null" -> null;
            case "null-action" -> new ErrorResolution(null, null);
            case "null-target" -> new ErrorResolution(ErrorAction.TRANSITION, null);
            case "blank-target" -> ErrorResolution.transitionTo(" ");
            case "unknown-target" -> ErrorResolution.transitionTo("unknown");
            case "extra-target" -> new ErrorResolution(ErrorAction.FAIL, "end");
            default -> throw new IllegalStateException("handler offline");
        });
        WorkflowEngine engine = new WorkflowEngine(provider(context -> {
            throw new IllegalStateException("payment unavailable");
        }), List.of(), handler);
        WorkflowInstance result = assertDoesNotThrow(() -> engine.startWorkflow(simpleActionWorkflow("test"), Map.of()));
        assertEquals(InstanceStatus.FAILED, result.status());
        assertTrue(result.failureReason().contains("payment unavailable"), result.failureReason());
        assertTrue(result.failureReason().contains("ERROR_HANDLER"), result.failureReason());
    }

    @Test
    void duplicateExecutorsAreRejectedInsteadOfOverwriting() {
        NodeExecutor executor = executor(context -> new NodeResult(NodeResultStatus.COMPLETED, Map.of()));
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
            () -> NodeExecutorProvider.fromList(executor, executor));
        assertTrue(error.getMessage().contains("test"));
        assertTrue(error.getMessage().contains("Duplicate"));
    }

    @Test
    void throwingListenersDoNotStopLaterListenersOrExecution() {
        List<String> events = new ArrayList<>();
        WorkflowEventListener throwing = new WorkflowEventListener() {
            /** Simulates an observational sink failure. */
            public void onNodeEntered(WorkflowInstance instance, WorkflowNode node) {
                events.add("first:" + node.id());
                throw new IllegalStateException("sink offline");
            }
        };
        WorkflowEventListener following = new WorkflowEventListener() {
            /** Records dispatch ordering after another listener fails. */
            public void onNodeEntered(WorkflowInstance instance, WorkflowNode node) {
                events.add("second:" + node.id());
            }
        };
        WorkflowEngine engine = new WorkflowEngine(provider(context -> new NodeResult(NodeResultStatus.COMPLETED, null)),
            List.of(throwing, following), null);
        WorkflowInstance result = engine.startWorkflow(simpleActionWorkflow("test"), null);
        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(List.of("first:start", "second:start", "first:action", "second:action", "first:end", "second:end"), events);
    }

    private Workflow actionWorkflow(Map<String, String> inputs, List<Map<String, Object>> outputs) {
        return new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("action", "test", inputs, outputs), endNode("end")),
            List.of(edge("start-action", "start", "action"), edge("action-end", "action", "end")));
    }

    private NodeExecutorProvider provider(Function<NodeExecutionContext, NodeResult> execute) {
        return NodeExecutorProvider.fromList(executor(execute));
    }

    private NodeExecutor executor(Function<NodeExecutionContext, NodeResult> execute) {
        return new NodeExecutor() {
            /** Returns this fixture's action type. */
            public String actionType() { return "test"; }
            /** Supplies a host response to the real engine. */
            public NodeResult execute(NodeExecutionContext context) { return execute.apply(context); }
        };
    }

    private WorkflowErrorHandler handler(Function<Exception, ErrorResolution> recover) {
        return new WorkflowErrorHandler() {
            /** Chooses recovery using the legacy exception contract. */
            public ErrorResolution handleNodeError(WorkflowInstance instance, WorkflowNode node,
                                                    NodeResult result, Exception error) {
                return recover.apply(error);
            }
            /** Chooses recovery for a routing failure. */
            public ErrorResolution handleNoMatchingEdge(WorkflowInstance instance, WorkflowNode node) {
                return recover.apply(null);
            }
        };
    }
}
