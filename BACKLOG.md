# Apitomy Flow — Project Audit Backlog

Full audit of both the engine (Java) and UI (React/TypeScript) components, covering correctness,
state management, type safety, cross-component consistency, and test coverage.

---

## BUGS

### Critical

| # | Status | Component | Location | Description |
|---|--------|-----------|----------|-------------|
| 1 | Fixed (PR #25) | Engine | `WorkflowEngine.java:295-315` | **Error handler TRANSITION to ACTION node skips execution.** When the error handler returns `transitionTo(actionNodeId)`, the switch block only handles END, HUMAN_TASK, RECEIVE_EVENT, and WAIT. An ACTION node falls through to `selectEdge` — the action is never executed, no event fires, and no history entry is recorded. |
| 2 | Fixed (PR #25) | Engine | `WorkflowEngine.java:394-463` | **Infinite retry loop.** `executeActionNode` has `while (true)` with `continue` on `ErrorAction.RETRY`. If the handler always returns RETRY, this loops forever. The `MAX_TRANSITIONS` guard doesn't protect this because it runs within a single advance iteration. |

### High

| # | Status | Component | Location | Description |
|---|--------|-----------|----------|-------------|
| 3 | Fixed (PR #26) | Engine | `WorkflowEngine.java:246` | **Unsafe cast causes ClassCastException.** `(String) currentNode.config().get("eventType")` throws if the value isn't a String. Inconsistent with the safe `instanceof` pattern used at line 171. |
| 4 | Fixed (PR #25) | Engine | `WorkflowEngine.java:296-314` | **Error handler TRANSITION to END/WAIT nodes creates no history entry and fires no events.** The END node becomes invisible in workflow history. |
| 5 | Fixed (PR #26) | Engine | `WorkflowValidator.java:126` | **NPE in validator when edge has null target.** `e.target().equals(start.id())` throws NPE if any edge has null target. The validator — which exists to catch bad input — crashes on it instead. |
| 6 | Fixed (PR #26) | Engine | `WorkflowEngine.java` (multiple) | **NPE when `node.config()` is null.** Every `node.config().get(...)` call (lines 129, 132, 171, 194, 214, 246, 386, 548, 584) throws NPE if config is null. Neither the record nor the validator guards against this. |
| 7 | Fixed (PR #27) | UI | `WorkflowEditor.tsx:112-132` | **Stale closure causes corrupt `onChange` emission during keyboard delete.** `handleNodesChange` closes over stale `edges` and vice versa. When ReactFlow fires both handlers in one event, the parent receives two `onChange` calls — the last one re-adds the deleted node while removing its edges. State self-corrects on next interaction, but auto-save or derived computation operates on corrupt data. Same stale-closure pattern in `onConnect` (line 146), `onDrop` (line 171), `onNodeDataChange` (line 239), and `onEdgeDataChange` (line 266). |
| 8 | Fixed (PR #27) | Cross-cutting | Java `ValidationSeverity` vs TS `validation.ts` | **Validation severity casing mismatch.** Java serializes as `"ERROR"/"WARNING"` (uppercase, no `@JsonProperty`). TypeScript expects `'error' \| 'warning'` (lowercase). Latent bug if validation results are ever returned from the engine API to the UI. |
| 9 | Fixed (PR #27) | Cross-cutting | Java `WorkflowInstance` vs TS `instance.ts` | **Timestamp serialization mismatch.** Java uses `Instant` which Jackson+JavaTimeModule serializes as numeric epoch-seconds by default. TypeScript declares these as `string`. Consumers using default ObjectMapper config get numbers in string-typed fields. |

### Medium

| # | Status | Component | Location | Description |
|---|--------|-----------|----------|-------------|
| 10 | Fixed (PR #26) | Engine | `Workflow.java:29-30` | **NPE in `getOutgoingEdges`** when any edge has null source. Same at line 36 for null target. Should use `nodeId.equals(e.source())` or add null guards. |
| 11 | Open | Engine | `WorkflowEngine.java:583-598` | **NPE when `initialContext` is null.** `validateInputs` calls `initialContext.containsKey()` before any null check. |
| 12 | Open | Engine | `WorkflowEngine.java:285` | **No null check on `findNodeById` result in advance loop.** If the error handler set `currentNodeId` to a non-existent node, the next access throws NPE with no meaningful message. |
| 13 | Open | Engine | `WorkflowValidator.java:93-101` | **Null edge source/target silently accepted.** Edges with null source or target are not flagged, but cause NPEs at runtime. |
| 14 | Open | Engine | `JsonNodeELResolver.java:19-25` | **Array access via dot notation silently returns null.** `arr.0` evaluates to null while `arr[0]` works. Should parse string as integer for array nodes. |
| 15 | Open | UI | `PropertiesPanel.tsx:227,622` | **Adding input with empty key overwrites previous empty-key entry.** Clicking "+ Add input" twice before naming the first entry silently drops one — data loss with no feedback. |
| 16 | Open | UI | `PropertiesPanel.tsx:190,586` | **Renaming input key to existing key silently drops collision.** `Object.fromEntries` keeps last entry for duplicate keys. |
| 17 | Open | UI | `WorkflowEditor.tsx:236-268` | **Property edits not captured in undo history.** Editing node name, action type, edge condition, or any config field is irreversible via Ctrl+Z. Only structural operations are undoable. |
| 18 | Open | Cross-cutting | TS `validateWorkflow.ts:279-280` | **Duplicate event receiver comparison is order-sensitive.** Uses `JSON.stringify` which is key-order-dependent, while Java uses `Objects.equals` (order-insensitive). Same match configs in different key order are caught by Java but missed by TypeScript. |
| 19 | Fixed (PR #29) | Cross-cutting | TS `validateWorkflow.ts` | **Missing `INVALID_CONDITION` validation rule.** Java validates EL expression syntax; TypeScript has no equivalent. Invalid conditions pass UI validation but fail at engine runtime. |

### Low

| # | Status | Component | Location | Description |
|---|--------|-----------|----------|-------------|
| 20 | Open | Engine | `WorkflowEngine.java:547-558` | **Non-string input values mangled through `String.valueOf`.** A Map value produces an EL syntax error. |
| 21 | Open | Engine | `WorkflowEngine.java:466-488` | **Condition evaluation failure loses error context.** Error handler receives no info about which expression failed. |
| 22 | Open | Engine | `WorkflowValidator.java:458-476` | **Cycle detection only reports first automated cycle.** Multiple independent cycles are silently ignored. |
| 23 | Open | UI | `WorkflowEditor.tsx:40,46` | **`validationProblems` prop silently ignored.** Always recomputes internally; consumers get no feedback that their prop is discarded. |
| 24 | Open | UI | `validateWorkflow.ts:253-261` | **`DUPLICATE_EDGE_PRIORITY` false positive with default edges.** Default edges (priority 0) trigger false warnings against conditional edges with priority 0. |
| 25 | Open | UI | `validateWorkflow.ts:289` | **`MISSING_TASK_DESCRIPTION` doesn't trim whitespace.** Whitespace-only description accepted as valid, inconsistent with all other string checks. |
| 26 | Open | UI | `WorkflowViewer.tsx:64-67` | **`selectedNodeHistory` returns only first visit.** In looping workflows, always shows first visit's timestamps/outputs, never most recent. |
| 27 | Open | UI | `dev/App.tsx:113` | **Viewer tab hardcodes `cveTriage` instead of live `workflow` state.** Editor changes aren't reflected in Viewer. |

---

## IMPROVEMENT RECOMMENDATIONS

### High Priority

| # | Status | Component | Description |
|---|--------|-----------|-------------|
| 1 | Fixed (PR #26) | Engine | **Default `config` to empty map in `WorkflowNode` compact constructor.** Eliminates an entire class of NPE bugs across engine and validator. |
| 2 | Open | Engine | **Default `nodes`/`edges` to empty lists in `Workflow` compact constructor.** Same pattern — prevents NPEs in all query methods. |
| 3 | Fixed (PR #25) | Engine | **Add `MAX_RETRIES` constant to `executeActionNode`.** Prevents infinite loops from buggy error handlers. |
| 4 | Fixed (PR #25) | Engine | **Handle all node types in the error-handler transition block.** The `!hasEnteredCurrentNode` block should handle ACTION and START explicitly. |
| 5 | Fixed (PR #27) | Engine | **Add `@JsonProperty` annotations to `ValidationSeverity`, `NodeResultStatus`, `ErrorAction`.** Forces lowercase serialization to match TypeScript types. |
| 6 | Fixed (PR #27) | Engine | **Document/enforce Jackson ObjectMapper timestamp config.** Either provide a factory method or add `@JsonFormat(shape = STRING)` on `Instant` fields. |
| 7 | Fixed (PR #27) | UI | **Fix stale-closure pattern in `WorkflowEditor`.** Replace `setTimeout(() => emitChange(...))` with a ref-based deferred pattern that reads latest state from an effect. |
| 8 | Open | UI | **Use array of `{key, value}` pairs for map-based inputs in PropertiesPanel.** Eliminates empty-key collision and rename-overwrite bugs. |

### Medium Priority

| # | Status | Component | Description |
|---|--------|-----------|-------------|
| 9 | Open | Engine | **Return `Optional` from `findNodeById` and `findStartNode`.** Makes absence explicit and leverages compiler. |
| 10 | Open | Engine | **Validate `targetNodeId` in `ErrorResolution.transitionTo()`.** Fail fast with `Objects.requireNonNull` instead of silent null propagation. |
| 11 | Open | Engine | **`NodeExecutorProvider.fromList` should detect duplicate action types.** Currently silently overwrites. |
| 12 | Open | UI | **Add undo/redo support for property edits.** Use debounced snapshots (e.g., on 500ms inactivity or on field blur). |
| 13 | Open | UI | **Replace `any` with `React.MouseEvent` in callbacks.** Three callbacks use `(_: any, ...)` — straightforward type fix. |
| 14 | Open | UI | **Use stable keys for list items.** Using `key={i}` causes focus/state bugs when items are removed from the middle. |
| 15 | Open | UI | **Fix duplicate event receiver comparison** to use order-insensitive deep equality. |
| 16 | Fixed (PR #29) | UI | **Add basic condition syntax validation** to bring parity with Java's `INVALID_CONDITION` rule. |
| 17 | Open | Tests | **Add tests for `conversion.ts`, `useUndoRedo.ts`, and UI components.** These core files have zero test coverage. |
| 18 | Open | Tests | **Fix over-broad `assertThrows(Exception.class)` in engine tests.** Should assert specific exception types. |

### Low Priority

| # | Status | Component | Description |
|---|--------|-----------|-------------|
| 19 | Fixed (PR #28) | Engine | **Deduplicate identical `OutputDefinition` records** in `ActionInfo` and `HumanTaskInfo`. |
| 20 | Open | Engine | **Document null-parameter contracts** in `WorkflowErrorHandler` and `WorkflowEventListener` Javadoc. |
| 21 | Open | Engine | **Consider builder pattern for `WorkflowEngine` construction.** |
| 22 | Open | UI | **Exclude default edges from priority duplication check.** |
| 23 | Open | UI | **`onProblemClick` should `fitView` for edge problems**, not just node problems. |
| 24 | Open | UI | **Guard context menu against viewport-edge overflow.** |
| 25 | Open | UI | **Clone `config` object in `conversion.ts`** instead of sharing by reference. |
| 26 | Open | UI | **Define discriminated config types per node type** to replace `Record<string, any>`. |
| 27 | Open | Cross-cutting | **Add `WorkflowInput` record to Java model** to match TypeScript's typed definition. |
