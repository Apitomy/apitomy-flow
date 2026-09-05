# Parallel Execution (Fork/Join) — Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Give the Java workflow engine the ability to fan out into concurrent branches and re-converge
(fork/join) with wait-for-all (AND-join) semantics, replacing the single-active-node model.

**Architecture:** Concurrency is inferred from edge shape — a node whose outgoing edges are all
unconditional is a *fork* (activate all); the node where a fork's branches re-converge is an *AND-join*
(wait for all). A pure `ParallelRegions` analyzer classifies forks and pairs each with its join; both the
validator and the engine reuse it. `WorkflowInstance` gains an active-branch (token) set plus per-join
arrival tracking; `advance()` becomes a token work-queue instead of a single cursor. Parallelism must be
*structured* (well-nested, balanced), enforced by new validation rules.

**Tech Stack:** Java 17, JUnit 5, Jackson (JSON), Maven. Engine module: `engine/`.

**Spec:** `docs/superpowers/specs/2026-09-04-parallel-execution-fork-join-design.md`

**Scope note:** This plan covers the Java engine + Java validator (spec Phase 1). The TypeScript parity
work (types, `simulate.ts`, `validateWorkflow.ts`) and the UI (viewer highlighting, editor affordances)
are a separate companion plan, `2026-09-04-parallel-execution-fork-join-ui.md`. Do not touch `ui/` here.

## Global Constraints

- Language/style: Java 17, **4-space indentation**, explicit types (no ambiguous `var`), **Javadoc on
  every new public method/type**. Match the surrounding engine code style.
- Tests: **JUnit 5** (`org.junit.jupiter`). Reuse the existing fixtures in
  `io.apitomy.flow.TestWorkflows` (static factories `startNode`, `actionNode`, `humanTaskNode`,
  `endNode`, `edge`, `defaultEdge`, `inputDef`, …). Add new fixtures there when needed.
- **Do NOT run Maven builds or tests automatically** — the maintainer runs compilation and tests. Each
  task lists the exact `mvn` command and expected result so the maintainer can verify; write the failing
  test first (TDD) and hand off for the maintainer to run, unless the maintainer asks you to run it.
- Commit after each task with a `git add` of exactly the files that task touched.
- **Structured parallelism only:** every fork has exactly one matching join; branches do not cross
  region boundaries; a parallel branch may not reach `END` without first joining. Unstructured graphs are
  rejected by validation, never executed.
- **Join semantics:** wait-for-all (AND-join). **Branch failure:** fail-fast — a failed/cancelled branch
  fails/cancels the whole instance and cancels siblings. **`END`:** terminates the whole instance.
- **Context:** unchanged — a single flat `Map<String,Object>`, last-write-wins `mergeContext`.
- Backward compatibility: non-parallel workflows must behave exactly as today; the entire existing engine
  test suite must stay green. `WorkflowInstance.currentNodeId()` remains populated for single-branch
  states (sole active node) and the terminal node on completion.

---

### Task 1: Active-branch state model

Add the token state to the data model without changing execution behavior yet. After this task the whole
module still compiles and the existing test suite is green (non-parallel workflows run with a single root
branch).

**Files:**
- Create: `engine/src/main/java/io/apitomy/flow/model/ActiveBranch.java`
- Modify: `engine/src/main/java/io/apitomy/flow/model/HistoryEntry.java` (add `branchId`)
- Modify: `engine/src/main/java/io/apitomy/flow/model/WorkflowInstance.java` (add `activeBranches`,
  `joinArrivals`, builder support)
- Test: `engine/src/test/java/io/apitomy/flow/model/WorkflowInstanceModelTest.java`

**Interfaces:**
- Produces:
  - `record ActiveBranch(String branchId, String nodeId)`.
  - `HistoryEntry` gains a trailing `String branchId` component, **plus** a 7-arg convenience constructor
    (delegates with `branchId = null`) so existing `new HistoryEntry(...)` call sites keep compiling.
  - `WorkflowInstance` gains components `List<ActiveBranch> activeBranches` and
    `Map<String, List<String>> joinArrivals`, and builder methods `activeBranches(...)`,
    `addActiveBranch(ActiveBranch)`, `removeActiveBranch(String branchId)`, `joinArrivals(...)`,
    `recordJoinArrival(String joinNodeId, String edgeId)`.

- [ ] **Step 1: Write the failing model test**

Create `engine/src/test/java/io/apitomy/flow/model/WorkflowInstanceModelTest.java`:
```java
package io.apitomy.flow.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class WorkflowInstanceModelTest {

    @Test
    void builderTracksActiveBranchesAndJoinArrivals() {
        WorkflowInstance instance = WorkflowInstance.builder()
            .id("i").workflowId("w").currentNodeId("a")
            .status(InstanceStatus.RUNNING)
            .addActiveBranch(new ActiveBranch("root", "a"))
            .addActiveBranch(new ActiveBranch("root.0", "b"))
            .recordJoinArrival("j", "e1")
            .createdOn(Instant.now()).updatedOn(Instant.now())
            .build();

        assertEquals(2, instance.activeBranches().size());
        assertEquals(List.of("e1"), instance.joinArrivals().get("j"));
    }

    @Test
    void removeActiveBranchRemovesById() {
        WorkflowInstance instance = WorkflowInstance.builder()
            .id("i").workflowId("w")
            .status(InstanceStatus.RUNNING)
            .addActiveBranch(new ActiveBranch("root", "a"))
            .addActiveBranch(new ActiveBranch("root.0", "b"))
            .removeActiveBranch("root")
            .createdOn(Instant.now()).updatedOn(Instant.now())
            .build();

        assertEquals(1, instance.activeBranches().size());
        assertEquals("root.0", instance.activeBranches().getFirst().branchId());
    }

    @Test
    void toBuilderDeepCopiesBranchState() {
        WorkflowInstance original = WorkflowInstance.builder()
            .id("i").workflowId("w").status(InstanceStatus.RUNNING)
            .addActiveBranch(new ActiveBranch("root", "a"))
            .recordJoinArrival("j", "e1")
            .createdOn(Instant.now()).updatedOn(Instant.now())
            .build();

        WorkflowInstance copy = original.toBuilder()
            .addActiveBranch(new ActiveBranch("root.0", "b"))
            .recordJoinArrival("j", "e2")
            .build();

        // original must be untouched (immutability)
        assertEquals(1, original.activeBranches().size());
        assertEquals(List.of("e1"), original.joinArrivals().get("j"));
        assertEquals(2, copy.activeBranches().size());
        assertEquals(List.of("e1", "e2"), copy.joinArrivals().get("j"));
    }

    @Test
    void legacyHistoryEntryConstructorDefaultsBranchIdToNull() {
        HistoryEntry entry = new HistoryEntry("n", "N", "e", null,
            Instant.now(), null, Map.of());
        assertNull(entry.branchId());
    }

    @Test
    void serializesActiveBranchesToJson() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        WorkflowInstance instance = WorkflowInstance.builder()
            .id("i").workflowId("w").currentNodeId("a")
            .status(InstanceStatus.RUNNING)
            .addActiveBranch(new ActiveBranch("root", "a"))
            .createdOn(Instant.now()).updatedOn(Instant.now())
            .build();

        String json = mapper.writeValueAsString(instance);
        assertTrue(json.contains("\"activeBranches\""));
        WorkflowInstance roundTripped = mapper.readValue(json, WorkflowInstance.class);
        assertEquals("root", roundTripped.activeBranches().getFirst().branchId());
    }
}
```

