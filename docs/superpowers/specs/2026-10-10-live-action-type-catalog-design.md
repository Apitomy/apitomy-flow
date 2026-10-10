# Live Action Type Catalog — Design

Date: 2026-10-10
Status: Approved (brainstorming)

## Context

This is sub-project #5 of the AI-assisted editing feature set (see `2026-10-08-ai-assisted-editing-design.md`).
While a user and an AI agent edit a workflow together, Apitomy Axiom may create new Action Types. The editor
needs to pick those up without a remount, show references to Action Types that are not in the catalog yet,
and let the host open its own Action Type editor.

Today the catalog is loaded only inside `PropertiesPanel` (`useActionTypes`) and used for the Action Type
picker. Swapping the provider already reloads the catalog (keeping the previous list while it loads),
but only the panel sees it.
Built-in validation does not check catalog membership.

## Decisions

| Topic | Decision |
|---|---|
| Unknown Action Types | Shown as unresolved (a canvas marker and a Properties panel note). Built-in validation is unchanged. |
| Live updates | No new API: the host passes a new `actionTypes` array or function, which reloads the catalog without a loading flash. |
| Opening the host editor | `spi.openActionType({ value, resolved })`, offered only from the Properties panel. |

## §1 Catalog state and unresolved references

A new hook, `ui/src/hooks/useActionTypeCatalog.ts`, is used by `WorkflowEditorInner` and returns
`{ actionTypes: ActionTypeDescriptor[]; status: 'none' | 'loading' | 'ready' }`. Its state changes are
implemented as a pure reducer in `ui/src/hooks/actionTypeCatalogState.ts`, and the hook runs that reducer.

- **No provider:** `status: 'none'`, `actionTypes: []`.
- **Static array:** `status: 'ready'` immediately, using the array.
- **Function provider:** `status: 'loading'` until the first result.
- **Provider swapped after a list has loaded:** the previous list stays, `status` stays `'ready'` while the
  new provider loads, and the list is replaced when the result arrives.
- **Stale results:** results from a provider that has since been replaced are ignored.
- **Rejected promise:** the last list is kept, or `[]` if none has loaded, and `status` is `'ready'`.

`PropertiesPanel` stops loading the catalog itself and receives `actionTypes` and `status` as props. The
picker's existing "loading" behaviour is shown only while `status === 'loading'`.

**Unresolved references.** A pure helper, `unresolvedActionTypeIds(workflow, catalog)` in
`ui/src/utils/unresolvedActionTypes.ts`, returns the set of ids of action nodes that meet all of these:

- the node's `config.actionType` is a string that is not blank;
- `catalog.status === 'ready'`;
- no descriptor in `catalog.actionTypes` has that `value`.

When the status is `'none'` or `'loading'`, the set is empty.

**Presentation:**

- **Canvas:** an unresolved node shows a "?" marker in its top-right corner with an accessible label and
  tooltip "Unknown Action Type: <value>". It sits next to the validation badge when both are present.
- **Properties panel:** under the Action Type field it shows "Not in the catalog yet" for unresolved values.
- **Validation:** unchanged.
- **Live updates:** when the host passes a catalog that contains the value, the marker and the note
  disappear on the next render.

## §2 Opening the host's Action Type editor

```ts
interface EditorSpi {
  /** Opens the host's Action Type editor; called from the Properties panel. */
  openActionType?: (request: { value: string; resolved: boolean }) => void;
}
```

- **The button:** shown beside the Action Type field when `openActionType` is provided and the field has a
  value that is not blank. Its label is "Open" when the value is in the catalog and "Create…" when it is not.
  `resolved` uses the same rule as `unresolvedActionTypeIds`; while the catalog is loading, `resolved` is
  `true`.
- **Read-only editors:** the button is shown.
- **Errors:** if the callback throws, Flow logs the error with `console.error` and carries on.

## Documentation

- **User guide:** add a "Live Action Type catalog" section to `docs/user-guide/ai-assisted-editing.md`. It
  shows a host keeping its catalog in React state and passing `actionTypes` again, and documents
  `openActionType`.
- **TSDoc:** update `ActionTypeProvider` to say that swapping the provider reloads the catalog while keeping
  the previous list visible.

## Testing

- **Vitest:**
  - `unresolvedActionTypeIds`: each status, blank and non-string values, and non-action nodes.
  - The catalog reducer: initial states, keeping the list during a reload, ignoring stale provider results,
    and keeping the list when a load fails.
- **Playwright, using new modes on the browser test page:**
  - A node whose Action Type is missing from the catalog shows the marker.
  - A host "Add to catalog" control removes the marker without remounting the editor.
  - Swapping to a slow provider never shows a loading state once a list has loaded.
  - Open and Create… call the callback with the right request.
  - The button is absent when the callback is missing.

## Out of scope

- A subscribable provider or an imperative refresh method.
- A built-in validation warning for unknown Action Types.
- Opening the host editor from the canvas or a context menu. Hosts can use `contextActions` for that.
