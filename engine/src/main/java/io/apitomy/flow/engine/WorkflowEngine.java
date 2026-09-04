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
        if (initialContext == null) {
            initialContext = Map.of();
        }

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
            .addActiveBranch(new ActiveBranch("root", startNode.id()))
            .createdOn(now)
            .updatedOn(now)
            .build();

        // Fire started event
        WorkflowInstance startedInstance = instance;
        fireEvent(l -> l.onWorkflowStarted(startedInstance));

        // Enter start node, add to history (attributed to the root branch)
        fireEvent(l -> l.onNodeEntered(startedInstance, startNode));
        instance = instance.toBuilder()
            .addHistory(new HistoryEntry(startNode.id(), startNode.name(),
                null, null, now, now, Map.of(), "root"))
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

        // A FAILED result must route through the same error-handling semantics as the
        // synchronous action path (error handler + retry + failWorkflow), otherwise a
        // failed async action would silently drive the instance to COMPLETED.
        if (result.status() == NodeResultStatus.FAILED) {
            return handleFailedCompletion(workflow, instance, currentNode, result);
        }

        // A PENDING result re-parks the instance in WAITING (optionally merging output),
        // allowing the outcome to be delivered again later.
        if (result.status() == NodeResultStatus.PENDING) {
            WorkflowInstance reparked = instance;
            if (result.output() != null && !result.output().isEmpty()) {
                reparked = reparked.toBuilder().mergeContext(result.output()).build();
            }
            return reparked.toBuilder()
                .status(InstanceStatus.WAITING)
                .updatedOn(Instant.now())
                .build();
        }

        // COMPLETED — record output on history, merge into context
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

    private WorkflowInstance handleFailedCompletion(Workflow workflow, WorkflowInstance instance,
                                                    WorkflowNode actionNode, NodeResult result) {
        ErrorResolution resolution;
        try {
            resolution = errorHandler.handleNodeError(instance, actionNode, result, null);
        } catch (Exception handlerError) {
            return failWorkflow(instance, "Error handler threw: " + handlerError.getMessage(), handlerError);
        }

        // RETRY re-executes the action node. For async executors this typically returns
        // PENDING again, re-parking the instance until the next out-of-band result.
        if (resolution.action() == ErrorAction.RETRY) {
            WorkflowInstance running = instance.toBuilder()
                .status(InstanceStatus.RUNNING)
                .updatedOn(Instant.now())
                .build();
            WorkflowInstance executed = executeActionNode(workflow, running, actionNode);
            if (executed.status() != InstanceStatus.RUNNING) {
                return executed;
            }
            return advance(workflow, executed);
        }

        // FAIL / TRANSITION — apply the resolution as the synchronous path does.
        WorkflowInstance running = instance.toBuilder()
            .status(InstanceStatus.RUNNING)
            .updatedOn(Instant.now())
            .build();
        WorkflowInstance resolved = applyResolution(workflow, running, actionNode, resolution);
        if (resolved.status() != InstanceStatus.RUNNING) {
            return resolved;
        }
        return advance(workflow, resolved);
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
                try {
                    resolvedInputs.put(label, resolveInputValue(entry.getValue(), instance.context()));
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
                .map(this::mapHumanTaskOutput)
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

    /**
     * Advances the instance to quiescence by driving all runnable branches. Seeds a work queue with the
     * branches that currently need to continue (each has entered and, for actions, executed its node) and
     * delegates to {@link #advanceBranches}. Non-parallel workflows have exactly one (root) branch, so
     * this behaves identically to the single-cursor engine of old.
     *
     * @param workflow the workflow definition
     * @param instance the instance to advance
     * @return the instance once no branch is runnable
     */
    private WorkflowInstance advance(Workflow workflow, WorkflowInstance instance) {
        ParallelRegions regions = ParallelRegions.analyze(workflow);
        Deque<ActiveBranch> work = new ArrayDeque<>(instance.activeBranches());
        return advanceBranches(workflow, instance, work, regions);
    }

    /**
     * Drives all runnable branches to quiescence. Each work item is a branch that has entered and (for
     * actions) executed its current node and now needs its outgoing edge(s) resolved. Forks fan out, joins
     * synchronize, END terminates the instance, and any branch failure fails the whole instance.
     *
     * @param workflow the workflow definition
     * @param instance the instance being advanced
     * @param work     the queue of branches that still need their outgoing edges resolved
     * @param regions  the precomputed parallel-region analysis
     * @return the instance once the work queue drains (or a terminal/blocked state is reached)
     */
    private WorkflowInstance advanceBranches(Workflow workflow, WorkflowInstance instance,
                                             Deque<ActiveBranch> work, ParallelRegions regions) {
        int transitions = 0;
        while (!work.isEmpty()) {
            if (transitions++ >= MAX_TRANSITIONS) {
                return failWorkflow(instance,
                    "Exceeded transition limit (" + MAX_TRANSITIONS + ") — possible infinite loop", null);
            }
            ActiveBranch branch = work.poll();
            WorkflowNode node = workflow.findNodeById(branch.nodeId()).orElse(null);
            if (node == null) {
                return failWorkflow(instance, "Current node not found: " + branch.nodeId(), null);
            }

            // Resolve outgoing edges from this (entered, executed) node.
            List<WorkflowEdge> targets;
            if (regions.isFork(node.id())) {
                targets = workflow.getOutgoingEdges(node.id());
            } else {
                WorkflowEdge selected;
                try {
                    selected = selectEdge(workflow, instance, node);
                } catch (ConditionEvaluationException e) {
                    instance = resolveEdgeError(workflow, instance, node, null, e);
                    if (instance.status() != InstanceStatus.RUNNING) return instance;
                    // re-run from the resolution target as a fresh single-branch continue
                    work = new ArrayDeque<>(instance.activeBranches());
                    continue;
                }
                if (selected == null) {
                    instance = resolveNoEdge(workflow, instance, node);
                    if (instance.status() != InstanceStatus.RUNNING) return instance;
                    work = new ArrayDeque<>(instance.activeBranches());
                    continue;
                }
                targets = List.of(selected);
            }

            // Complete this branch's history entry for the source node once (idempotent).
            instance = completeHistoryEntry(instance, branch.branchId(), node.id(), Instant.now(), null);

            boolean fork = targets.size() > 1;
            if (fork) {
                instance = instance.toBuilder().removeActiveBranch(branch.branchId()).build();
            }
            int childIndex = 0;
            for (WorkflowEdge edge : targets) {
                String childBranchId = fork ? branch.branchId() + "." + (childIndex++) : branch.branchId();
                instance = moveBranch(workflow, instance, childBranchId, node, edge, regions, work);
                if (instance.status() != InstanceStatus.RUNNING) {
                    return instance;
                }
            }
        }
        return quiesce(workflow, instance);
    }

    /**
     * Moves a branch across a single edge. If the edge target is a synchronizing join, records the arrival
     * and either fires the join (all branches present) or absorbs the branch (still waiting). Otherwise the
     * branch enters the target node.
     *
     * @param workflow the workflow definition
     * @param instance the instance being advanced
     * @param branchId the id of the branch being moved
     * @param source   the source node the branch is leaving
     * @param edge     the edge being followed
     * @param regions  the precomputed parallel-region analysis
     * @param work     the work queue that continuing branches are enqueued onto
     * @return the instance after moving (and possibly entering) the target
     */
    private WorkflowInstance moveBranch(Workflow workflow, WorkflowInstance instance, String branchId,
                                        WorkflowNode source, WorkflowEdge edge, ParallelRegions regions,
                                        Deque<ActiveBranch> work) {
        WorkflowNode target = workflow.findNodeById(edge.target())
            .orElseThrow(() -> new IllegalStateException("Edge target not found: " + edge.target()));
        WorkflowInstance edgeInstance = instance;
        fireEvent(l -> l.onEdgeFollowed(edgeInstance, edge));

        if (regions.isJoin(target.id())) {
            // Record arrival; retire the arriving branch.
            instance = instance.toBuilder()
                .recordJoinArrival(target.id(), edge.id())
                .removeActiveBranch(branchId)
                .updatedOn(Instant.now())
                .build();
            Set<String> required = regions.incomingEdgeIds(target.id());
            Set<String> arrived = new HashSet<>(instance.joinArrivals().getOrDefault(target.id(), List.of()));
            if (arrived.containsAll(required)) {
                // All branches converged — one continuing branch enters the join.
                String continuingId = target.id() + "#join";
                instance = instance.toBuilder()
                    .addActiveBranch(new ActiveBranch(continuingId, target.id()))
                    .build();
                return enterNode(workflow, instance, continuingId, target, edge, regions, work);
            }
            return instance; // absorbed; wait for siblings
        }

        // Sequential / fork-child arrival at a normal node.
        instance = instance.toBuilder()
            .removeActiveBranch(branchId)
            .addActiveBranch(new ActiveBranch(branchId, target.id()))
            .currentNodeId(target.id())
            .updatedOn(Instant.now())
            .build();
        return enterNode(workflow, instance, branchId, target, edge, regions, work);
    }

    /**
     * Enters a node for a branch: records a branch-attributed history entry, fires {@code onNodeEntered},
     * and dispatches on node type. Actions execute immediately (and, if still RUNNING, the branch is
     * enqueued to continue); blocking nodes leave the branch parked; END terminates the instance.
     *
     * @param workflow the workflow definition
     * @param instance the instance being advanced
     * @param branchId the id of the entering branch
     * @param node     the node being entered
     * @param viaEdge  the edge traversed to reach the node, or {@code null} for error-handler transitions
     * @param regions  the precomputed parallel-region analysis
     * @param work     the work queue that continuing branches are enqueued onto
     * @return the instance after entering (and dispatching on) the node
     */
    private WorkflowInstance enterNode(Workflow workflow, WorkflowInstance instance, String branchId,
                                       WorkflowNode node, WorkflowEdge viaEdge, ParallelRegions regions,
                                       Deque<ActiveBranch> work) {
        Instant now = Instant.now();
        instance = instance.toBuilder()
            .addHistory(new HistoryEntry(node.id(), node.name(),
                viaEdge != null ? viaEdge.id() : null,
                viaEdge != null ? viaEdge.condition() : null,
                now, null, null, branchId))
            .updatedOn(now)
            .build();
        WorkflowInstance enteredInstance = instance;
        fireEvent(l -> l.onNodeEntered(enteredInstance, node));

        switch (node.type()) {
            case ACTION -> {
                instance = executeActionNode(workflow, instance, node);
                if (instance.status() == InstanceStatus.RUNNING) {
                    work.add(new ActiveBranch(branchId, node.id())); // continue from this node
                }
                return instance;
            }
            case HUMAN_TASK, RECEIVE_EVENT, WAIT -> {
                // Branch parks here (blocked). Overall status resolved in quiesce().
                return instance;
            }
            case END -> {
                instance = completeHistoryEntry(instance, branchId, node.id(), Instant.now(), null);
                instance = instance.toBuilder()
                    .status(InstanceStatus.COMPLETED)
                    .currentNodeId(node.id())
                    .activeBranches(List.of())
                    .updatedOn(Instant.now())
                    .build();
                WorkflowInstance completedInstance = instance;
                fireEvent(l -> l.onWorkflowCompleted(completedInstance));
                return instance;
            }
            default -> {
                return failWorkflow(instance, "Cannot transition to node type: " + node.type(), null);
            }
        }
    }

    /**
     * Derives the instance status once no branch is runnable: WAITING if any branch is parked on a blocking
     * node, otherwise a defensive failure (structured validation prevents an empty non-terminal state).
     * Keeps {@code currentNodeId} = the sole active branch's node when there is exactly one.
     *
     * @param workflow the workflow definition
     * @param instance the instance whose queue has drained
     * @return the instance with a derived status and current node
     */
    private WorkflowInstance quiesce(Workflow workflow, WorkflowInstance instance) {
        if (instance.status() != InstanceStatus.RUNNING) {
            return instance;
        }
        List<ActiveBranch> active = instance.activeBranches();
        if (active.isEmpty()) {
            return failWorkflow(instance,
                "No active branches and workflow did not complete (parallel deadlock)", null);
        }
        boolean anyBlocked = active.stream().anyMatch(b -> isBlockingNode(workflow, b.nodeId()));
        String current = active.size() == 1 ? active.getFirst().nodeId() : null;
        return instance.toBuilder()
            .status(anyBlocked ? InstanceStatus.WAITING : InstanceStatus.RUNNING)
            .currentNodeId(current)
            .updatedOn(Instant.now())
            .build();
    }

    /**
     * @param workflow the workflow definition
     * @param nodeId   the node id to classify
     * @return true if the node is a blocking node (HUMAN_TASK, RECEIVE_EVENT or WAIT)
     */
    private boolean isBlockingNode(Workflow workflow, String nodeId) {
        NodeType type = workflow.findNodeById(nodeId).map(WorkflowNode::type).orElse(null);
        return type == NodeType.HUMAN_TASK || type == NodeType.RECEIVE_EVENT || type == NodeType.WAIT;
    }

    /**
     * Reuses the existing error handler for a failed edge-condition evaluation on the sequential path.
     *
     * @param workflow the workflow definition
     * @param instance the instance being advanced
     * @param node     the node whose outgoing edge condition failed
     * @param result   the node result (may be {@code null})
     * @param e        the failure that occurred
     * @return the resolved instance
     */
    private WorkflowInstance resolveEdgeError(Workflow workflow, WorkflowInstance instance,
                                              WorkflowNode node, NodeResult result, Exception e) {
        ErrorResolution resolution;
        try {
            resolution = errorHandler.handleNodeError(instance, node, result, e);
        } catch (Exception handlerError) {
            return failWorkflow(instance, "Error handler threw: " + handlerError.getMessage(), handlerError);
        }
        return applyResolution(workflow, instance, node, resolution);
    }

    /**
     * Reuses the existing error handler for the "no matching edge" case on the sequential path.
     *
     * @param workflow the workflow definition
     * @param instance the instance being advanced
     * @param node     the node with no matching outgoing edge
     * @return the resolved instance
     */
    private WorkflowInstance resolveNoEdge(Workflow workflow, WorkflowInstance instance, WorkflowNode node) {
        ErrorResolution resolution;
        try {
            resolution = errorHandler.handleNoMatchingEdge(instance, node);
        } catch (Exception e) {
            return failWorkflow(instance, "Error handler threw: " + e.getMessage(), e);
        }
        return applyResolution(workflow, instance, node, resolution);
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
                // Propagate so the error handler receives the failing expression and node context.
                throw e;
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
                // Error-handler transitions apply to the single-branch (non-parallel) error path.
                String branchId = instance.activeBranches().size() == 1
                    ? instance.activeBranches().getFirst().branchId() : "root";
                WorkflowInstance moved = instance.toBuilder()
                    .currentNodeId(target.id())
                    .removeActiveBranch(branchId)
                    .addActiveBranch(new ActiveBranch(branchId, target.id()))
                    .updatedOn(Instant.now())
                    .build();
                // Enter the transition target (it has no history entry yet).
                yield enterNode(workflow, moved, branchId, target, null,
                    ParallelRegions.analyze(workflow), new ArrayDeque<>());
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

    /**
     * Completes the most recent open history entry matching the given branch and node (sets completedOn and,
     * when provided, output). Replaces the single-cursor "last entry is the current node" assumption for
     * the token-based executor, where entries from concurrent branches may interleave.
     *
     * @param instance    the instance whose history is updated
     * @param branchId    the branch that owns the entry to complete
     * @param nodeId      the node id of the entry to complete
     * @param completedOn the completion timestamp to set
     * @param output      the output to record, or {@code null} to preserve the existing output
     * @return the instance with the matching history entry completed
     */
    private WorkflowInstance completeHistoryEntry(WorkflowInstance instance, String branchId, String nodeId,
                                                  Instant completedOn, Map<String, Object> output) {
        List<HistoryEntry> history = new ArrayList<>(instance.history());
        for (int i = history.size() - 1; i >= 0; i--) {
            HistoryEntry h = history.get(i);
            boolean sameBranch = Objects.equals(h.branchId(), branchId);
            if (sameBranch && h.nodeId().equals(nodeId) && h.completedOn() == null) {
                history.set(i, new HistoryEntry(h.nodeId(), h.nodeName(), h.edgeId(), h.edgeCondition(),
                    h.enteredOn(), completedOn, output != null ? output : h.output(), h.branchId()));
                break;
            }
        }
        return instance.toBuilder().history(history).build();
    }

    private WorkflowInstance completeCurrentHistoryEntry(WorkflowInstance instance, Instant completedOn,
                                                         Map<String, Object> output) {
        List<HistoryEntry> history = new ArrayList<>(instance.history());
        if (!history.isEmpty()) {
            HistoryEntry last = history.getLast();
            if (last.completedOn() == null) {
                history.set(history.size() - 1, new HistoryEntry(
                    last.nodeId(), last.nodeName(), last.edgeId(), last.edgeCondition(),
                    last.enteredOn(), completedOn, output != null ? output : last.output(),
                    last.branchId()));
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

    /**
     * Maps a single raw {@code config.outputs} entry for a human-task node into an
     * {@link OutputDefinition}, applying the documented defaults: {@code label} falls back to
     * {@code name}, {@code widget} is inferred from {@code type} when omitted, and {@code options}
     * are parsed into {@link OutputOption} records. Unknown/omitted metadata is left {@code null}.
     *
     * @param o the raw output definition map
     * @return the resolved output definition
     */
    private OutputDefinition mapHumanTaskOutput(Map<?, ?> o) {
        String name = String.valueOf(o.get("name"));
        String type = o.get("type") != null ? String.valueOf(o.get("type")) : "string";
        boolean required = Boolean.TRUE.equals(o.get("required"));
        String label = o.get("label") instanceof String l && !l.isBlank() ? l : name;
        String description = o.get("description") instanceof String d ? d : null;
        String widget = o.get("widget") instanceof String w && !w.isBlank() ? w : inferWidget(type);
        Object defaultValue = o.get("defaultValue");

        List<OutputOption> options = null;
        if (o.get("options") instanceof List<?> rawOptions) {
            options = rawOptions.stream()
                .filter(Map.class::isInstance)
                .map(opt -> (Map<?, ?>) opt)
                .map(opt -> new OutputOption(
                    opt.get("label") != null ? String.valueOf(opt.get("label")) : null,
                    opt.get("value") != null ? String.valueOf(opt.get("value")) : null
                ))
                .toList();
        }

        return new OutputDefinition(name, type, required, label, description, widget, defaultValue, options);
    }

    /**
     * Infers the default rendering widget for a human-task output from its semantic type when no
     * explicit {@code widget} is declared.
     *
     * @param type the semantic type ({@code string}/{@code number}/{@code boolean}/{@code object})
     * @return the inferred widget hint
     */
    private String inferWidget(String type) {
        return switch (type == null ? "string" : type) {
            case "number" -> "number";
            case "boolean" -> "checkbox";
            case "object" -> "textarea";
            default -> "text";
        };
    }

    private Map<String, Object> resolveNodeInputs(WorkflowNode node, Map<String, Object> context) {
        Object inputConfig = node.config().get("inputs");
        if (!(inputConfig instanceof Map<?, ?> inputExprs)) {
            return Map.of();
        }
        Map<String, Object> resolved = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : inputExprs.entrySet()) {
            String label = String.valueOf(entry.getKey());
            try {
                resolved.put(label, resolveInputValue(entry.getValue(), context));
            } catch (Exception e) {
                log.warn("Failed to resolve action input '{}': {}", label, e.getMessage());
                resolved.put(label, null);
            }
        }
        return Collections.unmodifiableMap(resolved);
    }

    /**
     * Resolves a single input value. Only {@link String} values are treated as EL
     * expressions and passed to the condition evaluator. Non-string values (such as
     * {@link Map}, {@link List}, numbers or booleans) are literal values and are
     * returned as-is, avoiding corruption via {@code String.valueOf}.
     */
    private Object resolveInputValue(Object rawValue, Map<String, Object> context) {
        if (rawValue instanceof String expression) {
            return conditionEvaluator.resolve(expression, context);
        }
        return rawValue;
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
