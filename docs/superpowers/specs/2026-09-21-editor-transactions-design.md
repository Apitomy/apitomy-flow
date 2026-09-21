# C9: Atomic editor transactions

Implements issue #132 and task 9 of the code-quality program. The approved approach keeps the public
`WorkflowEditor` props and JSON format, and moves document mutations into a pure command reducer.

## State ownership and history

`editorState.ts` owns the workflow document, property-panel selection, history, and interaction mode.
Each semantic command computes a complete document before recording history. Rename changes the node ID,
both edge endpoints, and selected node together. Delete removes nodes and incident edges together.
Import replaces metadata and graph together. Properties, metadata, layout, drag completion, clone,
connection, and deletion all follow the same before/after convention. Undo and redo restore full documents.
No-op and rejected commands preserve redo and do not advance the document revision.

History retains at most 50 prior documents. Commands and initial documents are cloned at ownership
boundaries. Host extension properties survive edits, layout, imports, and history. Generated node/edge IDs
are command inputs; the reducer has no random IDs, clocks, subscriptions, or callbacks.

Typing in one focused text-like control shares a history group. Blur, selection changes, mode changes,
structural commands, undo, and redo end that group. Node-ID typing uses a focus-session key independent
of the changing ID. Buttons, selects, and checkboxes create individual history entries. Notifications
still publish each committed text change; only undo entries coalesce.

## ReactFlow presentation

ReactFlow nodes and edges are presentation state alongside the canonical document. Measurements, canvas
selection, resizing, and in-progress drag positions are excluded from document snapshots and notifications.
Semantic updates merge the current presentation back into the new graph. Internal stable node keys retain
measurements and selection across rename and its undo/redo. Newly restored deleted nodes are remeasured.
Import resets canvas selection; presentation data never leaks into exported workflows.

Pointer drag frames update presentation only. Release commits all final positions once; a duplicate
drag-stop callback is a no-op. Keyboard movement commits immediately because it has no drag-stop callback.
Entering simulation or locking the canvas discards unfinished presentation positions.

## Notifications, StrictMode, and host compatibility

`useEditorState` initializes through the reducer initializer. `editorNotifications` publishes only committed
revisions from a React effect and remembers the last emitted revision per mounted editor. Effect replay,
callback identity changes, measurements, and selection cannot repeat a document notification. React-batched
commands may publish just the final revision; every published document is internally complete. The host
receives a clone so callback mutation cannot alter undo history.

An already-positioned workflow has no mount notification. Fallback layout emits once and becomes the
initial, non-undoable document. Reducer replay is deterministic and never publishes. Simulation toggling
also avoids nested state setters in updater callbacks.

The graph remains mount-initialized, as before; hosts replace it by remounting or using import. Live host
changes to ID/name/description/version enter as atomic metadata commands. Echoing the latest `onChange`
document is a no-op. An unchanged host prop does not override imported or undone metadata. Metadata changes
received during simulation are rejected like other document commands. An asynchronous host replay of an
older, different metadata value is indistinguishable from an intentional metadata edit under the existing
API; versioned controlled editing belongs to F9, not this internal refactor.

## Interaction policy

Simulation rejection lives in the reducer, including late FileReader imports, drop, context menu actions,
ReactFlow removal/position events, property callbacks, undo/redo, and tidy. Measurements and inspection
selection remain available. The ordinary canvas lock blocks canvas mutations; property editing, import,
and undo/redo remain available outside simulation.

Keyboard handling is attached to the editor root. The nearest editor root owns an event, including nested
editors. Text inputs, textareas, selects, contenteditable, textbox/Monaco controls, IME composition, and
already-consumed events retain their native behavior. Canvas pointer interaction establishes focus without
stealing focus from controls. ReactFlow's document-wide deletion listener is disabled; one local delete
command handles the selected nodes and edges. Simulation switches use unique React IDs.

## Verification and C10 boundary

Vitest tests exercise the real reducer, notification publisher, and shortcut policy with no DOM mocks.
They cover atomic rename/delete, property and ID history, typing boundaries, metadata import undo,
layout redo, transient state, drag release, history bounds, extensions, ownership, replay determinism,
simulation rejection, and shortcut decisions. These tests establish state contracts; they do not claim
to mount React StrictMode or prove browser event delivery.

C10 (#133) must run the following rendered scenarios with the actual editor, ReactFlow, and StrictMode:

1. Positioned mount emits nothing; positionless mount emits fallback once despite effect replay.
2. Type node name/config/ID and edge label/condition, blur, undo, redo. Verify per-field groups, stable
   property-panel focus during ID typing, checkbox/select/button operations, and native text undo.
3. Delete connected nodes and independently selected edges by keyboard and context menu. Assert one
   complete notification per operation, no dangling endpoint, and complete undo/redo restoration.
4. Import different metadata/graph, including reused IDs and positionless nodes; undo and redo with both
   immediate host echo and a host that does not update props. Inspect every callback payload.
5. Tidy, undo, redo; pointer-drag one/multiple nodes over many frames; keyboard-move a focused node.
   Check history granularity, final coordinates, measurements, selection, and viewport behavior.
6. Mount two editors, select elements in both, focus each canvas in turn, and use Ctrl/Cmd+Z, Shift+Z,
   Y, Delete, and Backspace. The other editor and its notifications must remain untouched. Repeat with
   focus in host inputs, editor inputs, contenteditable, and an optional Monaco JSON editor.
7. Enter simulation with undo/redo available and with a context menu open. Attempt drop, clone/delete,
   connection, drag, tidy, properties, keyboard history/delete, and import completion from a FileReader
   started before simulation. Assert document/history/notifications remain unchanged; leave simulation
   and verify editing resumes. Repeat canvas operations with the ordinary interaction lock.
8. Change callback identities, echo host state, change host metadata, mutate callback payloads, and
   unmount/remount under StrictMode. Assert no duplicate notifications or cross-instance listeners.

Remaining risks are browser event ordering/focus, asynchronous host echo ambiguity in the existing API,
and full-document clone/equality cost on large graphs. C10 owns the rendered harness and C13 owns
large-graph/history benchmarking. No jsdom or browser-test dependency is introduced here.