- [ ] **Step 2: Verify it fails to compile / fails**

Run: `mvn -q -pl engine test -Dtest=WorkflowInstanceModelTest`
Expected: FAIL — `ActiveBranch` does not exist; `addActiveBranch`/`recordJoinArrival`/`branchId()` are
undefined.

- [ ] **Step 3: Create the `ActiveBranch` record**

Create `engine/src/main/java/io/apitomy/flow/model/ActiveBranch.java`:
```java
package io.apitomy.flow.model;

/**
 * A single live position in a running workflow — one concurrent branch (token). The engine holds a set
 * of these on the {@link WorkflowInstance}; a non-parallel workflow always has exactly one (the root).
 *
 * @param branchId a stable id for this branch; the root branch is {@code "root"}, fork children are
 *                 {@code "<parent>.<index>"}
 * @param nodeId   the id of the node this branch currently sits at
 */
public record ActiveBranch(String branchId, String nodeId) {}
```

- [ ] **Step 4: Add `branchId` to `HistoryEntry` with a back-compat constructor**

Replace the body of `engine/src/main/java/io/apitomy/flow/model/HistoryEntry.java`:
```java
package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonFormat;

import java.time.Instant;
import java.util.Map;

public record HistoryEntry(
    String nodeId,
    String nodeName,
    String edgeId,
    String edgeCondition,
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant enteredOn,
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant completedOn,
    Map<String, Object> output,
    String branchId
) {
    /**
     * Back-compat constructor for callers that predate branch attribution; sets {@code branchId} to
     * {@code null} (the root/non-parallel branch).
     */
    public HistoryEntry(String nodeId, String nodeName, String edgeId, String edgeCondition,
                        Instant enteredOn, Instant completedOn, Map<String, Object> output) {
        this(nodeId, nodeName, edgeId, edgeCondition, enteredOn, completedOn, output, null);
    }
}
```

- [ ] **Step 5: Add active-branch state to `WorkflowInstance`**

In `engine/src/main/java/io/apitomy/flow/model/WorkflowInstance.java`, add the two components to the
record header (after `history`) and wire the builder. The full file becomes:
```java
package io.apitomy.flow.model;

import com.fasterxml.jackson.annotation.JsonFormat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public record WorkflowInstance(
    String id,
    String workflowId,
    String currentNodeId,
    InstanceStatus status,
    Map<String, Object> context,
    List<HistoryEntry> history,
    List<ActiveBranch> activeBranches,
    Map<String, List<String>> joinArrivals,
    String failureReason,
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant createdOn,
    @JsonFormat(shape = JsonFormat.Shape.STRING) Instant updatedOn
) {
    public static Builder builder() {
        return new Builder();
    }

    public Builder toBuilder() {
        Map<String, List<String>> copiedArrivals = new LinkedHashMap<>();
        joinArrivals.forEach((k, v) -> copiedArrivals.put(k, new ArrayList<>(v)));
        return new Builder()
            .id(id).workflowId(workflowId).currentNodeId(currentNodeId)
            .status(status).context(new HashMap<>(context))
            .history(new ArrayList<>(history))
            .activeBranches(new ArrayList<>(activeBranches))
            .joinArrivals(copiedArrivals)
            .failureReason(failureReason)
            .createdOn(createdOn).updatedOn(updatedOn);
    }

    public static class Builder {
        private String id;
        private String workflowId;
        private String currentNodeId;
        private InstanceStatus status;
        private Map<String, Object> context = new HashMap<>();
        private List<HistoryEntry> history = new ArrayList<>();
        private List<ActiveBranch> activeBranches = new ArrayList<>();
        private Map<String, List<String>> joinArrivals = new LinkedHashMap<>();
        private String failureReason;
        private Instant createdOn;
        private Instant updatedOn;

        public Builder id(String id) { this.id = id; return this; }
        public Builder workflowId(String workflowId) { this.workflowId = workflowId; return this; }
        public Builder currentNodeId(String currentNodeId) { this.currentNodeId = currentNodeId; return this; }
        public Builder status(InstanceStatus status) { this.status = status; return this; }
        public Builder context(Map<String, Object> context) { this.context = context; return this; }
        public Builder history(List<HistoryEntry> history) { this.history = history; return this; }
        public Builder activeBranches(List<ActiveBranch> activeBranches) { this.activeBranches = activeBranches; return this; }
        public Builder joinArrivals(Map<String, List<String>> joinArrivals) { this.joinArrivals = joinArrivals; return this; }
        public Builder failureReason(String failureReason) { this.failureReason = failureReason; return this; }
        public Builder createdOn(Instant createdOn) { this.createdOn = createdOn; return this; }
        public Builder updatedOn(Instant updatedOn) { this.updatedOn = updatedOn; return this; }

        public Builder addHistory(HistoryEntry entry) {
            this.history.add(entry);
            return this;
        }

        public Builder addActiveBranch(ActiveBranch branch) {
            this.activeBranches.add(branch);
            return this;
        }

        public Builder removeActiveBranch(String branchId) {
            this.activeBranches.removeIf(b -> b.branchId().equals(branchId));
            return this;
        }

        public Builder recordJoinArrival(String joinNodeId, String edgeId) {
            this.joinArrivals.computeIfAbsent(joinNodeId, k -> new ArrayList<>()).add(edgeId);
            return this;
        }

        public Builder mergeContext(Map<String, Object> output) {
            if (output != null) this.context.putAll(output);
            return this;
        }

        public WorkflowInstance build() {
            Map<String, List<String>> frozenArrivals = new LinkedHashMap<>();
            joinArrivals.forEach((k, v) -> frozenArrivals.put(k, List.copyOf(v)));
            return new WorkflowInstance(id, workflowId, currentNodeId, status,
                Map.copyOf(context), List.copyOf(history), List.copyOf(activeBranches),
                Map.copyOf(frozenArrivals), failureReason, createdOn, updatedOn);
        }
    }
}
```

- [ ] **Step 6: Verify the model test passes and the module still compiles**

Run: `mvn -q -pl engine test -Dtest=WorkflowInstanceModelTest`
Expected: PASS.
Run: `mvn -q -pl engine test`
Expected: the entire existing engine suite still PASSES (behavior unchanged; new fields default to
empty/null). If any test constructed `WorkflowInstance` via its canonical constructor directly (not the
builder), update it to the builder; none currently do.

