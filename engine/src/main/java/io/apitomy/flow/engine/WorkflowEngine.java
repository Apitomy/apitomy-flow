package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import io.apitomy.flow.validation.ValidationProblem;
import io.apitomy.flow.validation.WorkflowValidator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

public class WorkflowEngine {

    private static final Logger log = LoggerFactory.getLogger(WorkflowEngine.class);
    private static final int MAX_TRANSITIONS = 100;
    private static final int MAX_RETRIES = 10;

    private final NodeExecutorProvider executorProvider;
    private final List<WorkflowEventListener> listeners;
    private final WorkflowErrorHandler errorHandler;
    private final WorkflowValidator validator;
    private final ConditionEvaluator conditionEvaluator;

    public WorkflowEngine(NodeExecutorProvider executorProvider, List<WorkflowEventListener> listeners,
                          WorkflowErrorHandler errorHandler) {
        this.executorProvider = executorProvider != null ? executorProvider : actionType -> null;
        this.listeners = listeners != null ? listeners : List.of();
        this.errorHandler = errorHandler != null ? errorHandler : new DefaultErrorHandler();
        this.validator = new WorkflowValidator();
        this.conditionEvaluator = new ConditionEvaluator();
    }

    public WorkflowInstance startWorkflow(Workflow workflow, Map<String, Object> initialContext) {
        return startWorkflow(workflow, initialContext, UUID.randomUUID().toString());
    }

    public WorkflowInstance startWorkflow(Workflow workflow, Map<String, Object> initialContext,
                                          String instanceId) {
        // Validate definition
        List<ValidationProblem> problems = validator.validate(workflow);
        if (validator.hasErrors(problems)) {
            throw new WorkflowValidationException(problems);
        }

        // Find start node and validate inputs
        WorkflowNode startNode = workflow.findStartNode()
            .orElseThrow(() -> new IllegalStateException("No start node found"));
        validateInputs(startNode, initialContext);

        // Create instance
        Instant now = Instant.now();
        WorkflowInstance instance = WorkflowInstance.builder()
            .id(instanceId)
            .workflowId(workflow.id())
            .currentNodeId(startNode.id())
            .status(InstanceStatus.RUNNING)
            .context(new HashMap<>(initialContext))
            .createdOn(now)
            .updatedOn(now)
            .build();

        // Fire started event
        WorkflowInstance startedInstance = instance;
        fireEvent(l -> l.onWorkflowStarted(startedInstance));

        // Enter start node, add to history
        fireEvent(l -> l.onNodeEntered(startedInstance, startNode));
        instance = instance.toBuilder()
            .addHistory(new HistoryEntry(startNode.id(), startNode.name(),
                null, null, now, now, Map.of()))
            .build();

        // Advance through the graph
        return advance(workflow, instance);
    }

    public WorkflowInstance completeCurrentNode(Workflow workflow, WorkflowInstance instance,
                                                 NodeResult result) {
        if (instance.status() != InstanceStatus.WAITING) {
            throw new IllegalStateException(
                "Cannot complete node: instance is not in WAITING status (current: " + instance.status() + ")");
        }

        WorkflowNode currentNode = workflow.findNodeById(instance.currentNodeId())
            .orElseThrow(() -> new IllegalStateException("Current node not found: " + instance.currentNodeId()));

        // Record output on history, merge into context
        WorkflowInstance withHistory = completeCurrentHistoryEntry(instance, Instant.now(), result.output());
        WorkflowInstance updated = withHistory.toBuilder()
            .mergeContext(result.output())
            .status(InstanceStatus.RUNNING)
            .updatedOn(Instant.now())
            .build();

        // Fire completed event
        fireEvent(l -> l.onNodeCompleted(updated, currentNode, result));

        // Advance
        return advance(workflow, updated);
    }

