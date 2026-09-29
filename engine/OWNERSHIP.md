# JSON data ownership

`Workflow`, `WorkflowNode`, `WorkflowInstance`, and `HistoryEntry` take ownership snapshots in their
canonical constructors. Builders and Jackson deserialization use the same constructors. `NodeExecutionContext`
and `NodeResult` apply the same policy at executor, completion, error-handler, and event-listener boundaries.
Listeners can retain these snapshots without later engine transitions changing their JSON data.

## Supported values

- Acyclic nested maps and lists are recursively copied into read-only collections. Map order, list order,
  null values, null elements, and scalar types are retained. JSON object keys should be strings; other keys
  remain opaque references for compatibility.
- Standard Jackson object and array trees are copied on ingress and on read. This includes trees inside
  maps, lists, or other trees, and reads through entries, values, iterators, streams, and collection views.
  A caller can mutate the returned tree, but that mutation cannot affect the stored tree or another read.
  Binary nodes also own their byte arrays. Immutable Jackson scalar nodes can be shared.
- `POJONode` payloads containing maps, lists, or standard Jackson trees follow the same recursive policy.
  Other POJO payloads follow the opaque-object policy below. Custom `JsonNode` implementations must honor
  Jackson's `deepCopy()` contract; the library cannot infer their internal ownership.
- Strings, numbers, booleans, and nulls retain their representation. Unknown objects are **opaque,
  host-owned references**, not serialized, converted, rejected, or reflectively cloned. This includes arbitrary
  POJOs, Java arrays outside binary nodes, sets, custom mutable scalar types, and opaque `POJONode` payloads.
  Hosts must keep these objects (and non-string map keys) immutable while a snapshot is in use, or convert
  them to supported maps/lists/Jackson trees first. The deep ownership guarantee is for JSON data, not
  arbitrary Java object graphs. Cyclic graphs are not JSON and are not supported by the snapshot traversal.

## Compatibility

Public record components and JSON field shapes are unchanged. Configuration extension fields are retained.
Null history/result output remains null; legacy null workflow node/edge collections, node configuration,
active branches, and join arrivals still normalize to empty collections. Directly supplied context and
history nulls remain null. No ObjectMapper conversion is used, so trees remain trees and numeric types are
not coerced. Untyped Jackson round trips still deserialize JSON objects to maps as before.

Code that mutated configuration, output, or nested state collections must instead create replacement data
and construct a new record (or use `toBuilder()`). Such mutations now throw `UnsupportedOperationException`.
Tree accessor results remain mutable detached copies; their reference identity is not stable across reads.
Opaque references retain their previous behavior and remain the host's responsibility.

## Cost and sharing

New caller-owned JSON payloads are traversed once when snapshotted. Only this helper's private owned
collections are trusted for reuse; externally supplied unmodifiable wrappers still require a snapshot.
Unchanged nested collections can be shared safely. `WorkflowInstance.toBuilder()` shares its owned context;
a context merge copies the top-level index and snapshots new values while retaining existing owned values,
including stored trees. History and branch bookkeeping still have their existing list-copy costs.

Reading a map/list is constant-time apart from a selected Jackson tree's defensive copy. Reading a tree
costs its subtree size; repeated tree reads and serialization therefore allocate detached trees. Callers
doing extensive tree processing should retain one accessor result locally. Pure map/list reads do not deep
copy the payload. There is no extra full snapshot per listener or metadata-only state transition.

`JsonOwnershipTest` exercises 10,000 nested rows (maps, lists, nulls, and trees) over 200 metadata updates
and context merges, verifies structural sharing of unchanged payloads, and checks isolation after mutation.
It has a generous ten-second guard against accidental repeated whole-payload copying, not a microbenchmark
throughput guarantee. `WorkflowEngineOwnershipTest` covers initial/completion payloads and executor/listener
isolation, and the model tests cover direct construction and Jackson round trips.