- [ ] **Step 7: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/model/ActiveBranch.java \
        engine/src/main/java/io/apitomy/flow/model/HistoryEntry.java \
        engine/src/main/java/io/apitomy/flow/model/WorkflowInstance.java \
        engine/src/test/java/io/apitomy/flow/model/WorkflowInstanceModelTest.java
git commit -m "feat(engine): active-branch state model for parallel execution"
```

---

### Task 2: `ParallelRegions` structural analyzer

A pure, dependency-free analyzer that both the validator (Task 3) and the engine (Task 4) reuse. It
classifies fork nodes, pairs each fork with its join, and reports structural problems. Keeping it pure
makes it exhaustively unit-testable.

**Files:**
- Create: `engine/src/main/java/io/apitomy/flow/engine/ParallelRegions.java`
- Test: `engine/src/test/java/io/apitomy/flow/engine/ParallelRegionsTest.java`

**Interfaces:**
- Consumes: `Workflow`, `WorkflowNode`, `WorkflowEdge`, `NodeType` from `io.apitomy.flow.model`.
- Produces:
  - `static ParallelRegions analyze(Workflow workflow)`.
  - `boolean isFork(String nodeId)` — node has ≥2 outgoing edges, all unconditional (no `condition`,
    none `isDefault`).
  - `boolean isJoin(String nodeId)` — node is the matching join of some fork.
  - `String joinFor(String forkNodeId)` — the join node id paired with a fork, or `null`.
  - `Set<String> incomingEdgeIds(String joinNodeId)` — the incoming edge ids the join must collect
    before firing (all incoming edges of the join).
  - `List<Problem> problems()` — structural issues, each `record Problem(String code, String nodeId)`
    using the codes from Task 3.

Fork classification rule (mirror in the validator and engine): a node is a fork iff
`outgoing.size() >= 2 && outgoing.stream().allMatch(e -> (e.condition()==null || e.condition().isBlank()) && !e.isDefault())`.
A node whose outgoing edges *mix* unconditional-non-default edges with conditional/default edges yields a
`MIXED_FORK_EDGES` problem and is treated as a non-fork (exclusive choice).

Join pairing rule: the join of fork `F` is the unique node that is the common post-dominator of `F`'s
successor branches — i.e. the first node at which every path leaving `F` re-converges. Compute it by
walking each branch forward and intersecting the sets of nodes reached; the earliest common node is the
join. If the branches never share a common convergence node → `FORK_WITHOUT_JOIN`; if they converge at
different nodes / not all at one node → `UNBALANCED_PARALLEL`.

- [ ] **Step 1: Write the failing analyzer tests**

Create `engine/src/test/java/io/apitomy/flow/engine/ParallelRegionsTest.java`:
```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.Workflow;
import org.junit.jupiter.api.Test;

import java.util.List;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class ParallelRegionsTest {

    /** start → (fork) → a1, a2 → (join) j → end */
    private Workflow diamond() {
        return new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a1", "t1"), actionNode("a2", "t2"),
                actionNode("j", "tj"), endNode("end")),
            List.of(edge("e1", "start", "a1"), edge("e2", "start", "a2"),
                edge("e3", "a1", "j"), edge("e4", "a2", "j"), edge("e5", "j", "end")));
    }

    @Test
    void classifiesForkAndJoin() {
        ParallelRegions regions = ParallelRegions.analyze(diamond());
        assertTrue(regions.isFork("start"));
        assertTrue(regions.isJoin("j"));
        assertEquals("j", regions.joinFor("start"));
        assertTrue(regions.problems().isEmpty());
    }

    @Test
    void joinIncomingEdgesAreAllIncoming() {
        ParallelRegions regions = ParallelRegions.analyze(diamond());
        assertEquals(java.util.Set.of("e3", "e4"), regions.incomingEdgeIds("j"));
    }

    @Test
    void exclusiveChoiceIsNotAFork() {
        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "t"), actionNode("b", "t2"), endNode("end")),
            List.of(edge("e1", "start", "a", "context.x == 1", 1), defaultEdge("e2", "start", "b"),
                edge("e3", "a", "end"), edge("e4", "b", "end")));
        ParallelRegions regions = ParallelRegions.analyze(wf);
        assertFalse(regions.isFork("start"));
        assertTrue(regions.problems().isEmpty());
    }

    @Test
    void mixedForkEdgesReported() {
        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a", "t"), actionNode("b", "t2"), endNode("end")),
            List.of(edge("e1", "start", "a"), edge("e2", "start", "b", "context.x == 1", 1),
                edge("e3", "a", "end"), edge("e4", "b", "end")));
        ParallelRegions regions = ParallelRegions.analyze(wf);
        assertFalse(regions.isFork("start"));
        assertTrue(regions.problems().stream().anyMatch(p -> p.code().equals("MIXED_FORK_EDGES")));
    }

    @Test
    void forkWithoutJoinReported() {
        // both branches run straight to their own end — never re-converge
        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), actionNode("a1", "t1"), actionNode("a2", "t2"),
                endNode("end1"), endNode("end2")),
            List.of(edge("e1", "start", "a1"), edge("e2", "start", "a2"),
                edge("e3", "a1", "end1"), edge("e4", "a2", "end2")));
        ParallelRegions regions = ParallelRegions.analyze(wf);
        assertTrue(regions.problems().stream()
            .anyMatch(p -> p.code().equals("FORK_WITHOUT_JOIN") || p.code().equals("PARALLEL_BRANCH_REACHES_END")));
    }
}
```

- [ ] **Step 2: Verify it fails**

Run: `mvn -q -pl engine test -Dtest=ParallelRegionsTest`
Expected: FAIL — `ParallelRegions` does not exist.

- [ ] **Step 3: Implement the analyzer**

Create `engine/src/main/java/io/apitomy/flow/engine/ParallelRegions.java`:
```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.NodeType;
import io.apitomy.flow.model.Workflow;
import io.apitomy.flow.model.WorkflowEdge;
import io.apitomy.flow.model.WorkflowNode;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Static structural analysis of a workflow's parallel regions. Classifies fork nodes (all-unconditional
 * multi-out), pairs each fork with its synchronizing join, and reports structural problems that make a
 * region ill-formed. Pure and side-effect free; shared by the validator and the engine so both agree on
 * what a fork is, what its join is, and what a well-formed region looks like.
 */
public final class ParallelRegions {

    /** A structural problem discovered during analysis. */
    public record Problem(String code, String nodeId) {}

    private final Set<String> forks;
    private final Map<String, String> forkToJoin;
    private final Set<String> joins;
    private final Map<String, Set<String>> joinIncomingEdgeIds;
    private final List<Problem> problems;

    private ParallelRegions(Set<String> forks, Map<String, String> forkToJoin, Set<String> joins,
                            Map<String, Set<String>> joinIncomingEdgeIds, List<Problem> problems) {
        this.forks = forks;
        this.forkToJoin = forkToJoin;
        this.joins = joins;
        this.joinIncomingEdgeIds = joinIncomingEdgeIds;
        this.problems = problems;
    }

