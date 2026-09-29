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

/**
 * Stateless, synchronous workflow driver. Definitions and instances must be non-null and callers must not
 * mutate supplied data during a call. Persist returned instances and coordinate concurrent deliveries in the
 * host; callbacks are observations, not transaction or durability boundaries. Host Exceptions enter recovery;
 * JVM Errors propagate. Instances do not retain Throwable objects on the wire.
 */
public class WorkflowEngine {

    private static final Logger log = LoggerFactory.getLogger(WorkflowEngine.class);
    private static final int MAX_TRANSITIONS = 100;
    private static final int MAX_RETRIES = 10;

    private enum WorkKind { CONTINUE, MOVE, ENTER, RETRY }

    /** Call-local work; recovery entry must never execute recursively inside an error handler. */
    private record BranchWork(ActiveBranch branch, WorkKind kind, WorkflowEdge edge, WorkflowError error) {
        private BranchWork(ActiveBranch branch, WorkKind kind) {
            this(branch, kind, null, null);
        }
        private BranchWork(ActiveBranch branch, WorkKind kind, WorkflowEdge edge) {
            this(branch, kind, edge, null);
        }
    }

    private record Recovery(ErrorResolution resolution, WorkflowError error) {
        private ErrorAction action() { return resolution.action(); }
    }

    private final NodeExecutorProvider executorProvider;
    private final List<WorkflowEventListener> listeners;
    private final WorkflowErrorHandler errorHandler;
    private final WorkflowValidator validator;
    private final ConditionEvaluator conditionEvaluator;

    /**
     * Creates an engine. Null provider means no executors; null handler selects fail-by-default recovery.
     * Null listeners means none; otherwise registrations are copied in order and null entries rejected.
     */
    public WorkflowEngine(NodeExecutorProvider executorProvider, List<WorkflowEventListener> listeners,
                          WorkflowErrorHandler errorHandler) {
        this.executorProvider = executorProvider != null ? executorProvider : actionType -> null;
        this.listeners = listeners != null ? List.copyOf(listeners) : List.of();
        this.errorHandler = errorHandler != null ? errorHandler : new DefaultErrorHandler();
        this.validator = new WorkflowValidator();
        this.conditionEvaluator = new ConditionEvaluator();
    }

    /** Starts a validated workflow with a generated id; null initialContext means empty context. */
    public WorkflowInstance startWorkflow(Workflow workflow, Map<String, Object> initialContext) {
        return startWorkflow(workflow, initialContext, UUID.randomUUID().toString());
    }

    /**
     * Starts with a caller-supplied instance id and optional initial context. Definition/required-start-input
     * errors throw before execution. Runtime failures use recovery and normally return a FAILED instance.
     * Action/human input evaluation failures are recoverable errors, never silently substituted with null.
     */
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

    /**
     * Completes a specific parked branch (identified by its node id) and resumes execution from it, leaving
     * any sibling branches parked. Use this when more than one branch may be waiting concurrently.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @param nodeId   the id of the parked node/branch to complete
     * @param result   the node result delivering the branch's output; null/malformed results enter recovery;
     *                 null output means no values, and PENDING output may be partial
     * @return the advanced instance
     */
    public WorkflowInstance completeNode(Workflow workflow, WorkflowInstance instance, String nodeId,
                                         NodeResult result) {
        if (instance.status() != InstanceStatus.WAITING) {
            throw new IllegalStateException(
                "Cannot complete node: instance is not in WAITING status (current: " + instance.status() + ")");
        }
        ActiveBranch branch = instance.activeBranches().stream()
            .filter(b -> b.nodeId().equals(nodeId))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("No parked branch at node: " + nodeId));

        WorkflowNode node = workflow.findNodeById(nodeId)
            .orElseThrow(() -> new IllegalStateException("Node not found: " + nodeId));

        WorkflowError resultError = validateResult(node, result);
        if (resultError != null) {
            return handleFailedCompletion(workflow, instance, branch.branchId(), node, result, resultError);
        }
        if (result.status() == NodeResultStatus.PENDING) {
            WorkflowInstance reparked = instance;
            if (result.output() != null && !result.output().isEmpty()) {
                Map<String, Object> resolvedOutput;
                try {
                    resolvedOutput = resolveMergeOutput(instance, node, result.output());
                } catch (Exception e) {
                    return resolveMergeOutputError(workflow, instance, branch.branchId(), node, result, e);
                }
                reparked = reparked.toBuilder().mergeContext(resolvedOutput).build();
            }
            return reparked.toBuilder().status(InstanceStatus.WAITING).updatedOn(Instant.now()).build();
        }

        // COMPLETED actions use the synchronous contract, before remapping or merging output.
        // PENDING payloads above are intentionally partial and do not require all declared outputs.
        WorkflowError outputError = node.type() == NodeType.ACTION ? validateNodeOutputs(node, result.output()) : null;
        if (outputError != null) {
            return handleFailedCompletion(workflow, instance, branch.branchId(), node, result, outputError);
        }

        // COMPLETED — record output on the branch's history entry, merge context, then continue this branch.
        Map<String, Object> resolvedOutput;
        try {
            resolvedOutput = resolveMergeOutput(instance, node, result.output());
        } catch (Exception e) {
            return resolveMergeOutputError(workflow, instance, branch.branchId(), node, result, e);
        }
        WorkflowInstance updated = completeHistoryEntry(instance, branch.branchId(), nodeId,
            Instant.now(), resolvedOutput);
        updated = updated.toBuilder()
            .mergeContext(resolvedOutput)
            .status(InstanceStatus.RUNNING)
            .updatedOn(Instant.now())
            .build();
        WorkflowInstance completedInstance = updated;
        fireEvent(l -> l.onNodeCompleted(completedInstance, node, result));

