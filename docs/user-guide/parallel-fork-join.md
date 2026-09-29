# Parallel Fork/Join Example

This worked example triages a CVE by running two independent steps in parallel — assessing impact and
notifying the security team — then joining to produce a single report. It exercises a fork, an
AND-join, and branch-aware simulation.

## The workflow

`fetch-cve` fans out to `analyze-impact` and `notify-team` (both edges are unconditional, so they run
in parallel). Both branches converge on `create-report`, which waits for both before it runs.

```json
{
  "id": "cve-analyze-and-notify",
  "name": "CVE Analyze and Notify",
  "description": "Assess impact and notify the security team in parallel, then report.",
  "version": 1,
  "nodes": [
    {
      "id": "start", "type": "start", "name": "Start",
      "config": { "inputs": [{ "name": "cveId", "type": "string", "required": true }] },
      "position": { "x": 40, "y": 200 }
    },
    {
      "id": "fetch-cve", "type": "action", "name": "Fetch CVE Details",
      "config": {
        "actionType": "fetch-cve",
        "inputs": { "CVE ID": "context.cveId" },
        "outputs": [{ "name": "cve", "type": "object", "required": true }]
      },
      "position": { "x": 260, "y": 200 }
    },
    {
      "id": "analyze-impact", "type": "action", "name": "Analyze Impact",
      "config": {
        "actionType": "analyze-impact",
        "inputs": { "CVE": "context.cve" },
        "outputs": [{ "name": "severity", "type": "string", "required": true }]
      },
      "position": { "x": 500, "y": 100 }
    },
    {
      "id": "notify-team", "type": "action", "name": "Notify Security Team",
      "config": {
        "actionType": "send-notification",
        "inputs": { "CVE ID": "context.cveId" },
        "outputs": [{ "name": "notifiedAt", "type": "string", "required": true }]
      },
      "position": { "x": 500, "y": 300 }
    },
    {
      "id": "create-report", "type": "action", "name": "Create Report",
      "config": {
        "actionType": "create-report",
        "inputs": { "CVE ID": "context.cveId", "Severity": "context.severity" },
        "outputs": [{ "name": "reportUrl", "type": "string", "required": true }]
      },
      "position": { "x": 760, "y": 200 }
    },
    {
      "id": "end", "type": "end", "name": "Published",
      "config": { "outcome": "published" },
      "position": { "x": 1000, "y": 200 }
    }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "fetch-cve", "priority": 0, "isDefault": false },
    { "id": "e2", "source": "fetch-cve", "target": "analyze-impact", "priority": 0, "isDefault": false },
    { "id": "e3", "source": "fetch-cve", "target": "notify-team", "priority": 1, "isDefault": false },
    { "id": "e4", "source": "analyze-impact", "target": "create-report", "priority": 0, "isDefault": false },
    { "id": "e5", "source": "notify-team", "target": "create-report", "priority": 0, "isDefault": false },
    { "id": "e6", "source": "create-report", "target": "end", "priority": 0, "isDefault": false }
  ]
}
```

## Why this is a valid fork/join

- **`fetch-cve` is a fork:** it has two outgoing edges (`e2`, `e3`), both unconditional
  (`isDefault: false`, no `condition`). Completing `fetch-cve` activates both branches.
- **`create-report` is the join:** it is the first node reachable from both branches and has two
  incoming edges (`e4`, `e5`). As an AND-join it runs only after both `analyze-impact` and `notify-team`
  complete.
- **The region is balanced:** neither branch reaches `end` before `create-report`, so it validates with
  no `FORK_WITHOUT_JOIN` or `PARALLEL_BRANCH_REACHES_END` problems.

## Supported join topology

Join arrivals are tracked by incoming edge ID. Before Java calls any executor, validation checks that
each fork branch reaches its join through **one distinct incoming edge**. The editor validator and
simulator apply the same rules; unsupported topology fails simulation before any node is entered.

- Exclusive choices inside a branch are supported when their paths merge **before** the parallel join,
  so either choice reaches the same arrival edge. Separate conditional/default edges directly into the
  join are also separate arrival edges and are rejected (`UNBALANCED_PARALLEL`).
- Nested forks must finish at their own join before reaching the enclosing join. Forks sharing a join,
  or sibling branches sharing an arrival edge, are rejected (`UNBALANCED_PARALLEL`).
- Edges from outside the region into its branch interiors or join are rejected
  (`CROSSING_PARALLEL_REGIONS`), including conditional paths that bypass the fork.
- A completed region may loop back to its fork, and an inner region may repeat while its outer sibling
  waits. A branch returning to its own fork **before** joining is rejected (`PARALLEL_REGION_CYCLE`).
- A join may also fork into the next balanced region. Ordinary sequential exclusive choices remain
  supported.

These checks are structural: conditions are not assumed to be always true or mutually exhaustive.
Runtime condition failures, missing matching edges, and loops exceeding the transition limit still fail
at execution time. Persisted branch and join-arrival fields retain their existing format.

## Running it

Starting the workflow activates both branches after `fetch-cve`. The instance's `activeBranches` holds
one entry per running branch; `currentNodeId` is `null` while both run. `create-report` fires once both
arrive; its two incoming edge ids accumulate in `joinArrivals` until the second lands. See
[Engine Usage](engine-usage.md#parallel-execution) for the resume-by-node API.

## Visualizing and simulating it

The [Workflow Viewer](workflow-viewer.md#parallel-branches) highlights both active nodes at once and
animates both branch arrivals. In the [Visual Editor](visual-editor.md#forkjoin-hint), `fetch-cve`
carries a **Fork** badge and `create-report` a **Join** badge, and simulation lets you resume each
blocked branch one at a time.
