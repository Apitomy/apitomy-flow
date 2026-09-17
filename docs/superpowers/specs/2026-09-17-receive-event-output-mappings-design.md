# Receive-Event Output Mappings Design

## Overview

Today, a `receive-event` node has no notion of "outputs": once an incoming event is matched to a
parked receive-event branch, the engine merges the entire raw event payload flat into the
workflow instance context (each top-level event field becomes a top-level context key). There is
no way to rename, extract nested fields, or compute derived values from the event before it lands
in context — and no way to avoid two different receive-event nodes (or a receive-event node and
some other node) writing to the same context key.

This mirrors the collision/shadowing problem already solved for action and human-task node
outputs via the `contextKey` feature (see `2026-09-17`'s prior PR), but the receive-event case is
structurally different: action/human-task nodes produce a fixed set of *named* outputs that just
need an optional rename; a receive-event node receives an arbitrary, host-defined event payload
and what's useful is *extracting/computing* specific values from it via expressions.

This design adds optional **output mappings** to `receive-event` nodes: a list of
`{ contextKey, expression }` pairs, each expression evaluated against the incoming event (and the
current instance context) to produce the value stored under `contextKey`. When no mappings are
declared, today's flat-merge behavior is unchanged (fully backward compatible).

## Goals

- Let a receive-event node declare zero or more named extractions from the incoming event,
  each computed via an EL expression with access to both `event` and `context`.
- When mappings are declared, only the mapped `contextKey`s land in context — no more implicit
  flat-merge pollution for that node.
- Keep full backward compatibility: no mappings declared → identical behavior to today.
- Implement consistently on both sides of the repo (engine + UI) so the UI simulator's behavior
  matches the real engine's runtime behavior, matching the project's existing dual-implementation
  pattern for this kind of feature.
- Surface the mappings in the Editor (PropertiesPanel) and Viewer (node definition view).

## Non-Goals

- No change to event *matching* (`eventType` / `match` expression) semantics — this design only
  affects what happens to context *after* a match succeeds and the branch completes.
- No validation-syntax fix for the pre-existing gap where `match` expressions aren't checked for
  EL validity (flagged during design discussion, but out of scope here — a reasonable follow-up).
- No renaming/relabeling of the pre-existing `config.match` diff-viewer field label
  (cosmetic, pre-existing, out of scope).
- No change to `WorkflowDiffViewer` — confirmed during design discussion that it requires none
  (see Diff Viewer section below).

## Config Shape

`receive-event` nodes gain an optional `config.outputs` field — same JSON key name used by
action/human-task nodes, but a different item shape, since there's nothing being "produced" with
a fixed name/type/required contract here:

```jsonc
{
  "type": "receive-event",
  "config": {
    "eventType": "order.created",
    "match": ["event.storeId == context.storeId"],
    "outputs": [
      { "contextKey": "orderId", "expression": "event.payload.id" },
      { "contextKey": "customerEmail", "expression": "event.payload.customer.email" },
      { "contextKey": "receivedAt", "expression": "event.timestamp" }
    ]
  }
}
```

- `contextKey` (string, required): the context key the computed value is stored under.
- `expression` (string, required): an EL expression evaluated with `event` and `context` root
  beans available (same beans already used for `match` expressions).
- No `name`, `type`, or `required` fields — unlike `OutputDefinition`, there's no "declared output
  name" separate from where it's stored (there's nothing to alias *from*), and requiredness isn't
  meaningful here (an expression either evaluates or the branch fails, no partial/optional
  produced-output concept).

When `outputs` is absent or an empty array, behavior is identical to today: the entire event
payload is flat-merged into context. When `outputs` is a non-empty array, **only** the mapped
`contextKey`s are merged into context — the raw event fields are not also flat-merged.

## Expression Evaluation

Each mapping's `expression` is evaluated with two root beans:

- `event` — the raw incoming event payload (the same object passed to `match` expression
  evaluation today).
- `context` — the instance's context *before* this node's merge (so expressions can combine
  incoming event data with existing context, e.g. `event.amount + context.runningTotal`).

This exactly matches the beans already available to `match` expressions, so authors can reuse
familiar expression patterns (nested field access via the existing `JsonNodeELResolver`, string
concatenation, arithmetic, etc.).

### Engine

`ConditionEvaluator` gains one new method, mirroring the existing boolean `evaluate` overload but
returning the raw value:

```java
public Object resolve(String expression, Map<String, Object> context, Map<String, Object> event) {
    if (expression == null || expression.isBlank()) {
        return null;
    }
    try {
        ELProcessor processor = createProcessor();
        processor.defineBean("context", context);
        processor.defineBean("event", event);
        return processor.eval(expression);
    } catch (Exception e) {
        throw new ConditionEvaluationException(expression, e);
    }
}
```

(A single-bean `resolve(expression, context)` already exists and is used for action-node
`inputs`; this is the same idea extended with an `event` bean, matching the existing
two-bean `evaluate` overload used by `matchesEvent`.)

### UI

No new evaluator code needed. `elEvaluator.ts`'s `resolveExpression(expression, scope)` already
accepts an `ElScope` with both `context` and `event` — it's called directly with
`{ context: state.context, event: rawEvent }`.

## Engine Wiring

### New model: `EventOutputMapping`

A small new record, `engine/src/main/java/io/apitomy/flow/model/EventOutputMapping.java`:

```java
public record EventOutputMapping(String contextKey, String expression) {}
```

### `ReceiveEventInfo`

Gains a new field so hosts/UI can introspect what a receive-event node will produce, mirroring
`ActionInfo.expectedOutputs` / `HumanTaskInfo.outputs`:

```java
public record ReceiveEventInfo(
    String nodeId,
    String nodeName,
    String eventType,
    List<String> matchExpressions,
    List<EventOutputMapping> outputMappings
) {}
```

`WorkflowEngine.getReceiveEventInfo` parses `config.outputs` the same way it already parses
`match`, mapping each raw entry's `contextKey`/`expression` into an `EventOutputMapping`.

### Merge-time dispatch

Today, both merge sites in `completeNode` (PENDING re-park and COMPLETED) call
`resolveContextKeys(node, result.output())` before `mergeContext(...)`. This is replaced with a
dispatcher, `resolveMergeOutput(WorkflowInstance instance, WorkflowNode node, Map<String, Object>
rawOutput)`:

```java
private Map<String, Object> resolveMergeOutput(WorkflowInstance instance, WorkflowNode node,
                                                Map<String, Object> rawOutput) {
    if (node.type() == NodeType.RECEIVE_EVENT
        && node.config().get("outputs") instanceof List<?> outputDefs && !outputDefs.isEmpty()) {
        return applyEventOutputMappings(outputDefs, instance.context(), rawOutput);
    }
    return resolveContextKeys(node, rawOutput);
}

private Map<String, Object> applyEventOutputMappings(List<?> outputDefs, Map<String, Object> context,
                                                       Map<String, Object> event) {
    Map<String, Object> mapped = new HashMap<>();
    for (Object defObj : outputDefs) {
        if (defObj instanceof Map<?, ?> def) {
            Object contextKeyVal = def.get("contextKey");
            Object expressionVal = def.get("expression");
            if (contextKeyVal != null && expressionVal != null) {
                mapped.put(String.valueOf(contextKeyVal),
                    conditionEvaluator.resolve(String.valueOf(expressionVal), context, event));
            }
        }
    }
    return mapped;
}
```

`resolveContextKeys` (the existing action/human-task `contextKey`-rename logic) is unchanged and
still used for every other case — action nodes, human-task nodes, and receive-event nodes with no
`outputs` declared (which fall through to the flat-merge-preserving branch, since
`resolveContextKeys` is a no-op when a node has no `config.outputs` at all).

Both `completeNode` merge sites (PENDING and COMPLETED, `WorkflowEngine.java` around lines
110–127) switch from `resolveContextKeys(node, result.output())` to
`resolveMergeOutput(instance, node, result.output())`. History entries continue to record the
*resolved* (mapped or renamed) output, consistent with the existing `contextKey` behavior — so a
receive-event node's history entry shows the mapped `contextKey`s, not the raw event, when
mappings are declared.

Note: `executeActionNode`'s two merge sites are unaffected — they only ever handle `ACTION` nodes,
never `RECEIVE_EVENT`, so no dispatch is needed there.

### Validation

`WorkflowValidator` (and the UI's `validateWorkflow.ts` mirror) gain, for `receive-event` nodes
with a non-empty `config.outputs`:

- `MISSING_OUTPUT_EXPRESSION` (warning): a mapping entry has a blank/missing `expression`.
- `INVALID_OUTPUT_EXPRESSION` (error): a mapping's `expression` fails EL syntax validation (reusing
  the existing `conditionEvaluator.isValid(...)` / `isValidExpression(...)` helpers, the same
  pattern already used for edge conditions).
- `DUPLICATE_OUTPUT_NAME` (warning): two mappings on the same node declare the same `contextKey`
  (reusing the existing code, generalized to operate on `contextKey` directly since there's no
  separate `name` field for receive-event mappings).
- `MISSING_OUTPUT_CONTEXT_KEY` (warning): a mapping entry has a blank/missing `contextKey`.

## UI Changes

### Types (`ui/src/types/workflow.ts`)

New type:

```ts
export interface EventOutputMapping {
  contextKey: string;
  expression: string;
}
```

### `simulate.ts`

`resumeSimulation`'s existing `resolveContextKeys(node, mock.output)` call is replaced with the
same dispatch pattern as the engine: for `receive-event` nodes with non-empty `config.outputs`,
evaluate each mapping via `resolveExpression(mapping.expression, { context: state.context, event:
mock.output })` and build the replacement map; otherwise fall through to the existing
`resolveContextKeys` behavior (unchanged for action/human-task and for receive-event nodes with no
`outputs`).

The mock JSON an author types into the `SimulationPanel` for a receive-event block continues to
represent the raw incoming event, unchanged — only how it's merged into context changes once
`outputs` mappings are declared.

### `validateWorkflow.ts`

Mirrors the engine validator's four new checks above.

### `PropertiesPanel.tsx`

The `receive-event` config branch (currently: `Event Type` input + repeatable `Match Expressions`
list, no outputs UI at all) gains a new "Output mappings" section: a repeatable list of
`contextKey` / `expression` text input pairs with add/remove buttons, following the existing
list-editor visual pattern used elsewhere in this file (e.g. the match-expressions list
immediately above it). Placeholder text on the expression input follows the existing convention
(e.g. `event.payload.id`).

### `nodeDefinition.ts` (Viewer)

Gains a receive-event "Output mappings" section (new `receiveEventOutputsSection()` builder,
following the same shape as `humanTaskOutputsSection`/`actionSections`'s outputs handling): one
field per mapping, `label: contextKey`, `value: expression`. `HANDLED_CONFIG_KEYS['receive-event']`
gains `'outputs'` so it doesn't also leak into the generic config fallback.

## Diff Viewer

**No changes needed**, confirmed during design discussion:

- `NODE_CONFIG_FIELDS['receive-event']` already lists `'outputs'` as a known field (pre-existing,
  presumably added speculatively/for symmetry) — so the new `outputs` array will be diffed and
  labeled exactly like it already is for action/human-task nodes, with zero code changes.
- Diffing is generic (whole-array JSON equality via `areEqual`, rendered as raw JSON before/after)
  — since the new item shape (`{contextKey, expression}`) is just JSON like every other config
  value, it works automatically, the same way the `contextKey` field did for the prior feature.

## Testing

Engine (`mvn test`):
- `ConditionEvaluator`: new tests for the `resolve(expression, context, event)` overload (nested
  field access, blank expression → null, combining `context`/`event`).
- `WorkflowEngine`: new tests (likely a new `WorkflowEngineReceiveEventOutputMappingsTest`) —
  mappings applied on COMPLETED completion, no-mappings-declared preserves flat-merge, mapped
  `contextKey`s don't leak raw event fields, `getReceiveEventInfo` parses `outputMappings`.
- `WorkflowValidator`: new cases for all four new problem codes.

UI (`vitest`):
- `simulate.test.ts`: mirrors the engine cases above via `resumeSimulation`.
- `validateWorkflow.test.ts`: mirrors the four new validator cases.
- `nodeDefinition.test.ts`: new receive-event "Output mappings" section cases.

As with the prior `contextKey` feature, `PropertiesPanel.tsx` changes are not unit tested (no
jsdom/testing-library in this project; verified via `tsc`/`lint`/manual review).
</content>