    /**
     * Analyzes a workflow's parallel structure.
     *
     * @param workflow the workflow to analyze
     * @return the computed regions and any structural problems
     */
    public static ParallelRegions analyze(Workflow workflow) {
        Set<String> forks = new LinkedHashSet<>();
        Map<String, String> forkToJoin = new LinkedHashMap<>();
        Set<String> joins = new LinkedHashSet<>();
        Map<String, Set<String>> joinIncoming = new LinkedHashMap<>();
        List<Problem> problems = new ArrayList<>();

        for (WorkflowNode node : workflow.nodes()) {
            List<WorkflowEdge> outgoing = workflow.getOutgoingEdges(node.id());
            if (outgoing.size() < 2) {
                continue;
            }
            boolean anyUnconditionalNonDefault = outgoing.stream()
                .anyMatch(e -> isUnconditional(e) && !e.isDefault());
            boolean allUnconditionalNonDefault = outgoing.stream()
                .allMatch(e -> isUnconditional(e) && !e.isDefault());

            if (allUnconditionalNonDefault) {
                forks.add(node.id());
            } else if (anyUnconditionalNonDefault) {
                // mixes fork-shaped edges with conditional/default edges — ambiguous
                problems.add(new Problem("MIXED_FORK_EDGES", node.id()));
            }
        }

        for (String forkId : forks) {
            String join = findJoin(workflow, forkId, problems);
            if (join != null) {
                forkToJoin.put(forkId, join);
                joins.add(join);
                Set<String> incoming = new LinkedHashSet<>();
                for (WorkflowEdge e : workflow.getIncomingEdges(join)) {
                    incoming.add(e.id());
                }
                joinIncoming.put(join, incoming);
            }
        }

        return new ParallelRegions(forks, forkToJoin, joins, joinIncoming, problems);
    }

    private static boolean isUnconditional(WorkflowEdge e) {
        return e.condition() == null || e.condition().isBlank();
    }

    /**
     * Finds the synchronizing join for a fork: the first node where every branch leaving the fork
     * re-converges. Adds a {@code FORK_WITHOUT_JOIN} / {@code PARALLEL_BRANCH_REACHES_END} /
     * {@code UNBALANCED_PARALLEL} problem when no single balanced convergence node exists.
     */
    private static String findJoin(Workflow workflow, String forkId, List<Problem> problems) {
        List<WorkflowEdge> branches = workflow.getOutgoingEdges(forkId);
        List<Set<String>> reachablePerBranch = new ArrayList<>();
        boolean anyBranchReachesEnd = false;

        for (WorkflowEdge branch : branches) {
            Set<String> reachable = new LinkedHashSet<>();
            Deque<String> queue = new ArrayDeque<>();
            queue.add(branch.target());
            while (!queue.isEmpty()) {
                String current = queue.poll();
                if (!reachable.add(current)) {
                    continue;
                }
                WorkflowNode node = workflow.findNodeById(current).orElse(null);
                if (node != null && node.type() == NodeType.END) {
                    anyBranchReachesEnd = true;
                }
                for (WorkflowEdge out : workflow.getOutgoingEdges(current)) {
                    queue.add(out.target());
                }
            }
            reachablePerBranch.add(reachable);
        }

        // The join is the earliest node reachable from ALL branches.
        Set<String> common = new LinkedHashSet<>(reachablePerBranch.get(0));
        for (int i = 1; i < reachablePerBranch.size(); i++) {
            common.retainAll(reachablePerBranch.get(i));
        }
        if (common.isEmpty()) {
            problems.add(new Problem(anyBranchReachesEnd ? "PARALLEL_BRANCH_REACHES_END"
                : "FORK_WITHOUT_JOIN", forkId));
            return null;
        }

        // Earliest common node = the one whose incoming edges come from every branch. Choose the common
        // node reachable in the fewest steps from the fork along any branch (BFS order preserved above).
        String join = firstCommon(reachablePerBranch, common);

        // Balance check: every branch must reach the join without first hitting END.
        for (WorkflowEdge branch : branches) {
            if (reachesEndBeforeJoin(workflow, branch.target(), join)) {
                problems.add(new Problem("PARALLEL_BRANCH_REACHES_END", forkId));
                return null;
            }
        }
        return join;
    }

    private static String firstCommon(List<Set<String>> reachablePerBranch, Set<String> common) {
        // Use the first branch's insertion order (BFS) as the canonical ordering and return the first
        // element that is common to all branches.
        for (String candidate : reachablePerBranch.get(0)) {
            if (common.contains(candidate)) {
                return candidate;
            }
        }
        return common.iterator().next();
    }

    private static boolean reachesEndBeforeJoin(Workflow workflow, String start, String join) {
        Set<String> visited = new HashSet<>();
        Deque<String> queue = new ArrayDeque<>();
        queue.add(start);
        while (!queue.isEmpty()) {
            String current = queue.poll();
            if (current.equals(join) || !visited.add(current)) {
                continue;
            }
            WorkflowNode node = workflow.findNodeById(current).orElse(null);
            if (node != null && node.type() == NodeType.END) {
                return true;
            }
            for (WorkflowEdge out : workflow.getOutgoingEdges(current)) {
                queue.add(out.target());
            }
        }
        return false;
    }

    /** @return true if the node is a fork (all-unconditional, ≥2 outgoing edges). */
    public boolean isFork(String nodeId) { return forks.contains(nodeId); }

    /** @return true if the node is the synchronizing join of some fork. */
    public boolean isJoin(String nodeId) { return joins.contains(nodeId); }

    /** @return the join node id paired with the given fork, or {@code null} if none. */
    public String joinFor(String forkNodeId) { return forkToJoin.get(forkNodeId); }

    /** @return the incoming edge ids a join must collect before it fires. */
    public Set<String> incomingEdgeIds(String joinNodeId) {
        return joinIncomingEdgeIds.getOrDefault(joinNodeId, Set.of());
    }

    /** @return the structural problems discovered during analysis. */
    public List<Problem> problems() { return problems; }
}
```

- [ ] **Step 4: Verify the analyzer tests pass**

Run: `mvn -q -pl engine test -Dtest=ParallelRegionsTest`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/engine/ParallelRegions.java \
        engine/src/test/java/io/apitomy/flow/engine/ParallelRegionsTest.java
git commit -m "feat(engine): structured fork/join region analyzer"
```

---

### Task 3: Validation rules for structured parallelism