    public WorkflowInstance cancelWorkflow(Workflow workflow, WorkflowInstance instance) {
        if (instance.status() == InstanceStatus.COMPLETED
                || instance.status() == InstanceStatus.FAILED
                || instance.status() == InstanceStatus.CANCELLED) {
            return instance;
        }

        WorkflowInstance cancelled = instance.toBuilder()
            .status(InstanceStatus.CANCELLED)
            .updatedOn(Instant.now())
            .build();
        fireEvent(l -> l.onWorkflowCancelled(cancelled));
        return cancelled;
    }

    public Object resolveExpression(String expression, Map<String, Object> context) {
        return conditionEvaluator.resolve(expression, context);
    }

    public HumanTaskInfo getHumanTaskInfo(Workflow workflow, WorkflowInstance instance) {
        if (instance.status() != InstanceStatus.WAITING) {
            return null;
        }
        WorkflowNode node = workflow.findNodeById(instance.currentNodeId()).orElse(null);
        if (node == null || node.type() != NodeType.HUMAN_TASK) {
            return null;
        }

        String description = node.config().get("description") instanceof String d ? d : null;

        Map<String, Object> resolvedInputs = new LinkedHashMap<>();
        if (node.config().get("inputs") instanceof Map<?, ?> inputExprs) {
            for (Map.Entry<?, ?> entry : inputExprs.entrySet()) {
                String label = String.valueOf(entry.getKey());
                String expression = String.valueOf(entry.getValue());
                try {
                    resolvedInputs.put(label, conditionEvaluator.resolve(expression, instance.context()));
                } catch (Exception e) {
                    log.warn("Failed to resolve human task input '{}': {}", label, e.getMessage());
                    resolvedInputs.put(label, null);
                }
            }
        }

        List<OutputDefinition> outputs = List.of();
        if (node.config().get("outputs") instanceof List<?> outputDefs) {
            outputs = outputDefs.stream()
                .filter(Map.class::isInstance)
                .map(o -> (Map<?, ?>) o)
                .map(o -> new OutputDefinition(
                    String.valueOf(o.get("name")),
                    o.get("type") != null ? String.valueOf(o.get("type")) : "string",
                    Boolean.TRUE.equals(o.get("required"))
                ))
                .toList();
        }

        return new HumanTaskInfo(node.id(), node.name(), description,
            Collections.unmodifiableMap(resolvedInputs), outputs);
    }

    public ReceiveEventInfo getReceiveEventInfo(Workflow workflow, WorkflowInstance instance) {
        if (instance.status() != InstanceStatus.WAITING) {
            return null;
        }
        WorkflowNode node = workflow.findNodeById(instance.currentNodeId()).orElse(null);
        if (node == null || node.type() != NodeType.RECEIVE_EVENT) {
            return null;
        }

        String eventType = node.config().get("eventType") instanceof String et ? et : null;

        List<String> matchExpressions = List.of();
        if (node.config().get("match") instanceof List<?> matchList) {
            matchExpressions = matchList.stream()
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .toList();
        }

        return new ReceiveEventInfo(node.id(), node.name(), eventType, matchExpressions);
    }

    public WaitInfo getWaitInfo(Workflow workflow, WorkflowInstance instance) {
        if (instance.status() != InstanceStatus.WAITING) {
            return null;
        }
        WorkflowNode node = workflow.findNodeById(instance.currentNodeId()).orElse(null);
        if (node == null || node.type() != NodeType.WAIT) {
            return null;
        }

        Duration duration = null;
        if (node.config().get("duration") instanceof String d) {
            try {
                duration = Duration.parse(d);
            } catch (Exception e) {
                log.warn("Invalid wait duration '{}': {}", d, e.getMessage());
            }
        }

        return new WaitInfo(node.id(), node.name(), duration);
    }

