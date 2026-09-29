# Current branch contracts and compatibility

These guides describe the combined C1–C14 source branch audited at integration revision `7da7f64`,
including final C13 corrections through `24644df`.
They are not a claim that the changes have merged or shipped. The issues from
[C1 #124](https://github.com/Apitomy/apitomy-flow/issues/124) through
[C14 #137](https://github.com/Apitomy/apitomy-flow/issues/137) and
[releases](https://github.com/Apitomy/apitomy-flow/releases) are the delivery authorities. Historical
audits and design plans describe their own revisions and are not current API specifications.

## Three independent versions

1. **Artifact version:** select a compatible engine/UI release, or build this branch locally. A snapshot
   version in `pom.xml` or `package.json` does not prove a change is published.
2. **Wire schema version:** [typed configuration v1](typed-configuration.md) defines structural JSON
   compatibility. Compatible additions retain v1; incompatible changes need a new schema and migration.
3. **Workflow revision:** `Workflow.version` is host-managed metadata. Instances store `workflowId`, not
   a pinned definition version. Hosts must retain and resume against the original compatible definition.
   Automatic pinning/resume compatibility is proposed in [#116](https://github.com/Apitomy/apitomy-flow/issues/116).

The Java model preserves record shapes while adding typed config adapters; TypeScript now narrows configs
by node kind and uses `unknown` for runtime payloads. Follow the
[source migration steps](typed-configuration.md#source-compatibility-and-migration). Optional/null positions
are supported. Round trips preserve supported data, not whitespace, property order, or omitted/null outer
fields. Configuration extensions belong in namespaced JSON keys.

## Responsibilities at integration boundaries

| Boundary | Current branch behavior | Host responsibility / proposed follow-up |
|---|---|---|
| Persistence | Engine returns JSON snapshots; callbacks are synchronous observations | Persist atomically and dispatch durable work through host transactions/outboxes |
| Completion | `completeNode` addresses an active parked node by ID | Serialize deliveries and deduplicate; activation identity is proposed in [#115](https://github.com/Apitomy/apitomy-flow/issues/115) |
| Parallel context | Outputs merge into shared context; later writes can overwrite keys | Choose distinct aliases; collision policy is proposed in [#120](https://github.com/Apitomy/apitomy-flow/issues/120) |
| Timers/retries | Waits park; call-local retry/transition guards bound recovery | Schedule wake-ups/backoff; see [#85](https://github.com/Apitomy/apitomy-flow/issues/85) and [#86](https://github.com/Apitomy/apitomy-flow/issues/86) |
| Validation | Definition shape/semantics and required action output presence are checked | Validate human submissions and domain values; reusable runtime validation is proposed in [#117](https://github.com/Apitomy/apitomy-flow/issues/117) |
| Editor synchronization | Mount-initialized graph, live metadata, transactional local history | Remount with a key for replacement; further synchronization is proposed in [#121](https://github.com/Apitomy/apitomy-flow/issues/121) |
| Simulation | Shared fixtures verify a browser EL/routing subset | Verify real executors, timers, correlation, and full EL with Java |

## Migration checks

- Replace mutation of Java context/config/history collections with construction of new values. Nested JSON
  is owned by snapshots; opaque Java objects are still host-owned immutable references.
- Enumerate `activeBranches` and use node-addressed completion/info methods when parallel work is possible.
  `currentNodeId` alone cannot identify multiple parked branches.
- Remove duplicate executor registrations and malformed extension results; inspect structured
  [engine errors](../developer-guide/engine-errors.md) instead of parsing `failureReason` strings.
- Treat browser `UNSUPPORTED_EXPRESSION_DIALECT` as “not validated here,” not “valid full Jakarta EL.”
- Keep host definition and instance revisions consistent when rendering and resuming. The viewer does not
  repair an instance against an edited definition.
- Run [executable examples and browser checks](../developer-guide/documentation-checks.md) against the
  artifacts/source you intend to deploy.
