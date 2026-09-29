# Indexed execution and semantic editor revisions

C13 (#136) builds on the C1–C12 fixes. The public workflow record and wire fields remain unchanged.

## Ownership and boundaries

- `WorkflowGraphIndex` owns node lookup and adjacency. Outgoing edges are sorted once by priority,
  stably preserving declaration order for ties. Incoming edges retain declaration order, matching
  existing join/introspection behavior. Missing lookups return empty results.
- Graph indexes and `ParallelRegions` use weak **identity** keys. They do not hash nested config,
  retain the owning workflow, or use workflow IDs/versions as cache keys. Definition lists and
  topology records are immutable; constructing a replacement definition creates a fresh cache entry,
  even with identical ID/version. Analysis consults topology only, never opaque host config values.
  Access/publication is synchronized. Collected owners are evicted through a reference queue on access.
- `NodeValueResolver` owns typed input interpretation, result/required-output validation, event
  mappings, context-key remapping and human-task output defaults. Both synchronous execution and
  external completion use it. It produces values/structured errors and cannot drive branches,
  change instance status, publish callbacks or invoke recovery. The bounded iterative driver and
  recovery sequencing remain in `WorkflowEngine`.
- `MapInputsEditor` owns the shared action/human-task row draft lifecycle; its existing pure
  `mapInputDraft` protocol owns reconciliation. `HumanTaskOutputFields` owns typed default and
  option controls. `ActionTypeSelect` owns menu filtering, custom values, open/clear state and focus.
  `PropertiesPanel` coordinates selection and dispatches document updates.

## Editor validation invalidation

The reducer stores an owned `semanticDocument` alongside the full document and in undo snapshots.
Selection, measurements and drag frames retain it. Committed positions and tidy operations retain
it explicitly. Imports compare all fields except node coordinates; config, routing, names, metadata
and host extension changes invalidate it. Undo/redo restore the corresponding semantic input.

Built-in validation, parallel-role analysis and debounced host validation depend on that stable
input. A host semantic validator therefore does not run for coordinates alone; positions in its
input are those captured at the last semantic revision. Export, simulation and `onChange` still
receive the current full document. No cache is keyed by mutable caller-owned TypeScript definitions.

## Repeatable measurements

Baseline: `0159ee0`, containing dependency merges `88737f5` and `5c8342b` plus benchmark sources,
before production optimizations. Run the same commands on the baseline and current revision:

```bash
# From engine/
mvn -Dtest=ArchitectureBenchmarkTest -Dflow.benchmark=true test

# From ui/, after npm ci
FLOW_BENCHMARK=1 npx vitest run src/hooks/editorBenchmark.test.ts
```

Java uses a 1,000-node/999-edge sequential graph: 20 full node/incoming/outgoing lookup passes and
parallel analyses per sample. A separate workload resolves a parked wait across a 10,001-entry
interleaved history 1,000 times. Three warmups precede five samples; checksum 60,960 is asserted.

The editor uses 300 nodes/299 edges, 60 position commits and the actual 50-entry undo history cap.
It executes real validation/parallel analysis whenever the editor's semantic memo input changes.
Two warmups precede five samples. Validation results and history size are asserted.

Local observations on September 21, 2026 (milliseconds; five measured samples):

| Workload | Baseline samples | Indexed samples |
| --- | --- | --- |
| Java graph | 348.496, 371.384, 358.059, 370.802, 365.033 | 2.291, 2.324, 2.641, 2.227, 2.010 |
| Java history | 39.976, 38.373, 35.917, 40.168, 34.487 | 38.762, 45.956, 43.848, 40.644, 59.013 |
| Editor layout/history | 178.029, 169.998, 168.274, 169.293, 168.855 | 60.048, 66.026, 60.473, 60.169, 60.250 |

Graph median: 365.033 → 2.291 ms. Editor median: 169.293 → 60.250 ms; validation/analysis runs:
60 → 1. These are warmed diagnostic workloads, not end-to-end throughput guarantees or CI timing
gates. History scanning was not optimized and shows no speedup; its remaining cost is explicit.
The optional benchmarks are skipped in normal suites and run separately with the flags above.

## Regression evidence

`GraphReuseTest` covers same-ID revisions, caller-list mutation isolation, immutable adjacency,
priority ties, incoming order and concurrent analysis publication. Editor semantic tests cover
layout history reuse and semantic invalidation. Browser tests exercise host-validation call counts
with a controlled clock, typed defaults/options with undo, shared drafts/literals/focus, async menus
and the independently packed consumer. Existing execution/conformance/ownership suites protect
the extracted resolver's error phases, pending/completed contracts and recovery ordering.

Clock/identity injection was unnecessary: the public start API already accepts an instance ID,
and the execution invariants do not depend on exact wall-clock timestamps.