    public ActionInfo getActionInfo(Workflow workflow, WorkflowInstance instance) {
        if (instance.status() != InstanceStatus.WAITING) {
            return null;
        }
        WorkflowNode node = workflow.findNodeById(instance.currentNodeId()).orElse(null);
        if (node == null || node.type() != NodeType.ACTION) {
            return null;
        }

        String actionType = node.config().get("actionType") instanceof String at ? at : null;

        Map<String, Object> resolvedInputs = resolveNodeInputs(node, instance.context());

        List<OutputDefinition> expectedOutputs = List.of();
        if (node.config().get("outputs") instanceof List<?> outputDefs) {
            expectedOutputs = outputDefs.stream()
                .filter(Map.class::isInstance)
                .map(o -> (Map<?, ?>) o)
                .map(o -> new OutputDefinition(
                    String.valueOf(o.get("name")),
                    o.get("type") != null ? String.valueOf(o.get("type")) : "string",
                    Boolean.TRUE.equals(o.get("required"))
                ))
                .toList();
        }

        return new ActionInfo(node.id(), node.name(), actionType,
            resolvedInputs, expectedOutputs);
    }

    public boolean matchesEvent(Workflow workflow, WorkflowInstance instance, Map<String, Object> event) {
        if (instance.status() != InstanceStatus.WAITING) {
            return false;
        }

        WorkflowNode currentNode = workflow.findNodeById(instance.currentNodeId()).orElse(null);
        if (currentNode == null || currentNode.type() != NodeType.RECEIVE_EVENT) {
            return false;
        }

        // Check event type
        String expectedType = currentNode.config().get("eventType") instanceof String et ? et : null;
        if (expectedType == null) {
            return false;
        }
        Object actualType = event.get("type");
        if (!expectedType.equals(actualType)) {
            return false;
        }

        // Check match expressions
        Object matchConfig = currentNode.config().get("match");
        if (matchConfig instanceof List<?> matchExpressions) {
            for (Object expr : matchExpressions) {
                if (expr instanceof String expression) {
                    try {
                        if (!conditionEvaluator.evaluate(expression, instance.context(), event)) {
                            return false;
                        }
                    } catch (ConditionEvaluationException e) {
                        log.warn("Event match expression failed: {}", e.getMessage());
                        return false;
                    }
                }
            }
        }

        return true;
    }