Wire `ParallelRegions` into `WorkflowValidator`: retire the `UNCONDITIONAL_MULTIPLE_EDGES` warning (that
shape is now a valid fork) and surface the structural problems as validation errors.

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/validation/WorkflowValidator.java`
- Modify: `engine/src/test/java/io/apitomy/flow/validation/WorkflowValidatorTest.java`

**Interfaces:**
- Consumes: `ParallelRegions.analyze(workflow)` and its `problems()` from Task 2.
- Produces: new error codes `MIXED_FORK_EDGES`, `FORK_WITHOUT_JOIN`, `UNBALANCED_PARALLEL`,
  `CROSSING_PARALLEL_REGIONS`, `PARALLEL_BRANCH_REACHES_END`, `PARALLEL_REGION_CYCLE` (emitted as
  `ValidationProblem.error(code, message, nodeId)`); removal of `UNCONDITIONAL_MULTIPLE_EDGES`.

- [ ] **Step 1: Write/adjust the failing validator tests**

In `engine/src/test/java/io/apitomy/flow/validation/WorkflowValidatorTest.java`, add these tests (and
remove or invert any existing test that asserts `UNCONDITIONAL_MULTIPLE_EDGES` is produced — search the
file for that string first):
```java
@Test
void balancedForkJoinHasNoParallelProblems() {
    Workflow wf = new Workflow("w", "W", null, null,
        List.of(startNode("start"), actionNode("a1", "t1"), actionNode("a2", "t2"),
            actionNode("j", "tj"), endNode("end")),
        List.of(edge("e1", "start", "a1"), edge("e2", "start", "a2"),
            edge("e3", "a1", "j"), edge("e4", "a2", "j"), edge("e5", "j", "end")));
    List<ValidationProblem> problems = new WorkflowValidator().validate(wf);
    assertTrue(problems.stream().noneMatch(p -> p.code().equals("UNCONDITIONAL_MULTIPLE_EDGES")));
    assertTrue(problems.stream().noneMatch(p -> p.code().startsWith("FORK_")
        || p.code().equals("MIXED_FORK_EDGES") || p.code().equals("UNBALANCED_PARALLEL")));
}

@Test
void mixedForkEdgesIsError() {
    Workflow wf = new Workflow("w", "W", null, null,
        List.of(startNode("start"), actionNode("a", "t"), actionNode("b", "t2"),
            actionNode("j", "tj"), endNode("end")),
        List.of(edge("e1", "start", "a"), edge("e2", "start", "b", "context.x == 1", 1),
            edge("e3", "a", "j"), edge("e4", "b", "j"), edge("e5", "j", "end")));
    WorkflowValidator validator = new WorkflowValidator();
    List<ValidationProblem> problems = validator.validate(wf);
    assertTrue(problems.stream().anyMatch(p -> p.code().equals("MIXED_FORK_EDGES")
        && p.severity() == ValidationSeverity.ERROR));
    assertTrue(validator.hasErrors(problems));
}

@Test
void forkBranchReachingEndIsError() {
    Workflow wf = new Workflow("w", "W", null, null,
        List.of(startNode("start"), actionNode("a1", "t1"), actionNode("a2", "t2"),
            endNode("end1"), endNode("end2")),
        List.of(edge("e1", "start", "a1"), edge("e2", "start", "a2"),
            edge("e3", "a1", "end1"), edge("e4", "a2", "end2")));
    List<ValidationProblem> problems = new WorkflowValidator().validate(wf);
    assertTrue(problems.stream().anyMatch(p ->
        p.code().equals("PARALLEL_BRANCH_REACHES_END") || p.code().equals("FORK_WITHOUT_JOIN")));
}
```
Ensure the imports at the top of the test file include `io.apitomy.flow.validation.*` types already used
(`ValidationProblem`, `ValidationSeverity`) and `java.util.List` — they are already present.

- [ ] **Step 2: Verify the new tests fail**

Run: `mvn -q -pl engine test -Dtest=WorkflowValidatorTest`
Expected: FAIL — `MIXED_FORK_EDGES` / `PARALLEL_BRANCH_REACHES_END` are not produced yet, and the
balanced-fork test still sees `UNCONDITIONAL_MULTIPLE_EDGES`.

- [ ] **Step 3: Retire `UNCONDITIONAL_MULTIPLE_EDGES`**

In `WorkflowValidator.validateEdgeConditions(...)`, delete the block that emits
`UNCONDITIONAL_MULTIPLE_EDGES` (the `allUnconditional && defaults.isEmpty()` check, currently
`WorkflowValidator.java:304-310`):
```java
// DELETE THIS BLOCK:
// boolean allUnconditional = outgoing.stream()
//     .allMatch(e -> e.condition() == null || e.condition().isBlank());
// if (allUnconditional && defaults.isEmpty()) {
//     problems.add(ValidationProblem.warning("UNCONDITIONAL_MULTIPLE_EDGES",
//         "Node has multiple outgoing edges with no conditions", entry.getKey()));
// }
```

- [ ] **Step 4: Emit the structural parallelism problems**

Add a new phase call in `validate(...)`:
```java
public List<ValidationProblem> validate(Workflow workflow) {
    List<ValidationProblem> problems = new ArrayList<>();
    validateStructure(workflow, problems);
    validateConnectivity(workflow, problems);
    validateEdgeConditions(workflow, problems);
    validateSemantics(workflow, problems);
    validateParallelStructure(workflow, problems);
    return problems;
}
```
Then add the method (place it after `validateSemantics`):
```java
/**
 * Validates structured-parallelism constraints using {@link ParallelRegions}. Every problem is an
 * ERROR: a malformed fork/join region cannot be executed by the engine.
 *
 * @param workflow the workflow to validate
 * @param problems the accumulating problem list
 */
private void validateParallelStructure(Workflow workflow, List<ValidationProblem> problems) {
    ParallelRegions regions = ParallelRegions.analyze(workflow);
    for (ParallelRegions.Problem p : regions.problems()) {
        problems.add(ValidationProblem.error(p.code(), messageForParallelProblem(p.code()), p.nodeId()));
    }
}

private String messageForParallelProblem(String code) {
    return switch (code) {
        case "MIXED_FORK_EDGES" ->
            "Node mixes unconditional (fork) edges with conditional/default edges; make all outgoing "
                + "edges unconditional to fork, or add conditions/a default for exclusive choice";
        case "FORK_WITHOUT_JOIN" ->
            "Parallel branches from this fork do not re-converge at a single join";
        case "UNBALANCED_PARALLEL" ->
            "Parallel branches from this fork converge at different points (unbalanced)";
        case "CROSSING_PARALLEL_REGIONS" ->
            "An edge crosses a parallel region boundary (regions must be well-nested)";
        case "PARALLEL_BRANCH_REACHES_END" ->
            "A parallel branch can reach an end node without first joining";
        case "PARALLEL_REGION_CYCLE" ->
            "A cycle exists inside a parallel region";
        default -> "Invalid parallel structure";
    };
}
```
Add the import `import io.apitomy.flow.engine.ParallelRegions;` at the top of `WorkflowValidator.java`
(it already imports `io.apitomy.flow.engine.ConditionEvaluator`, so the `io.apitomy.flow.engine` package
is already a dependency direction that compiles).

- [ ] **Step 5: Verify all validator tests pass**

Run: `mvn -q -pl engine test -Dtest=WorkflowValidatorTest`
Expected: PASS. Also run the full suite to catch any other test that depended on
`UNCONDITIONAL_MULTIPLE_EDGES`: `mvn -q -pl engine test`. Fix any such test to reflect the retired code.

- [ ] **Step 6: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/validation/WorkflowValidator.java \
        engine/src/test/java/io/apitomy/flow/validation/WorkflowValidatorTest.java
git commit -m "feat(engine): validation rules for structured fork/join"
```