        Deque<BranchWork> work = new ArrayDeque<>();
        work.add(new BranchWork(branch, WorkKind.CONTINUE)); // continue only the resumed branch
        return advanceBranches(workflow, updated, work, ParallelRegions.analyze(workflow));
    }

    /**
     * Completes the sole parked node using {@link #completeNode}; throws for non-WAITING or multi-branch
     * instances. Result nullability and recovery follow completeNode.
     */
    public WorkflowInstance completeCurrentNode(Workflow workflow, WorkflowInstance instance,
                                                 NodeResult result) {
        if (instance.status() != InstanceStatus.WAITING) {
            throw new IllegalStateException(
                "Cannot complete node: instance is not in WAITING status (current: " + instance.status() + ")");
        }
        String nodeId = instance.currentNodeId();
        if (nodeId == null) {
            // Parallel wait with no single current node — caller must use completeNode(nodeId).
            throw new IllegalStateException(
                "Multiple branches are waiting; use completeNode(workflow, instance, nodeId, result)");
        }
        return completeNode(workflow, instance, nodeId, result);
    }

    /**
     * Reuses the existing error handler when {@link #resolveMergeOutput} throws (e.g. a receive-event
     * output mapping's expression fails to evaluate against the delivered event/context), instead of
     * letting the exception propagate out of {@link #completeNode} and leave the instance stuck in
     * WAITING. Mirrors {@link #resolveEdgeError}'s handler-dispatch/fail-safe pattern.
     *
     * @param workflow the workflow definition
     * @param instance the instance being completed
     * @param branchId the id of the branch whose node's output failed to resolve
     * @param node     the node whose output mapping failed to resolve
     * @param result   the node result that was being merged
     * @param e        the failure that occurred while resolving the merge output
     * @return the resolved instance
     */
    private WorkflowInstance resolveMergeOutputError(Workflow workflow, WorkflowInstance instance, String branchId,
                                                      WorkflowNode node, NodeResult result, Exception e) {
        Recovery resolution = recover(workflow, instance, node, result,
            contextualError(WorkflowError.Phase.OUTPUT_MAPPING, node, e));
        if (resolution.action() == ErrorAction.RETRY) {
            return instance; // Keep the failed delivery parked for another external completion.
        }
        return resumeResolution(workflow, instance, branchId, node, resolution);
    }

    private WorkflowInstance handleFailedCompletion(Workflow workflow, WorkflowInstance instance,
                                                    String branchId, WorkflowNode actionNode,
                                                    NodeResult result, WorkflowError error) {
        Recovery resolution = recover(workflow, instance, actionNode, result, error);
        if (resolution.action() == ErrorAction.RETRY && actionNode.type() != NodeType.ACTION) {
            return instance; // External tasks require another delivery, never action-executor dispatch.
        }
        return resumeResolution(workflow, instance, branchId, actionNode, resolution);
    }

    /** Seeds one driver for an external completion's recovery and any already runnable siblings. */
    private WorkflowInstance resumeResolution(Workflow workflow, WorkflowInstance instance, String branchId,
                                               WorkflowNode node, Recovery resolution) {
        WorkflowInstance running = instance.toBuilder()
            .status(InstanceStatus.RUNNING)
            .updatedOn(Instant.now())
            .build();
        Deque<BranchWork> work = runnableBranches(running);
        WorkflowInstance resolved;
        if (resolution.action() == ErrorAction.RETRY) {
            work.addFirst(new BranchWork(new ActiveBranch(branchId, node.id()), WorkKind.RETRY,
                null, resolution.error()));
            resolved = running;
        } else {
            resolved = applyResolution(workflow, running, branchId, node, resolution, work);
        }
        if (resolved.status() != InstanceStatus.RUNNING) {
            return resolved;
        }
        return advanceBranches(workflow, resolved, work, ParallelRegions.analyze(workflow));
    }

    /** Cancels a nonterminal instance and notifies observers; terminal instances are returned unchanged. */
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

    /**
     * Resolves an expression without changing state. Null/blank expressions and legitimate null values return
     * null; evaluation errors throw {@link ConditionEvaluationException}. Context should be non-null.
     */
    public Object resolveExpression(String expression, Map<String, Object> context) {
        return conditionEvaluator.resolve(expression, context);
    }

    /**
     * Returns the human-task info for the instance's single current node, or — when multiple branches are
     * parked concurrently ({@code currentNodeId == null}) — the first parked HUMAN_TASK branch (in
     * {@link WorkflowInstance#activeBranches()} order), or {@code null} if none.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @return the resolved human-task info, or {@code null}
     */
    public HumanTaskInfo getHumanTaskInfo(Workflow workflow, WorkflowInstance instance) {
        if (instance.currentNodeId() != null) {
            return getHumanTaskInfo(workflow, instance, instance.currentNodeId());
        }
        if (instance.status() != InstanceStatus.WAITING) {
            return null;
        }
        for (ActiveBranch branch : instance.activeBranches()) {
            HumanTaskInfo info = getHumanTaskInfo(workflow, instance, branch.nodeId());
            if (info != null) {
                return info;
            }
        }
        return null;
    }

    /**
     * Returns the human-task info for a specific parked branch node. Use this when multiple branches may be
     * waiting concurrently and the caller needs to address one by its node id.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @param nodeId   the id of the parked node to resolve (must correspond to an active branch)
     * @return the human-task info, or {@code null} if the node is not an active parked HUMAN_TASK
     *         in a WAITING instance
     * @throws WorkflowError if an input fails to resolve; this read-only call cannot apply recovery
     */
    public HumanTaskInfo getHumanTaskInfo(Workflow workflow, WorkflowInstance instance, String nodeId) {
        if (!isParkedNode(instance, nodeId)) {
            return null;
        }
        WorkflowNode node = workflow.findNodeById(nodeId).orElse(null);
        if (node == null || node.type() != NodeType.HUMAN_TASK) {
            return null;
        }

        String description = node.config().get("description") instanceof String d ? d : null;

        Map<String, Object> resolvedInputs = resolveNodeInputs(node, instance.context());

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

    /**
     * Returns the receive-event info for the instance's single current node, or — when multiple branches are
     * parked concurrently ({@code currentNodeId == null}) — the first parked RECEIVE_EVENT branch (in
     * {@link WorkflowInstance#activeBranches()} order), or {@code null} if none.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @return the resolved receive-event info, or {@code null}
     */
    public ReceiveEventInfo getReceiveEventInfo(Workflow workflow, WorkflowInstance instance) {
        if (instance.currentNodeId() != null) {
            return getReceiveEventInfo(workflow, instance, instance.currentNodeId());
        }
        if (instance.status() != InstanceStatus.WAITING) {
            return null;
        }
        for (ActiveBranch branch : instance.activeBranches()) {
            ReceiveEventInfo info = getReceiveEventInfo(workflow, instance, branch.nodeId());
            if (info != null) {
                return info;
            }
        }
        return null;
    }

    /**
     * Returns the receive-event info for a specific parked branch node. Use this when multiple branches may
     * be waiting concurrently and the caller needs to address one by its node id.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @param nodeId   the id of the parked node to resolve (must correspond to an active branch)
     * @return the receive-event info, or {@code null} if the node is not an active parked RECEIVE_EVENT
     *         in a WAITING instance
     */
    public ReceiveEventInfo getReceiveEventInfo(Workflow workflow, WorkflowInstance instance, String nodeId) {
        if (!isParkedNode(instance, nodeId)) {
            return null;
        }
        WorkflowNode node = workflow.findNodeById(nodeId).orElse(null);
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

        List<EventOutputMapping> outputMappings = List.of();
        if (node.config().get("outputs") instanceof List<?> outputDefs) {
            outputMappings = outputDefs.stream()
                .filter(Map.class::isInstance)
                .map(o -> (Map<?, ?>) o)
                .map(o -> new EventOutputMapping(
                    o.get("contextKey") != null ? String.valueOf(o.get("contextKey")) : null,
                    o.get("expression") != null ? String.valueOf(o.get("expression")) : null
                ))
                .toList();
        }

        return new ReceiveEventInfo(node.id(), node.name(), eventType, matchExpressions, outputMappings);
    }

    /**
     * Returns the wait info for the instance's single current node, or — when multiple branches are parked
     * concurrently ({@code currentNodeId == null}) — the first parked WAIT branch (in
     * {@link WorkflowInstance#activeBranches()} order), or {@code null} if none.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @return the resolved wait info, or {@code null}
     */
    public WaitInfo getWaitInfo(Workflow workflow, WorkflowInstance instance) {
        if (instance.currentNodeId() != null) {
            return getWaitInfo(workflow, instance, instance.currentNodeId());
        }
        if (instance.status() != InstanceStatus.WAITING) {
            return null;
        }
        for (ActiveBranch branch : instance.activeBranches()) {
            WaitInfo info = getWaitInfo(workflow, instance, branch.nodeId());
            if (info != null) {
                return info;
            }
        }
        return null;
    }

    /**
     * Returns the wait info for a specific parked branch node. Use this when multiple branches may be waiting
     * concurrently and the caller needs to address one by its node id.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @param nodeId   the id of the parked node to resolve (must correspond to an active branch)
     * @return the wait info, or {@code null} if the node is not an active parked WAIT in a WAITING instance
     */
    public WaitInfo getWaitInfo(Workflow workflow, WorkflowInstance instance, String nodeId) {
        if (!isParkedNode(instance, nodeId)) {
            return null;
        }
        WorkflowNode node = workflow.findNodeById(nodeId).orElse(null);
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

    /**
     * Returns the action info for the instance's single current node, or — when multiple branches are parked
     * concurrently ({@code currentNodeId == null}) — the first parked ACTION branch (in
     * {@link WorkflowInstance#activeBranches()} order), or {@code null} if none.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @return the resolved action info, or {@code null}
     */
    public ActionInfo getActionInfo(Workflow workflow, WorkflowInstance instance) {
        if (instance.currentNodeId() != null) {
            return getActionInfo(workflow, instance, instance.currentNodeId());
        }
        if (instance.status() != InstanceStatus.WAITING) {
            return null;
        }
        for (ActiveBranch branch : instance.activeBranches()) {
            ActionInfo info = getActionInfo(workflow, instance, branch.nodeId());
            if (info != null) {
                return info;
            }
        }
        return null;
    }

    /**
     * Returns the action info for a specific parked branch node. Use this when multiple branches may be
     * waiting concurrently and the caller needs to address one by its node id.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @param nodeId   the id of the parked node to resolve (must correspond to an active branch)
     * @return the action info, or {@code null} if the node is not an active parked ACTION in a WAITING instance
     * @throws WorkflowError if an input fails to resolve; this read-only call cannot apply recovery
     */
    public ActionInfo getActionInfo(Workflow workflow, WorkflowInstance instance, String nodeId) {
        if (!isParkedNode(instance, nodeId)) {
            return null;
        }
        WorkflowNode node = workflow.findNodeById(nodeId).orElse(null);
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
                    Boolean.TRUE.equals(o.get("required")),
                    null, null, null, null, null,
                    o.get("contextKey") instanceof String ck && !ck.isBlank() ? ck : null
                ))
                .toList();
        }

        return new ActionInfo(node.id(), node.name(), actionType,
            resolvedInputs, expectedOutputs);
    }

    /**
     * Tests whether the given event matches a parked RECEIVE_EVENT branch. When the instance has a single
     * current node ({@code currentNodeId != null}), it tests that node; when multiple branches are parked
     * concurrently ({@code currentNodeId == null}), it returns true if ANY parked RECEIVE_EVENT branch
     * matches.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @param event    the incoming event
     * @return true if a parked RECEIVE_EVENT branch matches the event
     */
    public boolean matchesEvent(Workflow workflow, WorkflowInstance instance, Map<String, Object> event) {
        if (instance.currentNodeId() != null) {
            return matchesEvent(workflow, instance, instance.currentNodeId(), event);
        }
        if (instance.status() != InstanceStatus.WAITING) {
            return false;
        }
        for (ActiveBranch branch : instance.activeBranches()) {
            if (matchesEvent(workflow, instance, branch.nodeId(), event)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Tests whether the given event matches a specific parked RECEIVE_EVENT branch node. Use this when
     * multiple branches may be waiting concurrently and the caller needs to address one by its node id.
     *
     * @param workflow the workflow definition
     * @param instance the WAITING instance
     * @param nodeId   the id of the parked node to test (must correspond to an active branch)
     * @param event    the incoming event
     * @return true if the given node is an active parked RECEIVE_EVENT in a WAITING instance that matches
     *         the event; false for ineligible nodes
     */
    public boolean matchesEvent(Workflow workflow, WorkflowInstance instance, String nodeId,
                                Map<String, Object> event) {
        if (!isParkedNode(instance, nodeId)) {
            return false;
        }

        WorkflowNode currentNode = workflow.findNodeById(nodeId).orElse(null);
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
        Deque<BranchWork> work = runnableBranches(instance);
        return advanceBranches(workflow, instance, work, regions);
    }

    /**
     * Rebuilds the continuation queue from completed activations only. Active branches also include
     * parked nodes awaiting external completion, whose latest history entry must remain open. Keep
     * every completed sibling in active-branch order so recovery neither wakes parked work nor loses
     * work that was already runnable.
     *
     * @param instance the instance after node execution or recovery
     * @return the branches ready to resolve their outgoing edges
     */
    private Deque<BranchWork> runnableBranches(WorkflowInstance instance) {
        return new ArrayDeque<>(instance.activeBranches().stream()
            .filter(branch -> !isBranchOpen(instance, branch.branchId(), branch.nodeId()))
            .map(branch -> new BranchWork(branch, WorkKind.CONTINUE))
            .toList());
    }

    /** Queues only completed activations, without duplicating a pending recovery entry for this branch. */
    private void enqueueContinuation(WorkflowInstance instance, String branchId, Deque<BranchWork> work) {
        if (work.stream().anyMatch(item -> item.branch().branchId().equals(branchId))) {
            return;
        }
        instance.activeBranches().stream()
            .filter(branch -> branch.branchId().equals(branchId))
            .filter(branch -> !isBranchOpen(instance, branchId, branch.nodeId()))
            .findFirst()
            .ifPresent(branch -> work.addLast(new BranchWork(branch, WorkKind.CONTINUE)));
    }

    /**
     * Drives continuations, recovery entries, and externally requested retries to quiescence under one
     * per-call budget. Each edge move, recovery entry, external retry, or unsuccessful edge selection
     * consumes one unit. Successful edge selection queues moves without an extra charge. Local action
     * retries retain their separate MAX_RETRIES guard; neither limit is a durable retry policy.
     * Forks fan out, joins synchronize, and END terminates the instance.
     *
     * @param workflow the workflow definition
     * @param instance the instance being advanced
     * @param work     the queue of branch continuations, entries, or retries
     * @param regions  the precomputed parallel-region analysis
     * @return the instance once the work queue drains (or a terminal/blocked state is reached)
     */
    private WorkflowInstance advanceBranches(Workflow workflow, WorkflowInstance instance,
                                             Deque<BranchWork> work, ParallelRegions regions) {
        int transitions = 0;
        WorkflowError lastError = null;
        while (!work.isEmpty()) {
            // Entry/external-retry recovery is queued at the front. Edge retries sit behind siblings:
            // record those when selection fails below, never replay an older diagnostic at dequeue time.
            if (work.peek().error() != null && work.peek().kind() != WorkKind.CONTINUE) {
                lastError = work.peek().error();
            }
            if (transitions >= MAX_TRANSITIONS) {
                return failWorkflow(instance,
                    "Exceeded transition limit (" + MAX_TRANSITIONS + ") — possible infinite loop"
                        + (lastError == null ? "" : "; last error: " + lastError.diagnostic()), lastError);
            }
            BranchWork item = work.poll();
            if (item.kind() != WorkKind.CONTINUE) {
                transitions++;
            }
            ActiveBranch branch = item.branch();
            WorkflowNode node = workflow.findNodeById(branch.nodeId()).orElse(null);
            if (node == null) {
                return failWorkflow(instance, "Current node not found: " + branch.nodeId(), null);
            }

            if (item.kind() == WorkKind.MOVE) {
                instance = moveBranch(workflow, instance, branch.branchId(), node, item.edge(), regions, work);
                if (instance.status() != InstanceStatus.RUNNING) return instance;
                continue;
            }

            if (item.kind() == WorkKind.ENTER) {
                instance = instance.toBuilder()
                    .removeActiveBranch(branch.branchId())
                    .addActiveBranch(branch)
                    .currentNodeId(node.id())
                    .updatedOn(Instant.now())
                    .build();
                instance = enterNode(workflow, instance, branch.branchId(), node, null, regions, work);
                if (instance.status() != InstanceStatus.RUNNING) return instance;
                continue;
            }
            if (item.kind() == WorkKind.RETRY) {
                instance = executeActionNode(workflow, instance, branch.branchId(), node, work);
                if (instance.status() != InstanceStatus.RUNNING) return instance;
                enqueueContinuation(instance, branch.branchId(), work);
                continue;
            }

            // Resolve outgoing edges from this (entered, executed) node.
            List<WorkflowEdge> targets;
            if (regions.isFork(node.id())) {
                targets = workflow.getOutgoingEdges(node.id());
            } else {
                WorkflowEdge selected;
                try {
                    selected = selectEdge(workflow, instance, node);
                } catch (WorkflowError e) {
                    transitions++;
                    lastError = e;
                    instance = resolveEdgeError(workflow, instance, branch.branchId(), node, null, e, work);
                    if (instance.status() != InstanceStatus.RUNNING) return instance;
                    enqueueContinuation(instance, branch.branchId(), work);
                    continue;
                }
                if (selected == null) {
                    transitions++;
                    lastError = new WorkflowError(WorkflowError.Phase.EDGE_SELECTION, node.id(), null,
                        null, null, "No matching outgoing edge", null);
                    instance = resolveNoEdge(workflow, instance, branch.branchId(), node, lastError, work);
                    if (instance.status() != InstanceStatus.RUNNING) return instance;
                    enqueueContinuation(instance, branch.branchId(), work);
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
            // Preserve edge order and immediate recovery precedence without recursive node entry.
            // Remaining fork arrivals stay ahead of ordinary continuations, but behind recovery entry.
            for (int childIndex = targets.size() - 1; childIndex >= 0; childIndex--) {
                WorkflowEdge edge = targets.get(childIndex);
                String childBranchId = fork ? branch.branchId() + "." + childIndex : branch.branchId();
                work.addFirst(new BranchWork(new ActiveBranch(childBranchId, node.id()), WorkKind.MOVE, edge));
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
                                        Deque<BranchWork> work) {
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
                // All branches converged — one continuing branch enters the join. Clear this join's
                // arrival record so a legitimate loop-back re-entry to the same fork/join starts clean
                // (prevents premature firing on a second pass).
                String continuingId = target.id() + "#join";
                instance = instance.toBuilder()
                    .addActiveBranch(new ActiveBranch(continuingId, target.id()))
                    .clearJoinArrivals(target.id())
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
                                       Deque<BranchWork> work) {
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
                instance = executeActionNode(workflow, instance, branchId, node, work);
                if (instance.status() != InstanceStatus.RUNNING) {
                    return instance;
                }
                enqueueContinuation(instance, branchId, work);
                return instance;
            }
            case HUMAN_TASK -> {
                try {
                    resolveNodeInputs(node, instance.context());
                } catch (WorkflowError error) {
                    Recovery recovery = recover(workflow, instance, node, null, error);
                    if (recovery.action() == ErrorAction.RETRY) {
                        recovery = new Recovery(ErrorResolution.transitionTo(node.id()), error);
                    }
                    return applyResolution(workflow, instance, branchId, node, recovery, work);
                }
                return instance;
            }
            case RECEIVE_EVENT, WAIT -> {
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
     * Derives the instance status once no branch is runnable: WAITING if any branch is parked (its current
     * node's history entry is still open — e.g. a HUMAN_TASK/RECEIVE_EVENT/WAIT node, or an ACTION node
     * whose executor returned PENDING), otherwise a defensive failure (structured validation prevents an
     * empty non-terminal state). Keeps {@code currentNodeId} = the sole active branch's node when there is
     * exactly one.
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
        boolean anyBlocked = active.stream()
            .anyMatch(b -> isBranchOpen(instance, b.branchId(), b.nodeId()));
        String current = active.size() == 1 ? active.getFirst().nodeId() : null;
        return instance.toBuilder()
            .status(anyBlocked ? InstanceStatus.WAITING : InstanceStatus.RUNNING)
            .currentNodeId(current)
            .updatedOn(Instant.now())
            .build();
    }

    /** Checks the shared eligibility contract for node-addressed introspection and event matching. */
    private boolean isParkedNode(WorkflowInstance instance, String nodeId) {
        return instance.status() == InstanceStatus.WAITING && nodeId != null
            && instance.activeBranches().stream()
                .anyMatch(branch -> nodeId.equals(branch.nodeId())
                    && isBranchOpen(instance, branch.branchId(), nodeId));
    }

    /**
     * Reports whether a branch's current node is still "open" (parked) — i.e. its most recent history
     * entry for {@code (branchId, nodeId)} has no {@code completedOn}. This is true for blocking node
     * types (HUMAN_TASK, RECEIVE_EVENT, WAIT) and equally for an ACTION node whose executor returned
     * PENDING, without needing to special-case node types: any node still open when the work queue has
     * fully drained is, by construction, genuinely parked awaiting external completion.
     *
     * @param instance the instance to inspect
     * @param branchId the branch id
     * @param nodeId   the node id the branch currently sits at
     * @return true if the branch's entry for this node is still open (not completed)
     */
    private boolean isBranchOpen(WorkflowInstance instance, String branchId, String nodeId) {
        List<HistoryEntry> history = instance.history();
        for (int i = history.size() - 1; i >= 0; i--) {
            HistoryEntry h = history.get(i);
            if (Objects.equals(h.branchId(), branchId) && h.nodeId().equals(nodeId)) {
                return h.completedOn() == null;
            }
        }
        return false;
    }

    /**
     * Reuses the existing error handler for a failed edge-condition evaluation on the sequential path.
     *
     * @param workflow the workflow definition
     * @param instance the instance being advanced
     * @param branchId the id of the branch whose edge condition failed
     * @param node     the node whose outgoing edge condition failed
     * @param result   the node result (may be {@code null})
     * @param e        the failure that occurred
     * @param work     the call-local queue receiving recovery entry work
     * @return the resolved instance
     */
    private WorkflowInstance resolveEdgeError(Workflow workflow, WorkflowInstance instance,
                                              String branchId, WorkflowNode node, NodeResult result,
                                              Exception e, Deque<BranchWork> work) {
        Recovery resolution = recover(workflow, instance, node, result,
            contextualError(WorkflowError.Phase.EDGE_CONDITION, node, e));
        return applyResolution(workflow, instance, branchId, node, resolution, work);
    }

    /**
     * Reuses the existing error handler for the "no matching edge" case on the sequential path.
     *
     * @param workflow the workflow definition
     * @param instance the instance being advanced
     * @param branchId the id of the branch with no matching outgoing edge
     * @param node     the node with no matching outgoing edge
     * @param error    the selection diagnostic already recorded by the call-local driver
     * @param work     the call-local queue receiving recovery entry work
     * @return the resolved instance
     */
    private WorkflowInstance resolveNoEdge(Workflow workflow, WorkflowInstance instance, String branchId,
                                           WorkflowNode node, WorkflowError error, Deque<BranchWork> work) {
        Recovery resolution = recover(workflow, instance, node, null, error);
        return applyResolution(workflow, instance, branchId, node, resolution, work);
    }

    private WorkflowError contextualError(WorkflowError.Phase phase, WorkflowNode node, Exception error) {
        return phase != WorkflowError.Phase.EXECUTION && phase != WorkflowError.Phase.EXECUTOR_LOOKUP
            && error instanceof WorkflowError diagnostic ? diagnostic : new WorkflowError(
            phase, node.id(), null, null, null,
            error.getMessage() == null ? error.getClass().getName() : error.getMessage(), error);
    }

    private WorkflowError validateResult(WorkflowNode node, NodeResult result) {
        if (result == null || result.status() == null) {
            return new WorkflowError(WorkflowError.Phase.RESULT_VALIDATION, node.id(), null, null,
                result == null ? "result" : "status", "Node result and status must not be null", null);
        }
        if (result.output() != null
                && ((Map<?, ?>) result.output()).keySet().stream().anyMatch(key -> !(key instanceof String))) {
            return new WorkflowError(WorkflowError.Phase.RESULT_VALIDATION, node.id(), null, null,
                "output", "Node result output keys must be non-null strings", null);
        }
        if (result.status() == NodeResultStatus.FAILED) {
            return new WorkflowError(WorkflowError.Phase.EXECUTION, node.id(), null, null, null,
                "Node returned FAILED" + (result.output() == null ? "" : ": " + diagnosticOutput(result.output())), null);
        }
        return null;
    }

    /** Keeps host value formatting exceptions from bypassing recovery; JVM Errors still propagate. */
    private String diagnosticOutput(Map<String, Object> output) {
        try {
            return output.toString();
        } catch (Exception ignored) {
            return "<output unavailable>";
        }
    }

    /** Dispatches once and validates the host response before any recovery side effects. */
    private Recovery recover(Workflow workflow, WorkflowInstance instance, WorkflowNode node,
                             NodeResult result, WorkflowError error) {
        try {
            ErrorResolution resolution = errorHandler.handleError(instance, node, result, error);
            if (resolution == null || resolution.action() == null) {
                throw new IllegalArgumentException("Error resolution and action must not be null");
            }
            String targetId = resolution.targetNodeId();
            if (resolution.action() == ErrorAction.TRANSITION) {
                if (targetId == null || targetId.isBlank()) {
                    throw new IllegalArgumentException("Error handler TRANSITION target must not be null or blank");
                }
                WorkflowNode target = workflow.findNodeById(targetId).orElseThrow(() ->
                    new IllegalArgumentException("Error handler TRANSITION target not found: " + targetId));
                if (target.type() == NodeType.START) {
                    throw new IllegalArgumentException("Cannot transition to node type: START");
                }
            } else if (targetId != null) {
                throw new IllegalArgumentException("Only TRANSITION accepts targetNodeId");
            }
            return new Recovery(resolution, error);
        } catch (Exception handlerError) {
            WorkflowError failure = new WorkflowError(WorkflowError.Phase.ERROR_HANDLER, node.id(),
                error.edgeId(), error.expression(), error.field(),
                "Error handler threw or returned an invalid resolution: " + handlerError
                    + "; original: " + error.diagnostic(), handlerError);
            failure.addSuppressed(error);
            return new Recovery(ErrorResolution.fail(), failure);
        }
    }

    private WorkflowInstance executeActionNode(Workflow workflow, WorkflowInstance instance,
                                               String branchId, WorkflowNode actionNode, Deque<BranchWork> work) {
        String actionType = actionNode.config().get("actionType") instanceof String at ? at : null;
        int retries = 0;

        while (true) {
            NodeResult result = null;
            WorkflowError error = null;
            WorkflowError.Phase phase = WorkflowError.Phase.INPUT_RESOLUTION;
            try {
                Map<String, Object> resolvedInputs = resolveNodeInputs(actionNode, instance.context());
                phase = WorkflowError.Phase.EXECUTOR_LOOKUP;
                NodeExecutor executor = executorProvider.getExecutor(actionType);
                if (executor == null) {
                    throw new IllegalStateException("No executor found for action type: " + actionType);
                }
                phase = WorkflowError.Phase.EXECUTION;
                result = executor.execute(new NodeExecutionContext(
                    actionNode, resolvedInputs, actionNode.config()));
                error = validateResult(actionNode, result);
                if (error == null && result.status() == NodeResultStatus.COMPLETED) {
                    error = validateNodeOutputs(actionNode, result.output());
                }
            } catch (Exception e) {
                error = contextualError(phase, actionNode, e);
            }

            if (error != null) {
                Recovery resolution = recover(workflow, instance, actionNode, result, error);
                if (resolution.action() == ErrorAction.RETRY) {
                    if (++retries > MAX_RETRIES) {
                        return failWorkflow(instance,
                            "Exceeded retry limit (" + MAX_RETRIES + "): " + error.diagnostic(), error);
                    }
                    continue;
                }
                return applyResolution(workflow, instance, branchId, actionNode, resolution, work);
            }

            if (result.status() == NodeResultStatus.PENDING) {
                // Park this branch: leave its history entry open (never closed here) and leave
                // instance.status() untouched (still RUNNING). The WAITING status is derived later,
                // once the whole work queue drains, by quiesce() inspecting open history entries —
                // NOT set inline here — so that a sibling fork branch parking on a PENDING ACTION
                // node cannot short-circuit the fork fan-out before the remaining fork targets are
                // entered (see issue #105).
                if (result.output() != null && !result.output().isEmpty()) {
                    instance = instance.toBuilder()
                        .mergeContext(resolveContextKeys(actionNode, result.output()))
                        .build();
                }
                return instance.toBuilder()
                    .updatedOn(Instant.now())
                    .build();
            }

            // Success — record output on history, merge into context, fire completed
            Map<String, Object> resolvedOutput = resolveContextKeys(actionNode, result.output());
            instance = completeHistoryEntry(instance, branchId, actionNode.id(), Instant.now(),
                resolvedOutput);
            instance = instance.toBuilder()
                .mergeContext(resolvedOutput)
                .updatedOn(Instant.now())
                .build();

            WorkflowInstance completedInstance = instance;
            NodeResult completedResult = result;
            fireEvent(l -> l.onNodeCompleted(completedInstance, actionNode, completedResult));

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
                throw new WorkflowError(WorkflowError.Phase.EDGE_CONDITION, node.id(), edge.id(),
                    edge.condition(), null, e.getMessage(), e);
            }
        }

        return defaultEdge;
    }

    /**
     * Applies an error-handler resolution to the branch that produced the error. TRANSITION operates on the
     * ACTUAL failing branch (identified by {@code branchId}), so recovery works correctly even when the
     * failing node sits inside a parallel region.
     *
     * @param workflow   the workflow definition
     * @param instance   the instance being advanced
     * @param branchId   the id of the branch that produced the error
     * @param node       the node the error occurred at
     * @param resolution the error handler's chosen resolution
     * @param work       the call-local queue receiving recovery entry work
     * @return the resolved instance
     */
    private WorkflowInstance applyResolution(Workflow workflow, WorkflowInstance instance, String branchId,
                                             WorkflowNode node, Recovery resolution, Deque<BranchWork> work) {
        return switch (resolution.action()) {
            case FAIL -> failWorkflow(instance, resolution.error().diagnostic(), resolution.error());
            case RETRY -> {
                work.addLast(new BranchWork(new ActiveBranch(branchId, node.id()), WorkKind.CONTINUE,
                    null, resolution.error()));
                yield instance;
            }
            case TRANSITION -> {
                WorkflowNode target = workflow.findNodeById(resolution.resolution().targetNodeId())
                    .orElse(null);
                if (target == null) {
                    yield failWorkflow(instance,
                        "Error handler TRANSITION target not found: " + resolution.resolution().targetNodeId(), null);
                }
                // Fail-safe: the token driver always supplies the failing branch's id. A null/blank
                // branchId indicates a programming error; never fabricate a "root" branch.
                if (branchId == null || branchId.isBlank()) {
                    yield failWorkflow(instance,
                        "Cannot apply TRANSITION recovery: no branch id for failing node " + node.id(), null);
                }
                // Complete the failing branch's open history entry before leaving it (parity with the
                // old single-cursor engine, which closed the source entry on every transition).
                work.removeIf(item -> item.branch().branchId().equals(branchId));
                work.addFirst(new BranchWork(new ActiveBranch(branchId, target.id()), WorkKind.ENTER,
                    null, resolution.error()));
                yield completeHistoryEntry(instance, branchId, node.id(), Instant.now(), null);
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

    /**
     * Resolves what should actually be merged into context for a completed node's raw output:
     * for a {@code receive-event} node with a non-empty {@code config.outputs} (output mappings),
     * evaluates each mapping's expression against the incoming event and the instance's current
     * (pre-merge) context; for every other node — including a receive-event node with no
     * mappings declared — falls through to the existing {@link #resolveContextKeys} rename logic,
     * which is a no-op when the node declares no {@code outputs} at all (preserving today's flat
     * merge for receive-event nodes with no mappings).
     *
     * @param instance  the instance being completed (its pre-merge context is available to mapping expressions)
     * @param node      the node that produced the output
     * @param rawOutput the raw output map (for receive-event, the raw event payload)
     * @return the map to actually merge into context
     */
    private Map<String, Object> resolveMergeOutput(WorkflowInstance instance, WorkflowNode node,
                                                    Map<String, Object> rawOutput) {
        if (node.type() == NodeType.RECEIVE_EVENT
            && node.config().get("outputs") instanceof List<?> outputDefs && !outputDefs.isEmpty()) {
            return applyEventOutputMappings(node, outputDefs, instance.context(), rawOutput == null ? Map.of() : rawOutput);
        }
        return resolveContextKeys(node, rawOutput);
    }

    /**
     * Evaluates each raw {@code {contextKey, expression}} mapping entry against the given
     * {@code event} and {@code context}, building the map of resolved values keyed by
     * {@code contextKey}. Entries missing either field, or with a non-string {@code contextKey}
     * or {@code expression}, are skipped (flagged separately by validation) rather than coerced
     * via {@code String.valueOf}, matching the UI simulator's equivalent runtime check.
     */
    private Map<String, Object> applyEventOutputMappings(WorkflowNode node, List<?> outputDefs, Map<String, Object> context,
                                                          Map<String, Object> event) {
        Map<String, Object> mapped = new HashMap<>();
        for (Object defObj : outputDefs) {
            if (defObj instanceof Map<?, ?> def
                && def.get("contextKey") instanceof String contextKey && !contextKey.isBlank()
                && def.get("expression") instanceof String expression && !expression.isBlank()) {
                try {
                    mapped.put(contextKey, conditionEvaluator.resolve(expression, context, event));
                } catch (Exception e) {
                    throw new WorkflowError(WorkflowError.Phase.OUTPUT_MAPPING, node.id(), null,
                        expression, contextKey, e.getMessage(), e);
                }
            }
        }
        return mapped;
    }

    /**
     * Remaps a node's raw produced output map so each value is keyed by its declared output's
     * effective context key (the {@code contextKey} override when present, else the declared
     * {@code name}) rather than always by {@code name}. Keys not matching any declared output for
     * this node (or present when the node declares no {@code outputs}) pass through unchanged.
     *
     * @param node      the node that produced the output
     * @param rawOutput the raw output map, keyed by declared output name
     * @return a new map with keys renamed to their effective context keys
     */
    private Map<String, Object> resolveContextKeys(WorkflowNode node, Map<String, Object> rawOutput) {
        if (rawOutput == null || rawOutput.isEmpty()) {
            return rawOutput;
        }
        Map<String, String> renames = new HashMap<>();
        if (node.config().get("outputs") instanceof List<?> outputDefs) {
            for (Object defObj : outputDefs) {
                if (defObj instanceof Map<?, ?> def) {
                    Object nameVal = def.get("name");
                    if (nameVal == null) {
                        continue;
                    }
                    String name = String.valueOf(nameVal);
                    if (def.get("contextKey") instanceof String ck && !ck.isBlank() && !ck.equals(name)) {
                        renames.put(name, ck);
                    }
                }
            }
        }
        if (renames.isEmpty()) {
            return rawOutput;
        }
        Map<String, Object> remapped = new HashMap<>();
        for (Map.Entry<String, Object> entry : rawOutput.entrySet()) {
            String key = renames.getOrDefault(entry.getKey(), entry.getKey());
            remapped.put(key, entry.getValue());
        }
        return remapped;
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
        String contextKey = o.get("contextKey") instanceof String ck && !ck.isBlank() ? ck : null;

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

        return new OutputDefinition(name, type, required, label, description, widget, defaultValue, options,
            contextKey);
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
                throw new WorkflowError(WorkflowError.Phase.INPUT_RESOLUTION, node.id(), null,
                    entry.getValue() instanceof String expression ? expression : null, label, e.getMessage(), e);
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

    private WorkflowError validateNodeOutputs(WorkflowNode node, Map<String, Object> output) {
        Object outputConfig = node.config().get("outputs");
        if (!(outputConfig instanceof List<?> outputDefs)) {
            return null;
        }
        for (Object defObj : outputDefs) {
            if (defObj instanceof Map<?, ?> def) {
                String name = String.valueOf(def.get("name"));
                boolean required = Boolean.TRUE.equals(def.get("required"));
                if (required && (output == null || !output.containsKey(name) || output.get(name) == null)) {
                    return new WorkflowError(WorkflowError.Phase.OUTPUT_VALIDATION, node.id(), null,
                        null, name, "Missing required output: " + name, null);
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