    private WorkflowInstance advance(Workflow workflow, WorkflowInstance instance) {
        int transitions = 0;

        while (true) {
            if (transitions++ >= MAX_TRANSITIONS) {
                return failWorkflow(instance,
                    "Exceeded transition limit (" + MAX_TRANSITIONS + ") — possible infinite loop",
                    null);
            }

            WorkflowNode currentNode = workflow.findNodeById(instance.currentNodeId())
                .orElse(null);
            if (currentNode == null) {
                return failWorkflow(instance,
                    "Current node not found: " + instance.currentNodeId(), null);
            }

            // Check if we've entered the current node (has history entry)
            // If no history entry exists for current node, we transitioned here via error handler
            // and haven't entered the node yet - need to handle it directly
            boolean hasEnteredCurrentNode = !instance.history().isEmpty() &&
                instance.history().getLast().nodeId().equals(currentNode.id());

            // Handle nodes reached via error handler transition — these haven't
            // been entered yet (no history entry), so record entry before proceeding.
            if (!hasEnteredCurrentNode) {
                Instant entryTime = Instant.now();
                instance = completeCurrentHistoryEntry(instance, entryTime);
                instance = instance.toBuilder()
                    .addHistory(new HistoryEntry(currentNode.id(), currentNode.name(),
                        null, null, entryTime, null, null))
                    .updatedOn(entryTime)
                    .build();
                WorkflowInstance enteredInstance = instance;
                fireEvent(l -> l.onNodeEntered(enteredInstance, currentNode));

                switch (currentNode.type()) {
                    case END -> {
                        instance = instance.toBuilder()
                            .status(InstanceStatus.COMPLETED)
                            .updatedOn(Instant.now())
                            .build();
                        instance = completeCurrentHistoryEntry(instance, Instant.now());
                        WorkflowInstance completedInstance = instance;
                        fireEvent(l -> l.onWorkflowCompleted(completedInstance));
                        return instance;
                    }
                    case HUMAN_TASK, RECEIVE_EVENT, WAIT -> {
                        instance = instance.toBuilder()
                            .status(InstanceStatus.WAITING)
                            .updatedOn(Instant.now())
                            .build();
                        return instance;
                    }
                    case ACTION -> {
                        instance = executeActionNode(workflow, instance, currentNode);
                        if (instance.status() != InstanceStatus.RUNNING) return instance;
                    }
                    case START -> {
                        return failWorkflow(instance, "Cannot transition to START node", null);
                    }
                }
            }

            // For START and ACTION nodes, or nodes we've already entered, continue with normal edge selection
            WorkflowEdge selectedEdge = selectEdge(workflow, instance, currentNode);
            if (selectedEdge == null) {
                // No matching edge — call error handler
                ErrorResolution resolution;
                try {
                    resolution = errorHandler.handleNoMatchingEdge(instance, currentNode);
                } catch (Exception e) {
                    return failWorkflow(instance, "Error handler threw: " + e.getMessage(), e);
                }
                instance = applyResolution(workflow, instance, currentNode, resolution);
                if (instance.status() != InstanceStatus.RUNNING) return instance;
                continue;
            }

            // Fire edge event
            WorkflowInstance edgeInstance = instance;
            fireEvent(l -> l.onEdgeFollowed(edgeInstance, selectedEdge));

            // Transition to target node
            WorkflowNode targetNode = workflow.findNodeById(selectedEdge.target())
                .orElseThrow(() -> new IllegalStateException("Edge target not found: " + selectedEdge.target()));
            Instant now = Instant.now();

            // Mark current history entry as completed
            instance = completeCurrentHistoryEntry(instance, now);

            // Enter target node
            instance = instance.toBuilder()
                .currentNodeId(targetNode.id())
                .updatedOn(now)
                .addHistory(new HistoryEntry(targetNode.id(), targetNode.name(),
                    selectedEdge.id(), selectedEdge.condition(), now, null, null))
                .build();

            WorkflowInstance enteredInstance = instance;
            fireEvent(l -> l.onNodeEntered(enteredInstance, targetNode));

            // Execute based on node type
            switch (targetNode.type()) {
                case ACTION -> {
                    instance = executeActionNode(workflow, instance, targetNode);
                    if (instance.status() != InstanceStatus.RUNNING) return instance;
                }
                case HUMAN_TASK, RECEIVE_EVENT, WAIT -> {
                    instance = instance.toBuilder()
                        .status(InstanceStatus.WAITING)
                        .updatedOn(Instant.now())
                        .build();
                    return instance;
                }
                case END -> {
                    instance = instance.toBuilder()
                        .status(InstanceStatus.COMPLETED)
                        .updatedOn(Instant.now())
                        .build();
                    instance = completeCurrentHistoryEntry(instance, Instant.now());
                    WorkflowInstance completedInstance = instance;
                    fireEvent(l -> l.onWorkflowCompleted(completedInstance));
                    return instance;
                }
                default -> {
                    return failWorkflow(instance, "Unexpected node type: " + targetNode.type(), null);
                }
            }
        }
    }