---

### Task 4: Token-based `advance()` with fork fan-out and AND-join

Rewrite the engine's execution loop to drive a set of concurrent branches: fork nodes fan out, join
nodes wait for all branches, `END` terminates the whole instance, and any branch failure fails the whole
instance (fail-fast). Non-parallel workflows keep running with a single root branch, so the existing
suite stays green.

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java`
- Modify: `engine/src/test/java/io/apitomy/flow/TestWorkflows.java` (add a `diamondForkJoinWorkflow`
  fixture)
- Test: `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineParallelTest.java`

**Interfaces:**
- Consumes: `ParallelRegions` (Task 2), the active-branch state (Task 1), existing `executeActionNode`,
  `selectEdge`, `completeCurrentHistoryEntry`, `failWorkflow`, `fireEvent`.
- Produces: a token-driven `advance(...)`; a new private helper
  `advanceBranches(Workflow, WorkflowInstance, Deque<ActiveBranch> work, ParallelRegions)`; a
  branch-scoped `completeHistoryEntry(instance, branchId, nodeId, completedOn, output)`.

The design (implement exactly this control flow):

- `advance()` seeds a work queue with the branches that need to continue (initially the root branch at
  the start node) and delegates to `advanceBranches`.
- `advanceBranches` pops a branch, resolves its node's outgoing edges, and for each target calls
  `moveBranch`:
  - **Fork** (`regions.isFork(nodeId)`): complete the fork node's history entry once, then for each
    outgoing edge spawn a child branch `"<parent>.<i>"` and `moveBranch` it; retire the parent branch.
  - **Sequential**: `selectEdge` picks one edge; `moveBranch` reuses the same branch.
- `moveBranch(branch, edge)`:
  - Complete the moving branch's current history entry.
  - If the target is a **join** (`regions.isJoin(target)`): record the arrival edge; retire this branch;
    if arrivals now cover every incoming edge of the join, create a fresh continuing branch at the join
    and **enter** it (below). Otherwise the branch is absorbed (waiting for siblings).
  - Else **enter** the target with this branch.
- **Enter** a node (`enterNode`): add a branch-attributed history entry, fire `onNodeEntered`, then
  dispatch on type: `ACTION` → execute; if still RUNNING enqueue the branch to continue; `HUMAN_TASK`/
  `RECEIVE_EVENT`/`WAIT` → leave the branch active with an open history entry (blocked); `END` →
  terminate the whole instance COMPLETED; `START` → fail.
- After the queue drains, derive status: terminal stays terminal; otherwise if any active branch sits at
  a blocking node → `WAITING`; if there are no active branches and it is not terminal → fail
  (`"parallel deadlock"`, defensive — validation prevents this). Maintain `currentNodeId` = the sole
  active branch's node when there is exactly one, else `null`; on COMPLETED set it to the end node.

- [ ] **Step 1: Add the diamond fixture**

In `engine/src/test/java/io/apitomy/flow/TestWorkflows.java`, add:
```java
/** start → (fork) a1, a2 → (AND-join) j → end. Actions use the given action types. */
public static Workflow diamondForkJoinWorkflow(String t1, String t2, String tj) {
    return new Workflow("wf-diamond", "Diamond", null, null,
        List.of(startNode("start"), actionNode("a1", t1), actionNode("a2", t2),
            actionNode("j", tj), endNode("end")),
        List.of(edge("e1", "start", "a1"), edge("e2", "start", "a2"),
            edge("e3", "a1", "j"), edge("e4", "a2", "j"), edge("e5", "j", "end")));
}
```

- [ ] **Step 2: Write the failing parallel-execution tests**

Create `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineParallelTest.java`:
```java
package io.apitomy.flow.engine;

import io.apitomy.flow.model.*;
import io.apitomy.flow.spi.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static io.apitomy.flow.TestWorkflows.*;
import static org.junit.jupiter.api.Assertions.*;

class WorkflowEngineParallelTest {

    private WorkflowEngine engine(NodeExecutor... executors) {
        return new WorkflowEngine(NodeExecutorProvider.fromList(executors), List.of(), null);
    }

    private NodeExecutor echo(String actionType, String outKey, Object outVal) {
        return new NodeExecutor() {
            public String actionType() { return actionType; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of(outKey, outVal));
            }
        };
    }

    @Test
    void forkRunsBothBranchesThenJoinsOnce() {
        AtomicInteger joinRuns = new AtomicInteger();
        NodeExecutor joinExec = new NodeExecutor() {
            public String actionType() { return "tj"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                joinRuns.incrementAndGet();
                return new NodeResult(NodeResultStatus.COMPLETED, Map.of("joined", true));
            }
        };
        WorkflowEngine engine = engine(echo("t1", "left", 1), echo("t2", "right", 2), joinExec);
        WorkflowInstance result = engine.startWorkflow(
            diamondForkJoinWorkflow("t1", "t2", "tj"), Map.of());

        assertEquals(InstanceStatus.COMPLETED, result.status());
        assertEquals(1, joinRuns.get(), "join must execute exactly once");
        assertEquals(1, result.context().get("left"));
        assertEquals(2, result.context().get("right"));
        assertEquals(true, result.context().get("joined"));
    }

    @Test
    void joinWaitsForBothBranches() {
        // one branch is a human task that parks; the join must not fire until it completes
        Workflow wf = new Workflow("w", "W", null, null,
            List.of(startNode("start"), humanTaskNode("task"), actionNode("a2", "t2"),
                actionNode("j", "tj"), endNode("end")),
            List.of(edge("e1", "start", "task"), edge("e2", "start", "a2"),
                edge("e3", "task", "j"), edge("e4", "a2", "j"), edge("e5", "j", "end")));
        WorkflowEngine engine = engine(echo("t2", "right", 2),
            echo("tj", "joined", true));
        WorkflowInstance waiting = engine.startWorkflow(wf, Map.of());

        // a2 has run, but the join is still waiting on the human task branch
        assertEquals(InstanceStatus.WAITING, waiting.status());
        assertFalse(waiting.context().containsKey("joined"));

        WorkflowInstance done = engine.completeNode(wf, waiting, "task",
            new NodeResult(NodeResultStatus.COMPLETED, Map.of("approved", true)));
        assertEquals(InstanceStatus.COMPLETED, done.status());
        assertEquals(true, done.context().get("joined"));
    }

    @Test
    void branchFailureFailsWholeInstance() {
        NodeExecutor failing = new NodeExecutor() {
            public String actionType() { return "t2"; }
            public NodeResult execute(NodeExecutionContext ctx) {
                return new NodeResult(NodeResultStatus.FAILED, Map.of());
            }
        };
        WorkflowEngine engine = engine(echo("t1", "left", 1), failing, echo("tj", "joined", true));
        WorkflowInstance result = engine.startWorkflow(
            diamondForkJoinWorkflow("t1", "t2", "tj"), Map.of());
        assertEquals(InstanceStatus.FAILED, result.status());
    }

    @Test
    void historyIsBranchAttributed() {
        WorkflowEngine engine = engine(echo("t1", "left", 1), echo("t2", "right", 2),
            echo("tj", "joined", true));
        WorkflowInstance result = engine.startWorkflow(
            diamondForkJoinWorkflow("t1", "t2", "tj"), Map.of());
        // both a1 and a2 recorded, on distinct branches
        long branches = result.history().stream()
            .filter(h -> h.nodeId().equals("a1") || h.nodeId().equals("a2"))
            .map(HistoryEntry::branchId)
            .distinct().count();
        assertEquals(2, branches);
    }
}
```

- [ ] **Step 3: Verify they fail**

Run: `mvn -q -pl engine test -Dtest=WorkflowEngineParallelTest`
Expected: FAIL — `completeNode(...)` does not exist yet and the fork currently takes only one edge, so
the join never collects both arrivals (`joined` never set; status not COMPLETED).

- [ ] **Step 4: Rewrite the execution core**

In `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java`, make the following changes. (The
per-node execution helpers `executeActionNode`, `selectEdge`, `validateNodeOutputs`, `resolveNodeInputs`,
`failWorkflow`, `fireEvent`, and the error-handling helpers are reused unchanged.)

**4a. Seed a root branch at start.** In `startWorkflow(...)`, when building the initial instance, add the
root branch alongside `currentNodeId`:
```java
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
```
Keep the existing "enter start node, add to history" block, but give the entry the root branch id:
```java
instance = instance.toBuilder()
    .addHistory(new HistoryEntry(startNode.id(), startNode.name(),
        null, null, now, now, Map.of(), "root"))
    .build();
