# Typed configuration and wire contract v1

The structural JSON contract is `conformance/workflow-v1.schema.json` (JSON Schema draft 7). Its `$id`
ends in `workflow-v1.schema.json`; this contract version is independent of `Workflow.version`, which
remains a host-managed workflow revision. Compatible additions retain v1; incompatible wire changes
require a new schema version and migration guidance. Existing definitions need no new version field.

`conformance/config-v1.json` exercises all six node kinds, literal JSON, omitted/defaulted fields, nulls,
and host extensions. Maven and Vitest consume this same file; Vitest also executes the schema with Ajv.
`config-invalid-v1.json` checks the same structural failures in both validators and the schema.
Semantic validation (graph topology, expressions, durations, and missing required configuration) remains
the responsibility of the existing validators. Passing the schema alone does not imply executability.

## TypeScript authoring

The package root exports `WorkflowNode`, `NodeConfigMap`, `NodeConfig`, `StartConfig`, `EndConfig`,
`ActionConfig`, `HumanTaskConfig`, `ReceiveEventConfig`, `WaitConfig`, `WorkflowInput`,
`ActionOutputConfig`, `HumanTaskOutput`, `OutputOption`, `OutputWidget`, `EventOutputMapping`,
`JsonValue`, `JsonObject`, and `ConfigExtensions`.

`WorkflowNode` is a discriminated union. Narrow `node.type` before interpreting built-in configuration:

```typescript
import type { WorkflowNode } from '@apitomy/flow-ui';

const node: WorkflowNode = {
    id: 'send', type: 'action', name: 'Send',
    config: {
        actionType: 'send-email',
        inputs: { recipients: ['owner@example.org'], enabled: true, extra: null },
        outputs: [{ name: 'messageId', contextKey: 'sentMessageId' }],
        'x-acme': { tracing: { enabled: true } },
    },
};

if (node.type === 'action') {
    const outputs = node.config.outputs ?? [];
    console.log(outputs.map(output => output.contextKey || output.name));
}
```

JSON inputs may contain nested objects, arrays, strings, numbers, booleans, and null. String inputs
retain their existing expression semantics; other JSON values are literals. Undefined object properties
represent omitted fields in authored TypeScript; functions, symbols, and opaque class instances are not
JSON. Finite numbers are required by JSON even though TypeScript's `number` also represents nonfinite values.

Built-in optional config fields accept explicit null. Missing/null declaration `type` defaults to
`string`, and missing/null `required` defaults to false. Empty/missing/null event output lists preserve
legacy flat event merging. Field presentation defaults remain in the runtime info/display consumers;
reading configuration never writes defaults into the original config.

`position` is optional and nullable, matching Java and the import validators. Layout produces guaranteed
positions; canvas conversion uses origin for a missing position. Browser import still performs its
existing normalization/layout of absent positions, names, configs, and edge defaults. It does not promise
byte-identical JSON, preservation of omitted-versus-null outer record fields, or stable property order.

### Source compatibility and migration

This strengthens the TypeScript source contract while retaining supported JSON:

- Replace `Record<string, any>` configs with the appropriate config type or a narrowed `WorkflowNode`.
- Use `satisfies WorkflowNode` for literals and narrow by `type` before editing a config. Spreading a
  union and replacing its config independently can lose the correlation; narrow before spreading.
- Use `parseWorkflow` for untrusted JSON rather than asserting it is a valid workflow.
- Handle absent/null positions, output metadata, and optional declaration types explicitly (`??`).
- `WorkflowNode` is now a type alias; host-specific nodes should use intersections or discriminated
  aliases instead of interfaces extending the whole union. Built-in node kinds remain unchanged.
- Instance context/history payloads use `unknown` instead of `any`, since hosts may supply runtime
  values; narrow them before use. Persisted config/default values use the recursive JSON contract.

The schema intentionally accepts arbitrary strings for advisory type/widget metadata, as the existing
validators did. The authoring types suggest supported semantic types/widgets; legacy host-specific
metadata remains accepted by import and retained on export. No new rejection is introduced for that data.

## Host extensions

Unknown keys inside config, field declarations, options, and event mappings are host-owned JSON and
round-trip in both runtimes. Prefer namespaced keys (`x-acme`, for example) to avoid future built-in name
collisions. Existing unprefixed extension keys remain supported. Preserve extensions by spreading the
original config/declaration when changing a built-in field. Built-in keys keep their per-kind meaning;
an extension cannot change the required shape of a built-in key on that node kind.

Browser imports also retain unknown workflow/node/edge fields. Java records have never accepted arbitrary
unknown fields at those outer levels; this change preserves that existing boundary. Put portable host
metadata in config rather than assuming arbitrary outer fields will deserialize in Java.

## Java adapters

`WorkflowNode` retains its public record components, constructor, `Map<String, Object> config()`, and
Jackson representation. `node.typedConfig()` (or `NodeConfig.from(node)`) returns a sealed per-kind view:

```java
if (node.typedConfig() instanceof NodeConfig.Action action) {
    String executorType = action.actionType();
    Map<String, Object> inputs = action.inputs();
    List<NodeConfig.Field> outputs = action.outputs();
}
```

The nested `Start`, `End`, `Action`, `HumanTask`, `ReceiveEvent`, and `Wait` records expose typed
accessors. `Field` exposes declaration and presentation metadata plus `effectiveContextKey()`;
`Option` exposes select options; `Mapping` exposes event `contextKey()` and `expression()`.
`wire()` on every adapter returns the immutable original map. Jackson serializes adapters directly as
that map, without wrapper fields, and concrete adapter records can be deserialized from the same shape.
No Jackson module or custom mapper registration is required. Deserialize workflows through the existing
records and dispatch with `typedConfig()` rather than deserializing the sealed interface without a kind.

Absent/null collections return empty typed collections; absent/null scalar values remain null except
the documented declaration defaults. `wire()` retains explicit nulls and omission inside config exactly.
Accessors reject incorrect structural types with `IllegalArgumentException`, rather than silently
coercing them. Run `WorkflowValidator` before interpreting untrusted definitions; its structural preflight
returns diagnostics before any typed semantic access. Engine start already performs this validation.
Info calls on directly constructed malformed definitions may now fail at the offending typed accessor.

Ownership follows `JsonSnapshots`: nested maps/lists are read-only, Jackson trees are detached, and
non-JSON opaque Java extension values remain host-owned immutable references. The portable schema
covers JSON only. Existing executor config maps and SPI signatures remain available.

## Verification

Run `mvn test` in `engine/`; run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build` in
`ui/`. Compile-only consumer assertions check discrimination, recursive extensions, nullable/defaulted
fields, optional positions, and package-root exports. ESLint's `no-explicit-any` rule is enabled globally;
the implementation currently needs no exceptions. Deliberately malformed test fixtures use documented
boundary assertions rather than weakening production model types.