    private WorkflowInstance executeActionNode(Workflow workflow, WorkflowInstance instance,
                                               WorkflowNode actionNode) {
        String actionType = actionNode.config().get("actionType") instanceof String at ? at : null;
        NodeExecutor executor = executorProvider.getExecutor(actionType);
        if (executor == null) {
            return failWorkflow(instance, "No executor found for action type: " + actionType, null);
        }

        Map<String, Object> resolvedInputs = resolveNodeInputs(actionNode, instance.context());
        int retries = 0;

        while (true) {
            NodeResult result;
            try {
                result = executor.execute(new NodeExecutionContext(
                    actionNode, resolvedInputs, actionNode.config()));
            } catch (Exception e) {
                ErrorResolution resolution;
                try {
                    resolution = errorHandler.handleNodeError(instance, actionNode, null, e);
                } catch (Exception handlerError) {
                    return failWorkflow(instance, "Error handler threw: " + handlerError.getMessage(), handlerError);
                }
                if (resolution.action() == ErrorAction.RETRY) {
                    if (++retries > MAX_RETRIES) {
                        log.error("Retry limit ({}) exceeded for action node: {}", MAX_RETRIES, actionNode.id());
                        return failWorkflow(instance,
                            "Exceeded retry limit (" + MAX_RETRIES + ") for action node: " + actionNode.id(), e);
                    }
                    continue;
                }
                return applyResolution(workflow, instance, actionNode, resolution);
            }

            if (result.status() == NodeResultStatus.FAILED) {
                ErrorResolution resolution;
                try {
                    resolution = errorHandler.handleNodeError(instance, actionNode, result, null);
                } catch (Exception handlerError) {
                    return failWorkflow(instance, "Error handler threw: " + handlerError.getMessage(), handlerError);
                }
                if (resolution.action() == ErrorAction.RETRY) {
                    if (++retries > MAX_RETRIES) {
                        log.error("Retry limit ({}) exceeded for action node: {}", MAX_RETRIES, actionNode.id());
                        return failWorkflow(instance,
                            "Exceeded retry limit (" + MAX_RETRIES + ") for action node: " + actionNode.id(), null);
                    }
                    continue;
                }
                return applyResolution(workflow, instance, actionNode, resolution);
            }

            if (result.status() == NodeResultStatus.PENDING) {
                if (result.output() != null && !result.output().isEmpty()) {
                    instance = instance.toBuilder()
                        .mergeContext(result.output())
                        .build();
                }
                return instance.toBuilder()
                    .status(InstanceStatus.WAITING)
                    .updatedOn(Instant.now())
                    .build();
            }

            // Validate output against declared schema
            String outputError = validateNodeOutputs(actionNode, result.output());
            if (outputError != null) {
                ErrorResolution resolution;
                try {
                    resolution = errorHandler.handleNodeError(instance, actionNode, result, null);
                } catch (Exception handlerError) {
                    return failWorkflow(instance, "Error handler threw: " + handlerError.getMessage(), handlerError);
                }
                if (resolution.action() == ErrorAction.RETRY) {
                    if (++retries > MAX_RETRIES) {
                        log.error("Retry limit ({}) exceeded for action node: {}", MAX_RETRIES, actionNode.id());
                        return failWorkflow(instance,
                            "Exceeded retry limit (" + MAX_RETRIES + ") for action node: " + actionNode.id(), null);
                    }
                    continue;
                }
                return applyResolution(workflow, instance, actionNode, resolution);
            }

            // Success — record output on history, merge into context, fire completed
            instance = completeCurrentHistoryEntry(instance, Instant.now(), result.output());
            instance = instance.toBuilder()
                .mergeContext(result.output())
                .updatedOn(Instant.now())
                .build();

            WorkflowInstance completedInstance = instance;
            fireEvent(l -> l.onNodeCompleted(completedInstance, actionNode, result));

            return instance;
        }
    }

    private WorkflowEdge selectEdge(Workflow workflow, WorkflowInstance instance,
                                     WorkflowNode node) {
        List<WorkflowEdge> outgoing = workflow.getOutgoingEdges(node.id());
        WorkflowEdge defaultEdge = null;

        for (WorkflowEdge edge : outgoing) {
            if (edge.isDefault()) {
                defaultEdge = edge;
                continue;
            }
            try {
                if (conditionEvaluator.evaluate(edge.condition(), instance.context())) {
                    return edge;
                }
            } catch (ConditionEvaluationException e) {
                log.warn("Condition evaluation failed for edge {}: {}", edge.id(), e.getMessage());
                // Treated as node error per spec
                return null;
            }
        }

        return defaultEdge;
    }