```

**4b. Replace `advance(...)`** with a token driver:
```java
private WorkflowInstance advance(Workflow workflow, WorkflowInstance instance) {
    ParallelRegions regions = ParallelRegions.analyze(workflow);
    Deque<ActiveBranch> work = new ArrayDeque<>(instance.activeBranches());
    return advanceBranches(workflow, instance, work, regions);
}

/**
 * Drives all runnable branches to quiescence. Each work item is a branch that has entered and (for
 * actions) executed its current node and now needs its outgoing edge(s) resolved. Forks fan out, joins
 * synchronize, END terminates the instance, and any branch failure fails the whole instance.
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
```

**4c. `moveBranch`** — advances one branch across one edge, handling join absorption:
```java
/**
 * Moves a branch across a single edge. If the edge target is a synchronizing join, records the arrival
 * and either fires the join (all branches present) or absorbs the branch (still waiting). Otherwise the
 * branch enters the target node.
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
```

**4d. `enterNode`** — records entry and dispatches by type:
```java
/**
 * Enters a node for a branch: records a branch-attributed history entry, fires {@code onNodeEntered},
 * and dispatches on node type. Actions execute immediately (and, if still RUNNING, the branch is
 * enqueued to continue); blocking nodes leave the branch parked; END terminates the instance.
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
```

**4e. `quiesce`** — derive status after the queue drains:
```java
/**
 * Derives the instance status once no branch is runnable: WAITING if any branch is parked on a blocking
 * node, otherwise a defensive failure (structured validation prevents an empty non-terminal state).
 * Keeps {@code currentNodeId} = the sole active branch's node when there is exactly one.
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

private boolean isBlockingNode(Workflow workflow, String nodeId) {
    NodeType type = workflow.findNodeById(nodeId).map(WorkflowNode::type).orElse(null);
    return type == NodeType.HUMAN_TASK || type == NodeType.RECEIVE_EVENT || type == NodeType.WAIT;
}
```

**4f. Branch-scoped history completion** — add alongside the existing `completeCurrentHistoryEntry`:
```java
/**
 * Completes the most recent open history entry matching the given branch and node (sets completedOn and,
 * when provided, output). Replaces the single-cursor "last entry is the current node" assumption.
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
```

**4g. Reuse existing error-resolution helpers for the sequential path.** Add two thin adapters so the
`selectEdge` error and no-edge cases in `advanceBranches` reuse the existing logic:
```java
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

private WorkflowInstance resolveNoEdge(Workflow workflow, WorkflowInstance instance, WorkflowNode node) {
    ErrorResolution resolution;
    try {
        resolution = errorHandler.handleNoMatchingEdge(instance, node);
    } catch (Exception e) {
        return failWorkflow(instance, "Error handler threw: " + e.getMessage(), e);
    }
    return applyResolution(workflow, instance, node, resolution);
}
```
`applyResolution`'s `TRANSITION` case currently sets `currentNodeId`; also update the sole active branch
so the token driver picks it up. Change its `TRANSITION` branch to:
```java
case TRANSITION -> {
    WorkflowNode target = workflow.findNodeById(resolution.targetNodeId()).orElse(null);
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
```
Note: keep the old `advance()`-era private methods `completeCurrentHistoryEntry(...)` — they are still
used by `executeActionNode` and `completeCurrentNode` (async path). `executeActionNode` completes "the
current node"; since it is only ever called immediately after `enterNode` added that branch's entry as
the last history element, `completeCurrentHistoryEntry` (last-open-entry) still targets the correct entry.

Add imports as needed: `java.util.ArrayDeque`, `java.util.Deque`, `java.util.HashSet`, `java.util.Set`,
`java.util.Objects` (the file already does `import java.util.*;`, so no change is required).

- [ ] **Step 5: Verify the full engine suite passes**

Run: `mvn -q -pl engine test`
Expected: PASS — `WorkflowEngineParallelTest` passes AND every pre-existing engine test still passes
(single-branch workflows run through the same token driver with one root branch). Investigate any
regression before proceeding; the single-branch path must be behavior-identical.

- [ ] **Step 6: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java \
        engine/src/test/java/io/apitomy/flow/TestWorkflows.java \
        engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineParallelTest.java
git commit -m "feat(engine): token-based advance with fork fan-out and AND-join"
```

---

### Task 5: Resume a specific parked branch (`completeNode`)

`completeCurrentNode` assumes a single current node. Add `completeNode(workflow, instance, nodeId,
result)` so a specific parked branch can be resumed while siblings keep waiting; keep
`completeCurrentNode` working for the single-branch case by delegating.

**Files:**
- Modify: `engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java`
- Test: `engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineParallelTest.java` (extend)

**Interfaces:**
- Produces: `public WorkflowInstance completeNode(Workflow workflow, WorkflowInstance instance, String
  nodeId, NodeResult result)`; `completeCurrentNode(...)` delegates to it using the sole blocked branch.
- Consumes: `advanceBranches`, `completeHistoryEntry`, `ParallelRegions`, the active-branch state.

- [ ] **Step 1: Write the failing resume test**

Add to `WorkflowEngineParallelTest`:
```java
@Test
void resumingOneBranchLeavesSiblingWaiting() {
    // two human tasks fork from start, join at j
    Workflow wf = new Workflow("w", "W", null, null,
        List.of(startNode("start"), humanTaskNode("t1"), humanTaskNode("t2"),
            actionNode("j", "tj"), endNode("end")),
        List.of(edge("e1", "start", "t1"), edge("e2", "start", "t2"),
            edge("e3", "t1", "j"), edge("e4", "t2", "j"), edge("e5", "j", "end")));
    WorkflowEngine engine = engine(new NodeExecutor() {
        public String actionType() { return "tj"; }
        public NodeResult execute(NodeExecutionContext ctx) {
            return new NodeResult(NodeResultStatus.COMPLETED, Map.of("joined", true));
        }
    });
    WorkflowInstance waiting = engine.startWorkflow(wf, Map.of());
    assertEquals(InstanceStatus.WAITING, waiting.status());
    assertEquals(2, waiting.activeBranches().size());

    // resume t1 only — t2 still parked, join not fired
    WorkflowInstance afterT1 = engine.completeNode(wf, waiting, "t1",
        new NodeResult(NodeResultStatus.COMPLETED, Map.of("a", 1)));
    assertEquals(InstanceStatus.WAITING, afterT1.status());
    assertFalse(afterT1.context().containsKey("joined"));

    // resume t2 — join fires, workflow completes
    WorkflowInstance done = engine.completeNode(wf, afterT1, "t2",
        new NodeResult(NodeResultStatus.COMPLETED, Map.of("b", 2)));
    assertEquals(InstanceStatus.COMPLETED, done.status());
    assertEquals(true, done.context().get("joined"));
}
```

- [ ] **Step 2: Verify it fails**

Run: `mvn -q -pl engine test -Dtest=WorkflowEngineParallelTest#resumingOneBranchLeavesSiblingWaiting`
Expected: FAIL — `completeNode(...)` does not exist.

- [ ] **Step 3: Implement `completeNode` and delegate `completeCurrentNode`**

Add to `WorkflowEngine`:
```java
/**
 * Completes a specific parked branch (identified by its node id) and resumes execution from it, leaving
 * any sibling branches parked. Use this when more than one branch may be waiting concurrently.
 *
 * @param workflow the workflow definition
 * @param instance the WAITING instance
 * @param nodeId   the id of the parked node/branch to complete
 * @param result   the node result delivering the branch's output
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

    if (result.status() == NodeResultStatus.FAILED) {
        return handleFailedCompletion(workflow, instance, node, result);
    }
    if (result.status() == NodeResultStatus.PENDING) {
        WorkflowInstance reparked = instance;
        if (result.output() != null && !result.output().isEmpty()) {
            reparked = reparked.toBuilder().mergeContext(result.output()).build();
        }
        return reparked.toBuilder().status(InstanceStatus.WAITING).updatedOn(Instant.now()).build();
    }

    // COMPLETED — record output on the branch's history entry, merge context, then continue this branch.
    WorkflowInstance updated = completeHistoryEntry(instance, branch.branchId(), nodeId,
        Instant.now(), result.output());
    updated = updated.toBuilder()
        .mergeContext(result.output())
        .status(InstanceStatus.RUNNING)
        .updatedOn(Instant.now())
        .build();
    WorkflowInstance completedInstance = updated;
    fireEvent(l -> l.onNodeCompleted(completedInstance, node, result));

    Deque<ActiveBranch> work = new ArrayDeque<>();
    work.add(branch); // continue only the resumed branch
    return advanceBranches(workflow, updated, work, ParallelRegions.analyze(workflow));
}
```
Then replace the body of the existing `completeCurrentNode(...)` so it delegates using the sole blocked
branch (preserving its current single-branch semantics and error/PENDING handling for the async path):
```java
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
```
Note: this keeps every existing `completeCurrentNode` call site working (single-branch waits set
`currentNodeId` in `quiesce`). The async `handleFailedCompletion` path is reused unchanged.

- [ ] **Step 4: Verify the full engine suite passes**

Run: `mvn -q -pl engine test`
Expected: PASS — the new resume test passes and all existing completion tests
(`WorkflowEngineCompleteTest`, `AsyncActionNodeTest`, `WaitNodeTest`,
`WorkflowEngineEventCorrelationTest`, `LoanApprovalEndToEndTest`, …) still pass.

- [ ] **Step 5: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/engine/WorkflowEngine.java \
        engine/src/test/java/io/apitomy/flow/engine/WorkflowEngineParallelTest.java
git commit -m "feat(engine): resume a specific parked branch via completeNode"
```

---

## Self-Review Notes

**Spec coverage:**
- Active-branch state model, `HistoryEntry.branchId`, retained `currentNodeId` → Task 1 (spec
  §Execution model / §History).
- Fork inferred from all-unconditional edges; fork→join pairing; structured-balance analysis → Task 2
  (spec §Model / §Execution model / AND-join firing rule).
- Retire `UNCONDITIONAL_MULTIPLE_EDGES`; new structural error codes → Task 3 (spec §Validation).
- Token-based `advance()`, fork fan-out, AND-join wait-for-all, fail-fast, END-terminates, branch-scoped
  history → Task 4 (spec §Execution model / §Completion, failure, cancellation, and waiting).
- Resume-by-node for concurrent waits → Task 5 (spec §WAITING / resume API).
- Context stays flat last-write-wins (`mergeContext` untouched) → Global Constraints (spec §Concurrency
  and context). No task changes context semantics — intentional.
- `CROSSING_PARALLEL_REGIONS` / `PARALLEL_REGION_CYCLE` codes are defined and wired (Task 3) but the
  `ParallelRegions` analyzer only *emits* the well-nesting/end/no-join subset it can prove with the
  BFS-convergence approach; deeper crossing/cycle detection can be tightened later. Flagged so a reviewer
  knows these codes exist but are not yet exhaustively produced. **Follow-up:** consider a dedicated task
  to detect region-crossing edges and intra-region cycles precisely.

**Placeholder scan:** No TBD/TODO. Every step has concrete test or implementation code. The one honest
limitation (crossing/cycle emission) is called out above rather than hidden behind a vague step.

**Type consistency:** `ActiveBranch(branchId, nodeId)`, `HistoryEntry(..., branchId)` (8-arg + 7-arg
compat), `WorkflowInstance.activeBranches()/joinArrivals()`, and the builder methods
`addActiveBranch/removeActiveBranch/recordJoinArrival` are used identically across Tasks 1, 4, and 5.
`ParallelRegions.analyze/isFork/isJoin/joinFor/incomingEdgeIds/problems` are consistent across Tasks 2,
3, 4, 5. `completeHistoryEntry(instance, branchId, nodeId, completedOn, output)` and
`completeNode(workflow, instance, nodeId, result)` signatures match between definition and call sites.

**Testing note:** Per the maintainer's workflow, the plan writes failing tests first but hands Maven
execution to the maintainer; every task lists the exact `mvn -pl engine test` command and expected
result. The single-branch backward-compatibility guarantee is verified by keeping the entire existing
engine suite green at Tasks 1, 4, and 5.
