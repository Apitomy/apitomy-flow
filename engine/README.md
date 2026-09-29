# Apitomy Flow Engine

A lightweight, stateless workflow engine library for Java. Define workflows as graphs of typed
nodes and conditional edges, then execute them with pluggable action handlers, error strategies,
and event listeners.

This README describes this branch's source, including pending C1–C14 changes; it is not a release
announcement. See [current contracts](../docs/user-guide/current-contracts.md) before choosing an artifact.

## Features

- **Stateless execution** -- runtime state lives in `WorkflowInstance` snapshots. Nested JSON maps/lists
  are read-only and Jackson trees are detached. Opaque host values must remain immutable; host callbacks
  need their own concurrency policy. See [ownership](../docs/user-guide/engine-usage.md#immutability).
- **Six node types** -- START, END, ACTION, HUMAN_TASK, RECEIVE_EVENT, and WAIT.
- **Conditional branching** -- edges carry Jakarta EL expressions evaluated against the instance
  context, with priority ordering and default-edge support.
- **Async / suspending nodes** -- HUMAN_TASK, RECEIVE_EVENT, WAIT, and ACTION returning `PENDING` park
  for external completion. Use `completeNode(..., nodeId, result)` with concurrent branches;
  `completeCurrentNode()` is the single-branch convenience method.
- **Structured parallelism** -- fork/join branches advance synchronously to quiescence; external work
  can run concurrently. The library creates no scheduler or worker threads.
- **Event correlation** -- match incoming events to RECEIVE_EVENT nodes by type and EL
  expressions.
- **Pluggable SPI** -- `NodeExecutor` for action execution, `WorkflowErrorHandler` for
  fail/retry/transition strategies, and `WorkflowEventListener` for lifecycle hooks.
- **Validation** -- shape and semantic checks run before execution; `startWorkflow` rejects definitions
  with error-level problems. The [validator sources](../docs/user-guide/validation.md) are authoritative.
- **JSON serialization** -- workflows and instances serialize to/from JSON via Jackson.

## Installation

```xml
<dependency>
    <groupId>io.apitomy</groupId>
    <artifactId>apitomy-flow-engine</artifactId>
    <version>${apitomy-flow.version}</version>
</dependency>
```

Set `apitomy-flow.version` to the artifact you have selected; for branch behavior build/install `pom.xml`
locally. Workflow schema version and the host's workflow revision are independent of artifact versions.

## Usage and executable examples

- [Engine Usage](../docs/user-guide/engine-usage.md): pending actions, branch-addressable APIs, persistence.
- [Structured errors](../docs/developer-guide/engine-errors.md): recovery and extension contracts.
- [Runnable examples](../docs/developer-guide/documentation-checks.md): Java and shared JSON fixtures.

## Requirements

- Java 21+

## License

[Apache License 2.0](../LICENSE)