    private WorkflowInstance applyResolution(Workflow workflow, WorkflowInstance instance,
                                             WorkflowNode node, ErrorResolution resolution) {
        return switch (resolution.action()) {
            case FAIL -> failWorkflow(instance, "Workflow failed at node: " + node.id(), null);
            case RETRY -> instance;
            case TRANSITION -> {
                WorkflowNode target = workflow.findNodeById(resolution.targetNodeId())
                    .orElse(null);
                if (target == null) {
                    yield failWorkflow(instance,
                        "Error handler TRANSITION target not found: " + resolution.targetNodeId(), null);
                }
                yield instance.toBuilder()
                    .currentNodeId(target.id())
                    .updatedOn(Instant.now())
                    .build();
            }
        };
    }

    private WorkflowInstance failWorkflow(WorkflowInstance instance, String reason, Exception error) {
        WorkflowInstance failed = instance.toBuilder()
            .status(InstanceStatus.FAILED)
            .failureReason(reason)
            .updatedOn(Instant.now())
            .build();
        fireEvent(l -> l.onWorkflowFailed(failed, error));
        return failed;
    }

    private WorkflowInstance completeCurrentHistoryEntry(WorkflowInstance instance, Instant completedOn) {
        return completeCurrentHistoryEntry(instance, completedOn, null);
    }

    private WorkflowInstance completeCurrentHistoryEntry(WorkflowInstance instance, Instant completedOn,
                                                         Map<String, Object> output) {
        List<HistoryEntry> history = new ArrayList<>(instance.history());
        if (!history.isEmpty()) {
            HistoryEntry last = history.getLast();
            if (last.completedOn() == null) {
                history.set(history.size() - 1, new HistoryEntry(
                    last.nodeId(), last.nodeName(), last.edgeId(), last.edgeCondition(),
                    last.enteredOn(), completedOn, output != null ? output : last.output()));
            }
        }
        return instance.toBuilder().history(history).build();
    }

    private void fireEvent(java.util.function.Consumer<WorkflowEventListener> action) {
        for (WorkflowEventListener listener : listeners) {
            try {
                action.accept(listener);
            } catch (Exception e) {
                log.warn("Event listener threw exception", e);
            }
        }
    }

    private Map<String, Object> resolveNodeInputs(WorkflowNode node, Map<String, Object> context) {
        Object inputConfig = node.config().get("inputs");
        if (!(inputConfig instanceof Map<?, ?> inputExprs)) {
            return Map.of();
        }
        Map<String, Object> resolved = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : inputExprs.entrySet()) {
            String label = String.valueOf(entry.getKey());
            String expression = String.valueOf(entry.getValue());
            try {
                resolved.put(label, conditionEvaluator.resolve(expression, context));
            } catch (Exception e) {
                log.warn("Failed to resolve action input '{}': {}", label, e.getMessage());
                resolved.put(label, null);
            }
        }
        return Collections.unmodifiableMap(resolved);
    }

    private String validateNodeOutputs(WorkflowNode node, Map<String, Object> output) {
        Object outputConfig = node.config().get("outputs");
        if (!(outputConfig instanceof List<?> outputDefs)) {
            return null;
        }
        for (Object defObj : outputDefs) {
            if (defObj instanceof Map<?, ?> def) {
                String name = String.valueOf(def.get("name"));
                boolean required = Boolean.TRUE.equals(def.get("required"));
                if (required && (output == null || !output.containsKey(name) || output.get(name) == null)) {
                    return "Missing required output: " + name;
                }
            }
        }
        return null;
    }

    private void validateInputs(WorkflowNode startNode, Map<String, Object> initialContext) {
        if (initialContext == null) {
            initialContext = Map.of();
        }
        Object inputsDef = startNode.config().get("inputs");
        if (inputsDef instanceof List<?> inputs) {
            for (Object inputObj : inputs) {
                if (inputObj instanceof Map<?, ?> input) {
                    String name = (String) input.get("name");
                    Object required = input.get("required");
                    if (Boolean.TRUE.equals(required) && !initialContext.containsKey(name)) {
                        throw new IllegalArgumentException("Missing required input: " + name);
                    }
                    if (Boolean.TRUE.equals(required) && initialContext.get(name) == null) {
                        throw new IllegalArgumentException("Required input is null: " + name);
                    }
                }
            }
        }
    }
}
