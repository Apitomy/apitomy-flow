# Apitomy Flow Engine

A lightweight, stateless workflow engine library for Java. Define workflows as graphs of typed
nodes and conditional edges, then execute them with pluggable action handlers, error strategies,
and event listeners.

## Features

- **Stateless execution** -- the engine holds no internal state; all runtime state lives in an
  immutable `WorkflowInstance` snapshot, making the engine thread-safe and persistence-agnostic.
- **Six node types** -- START, END, ACTION, HUMAN_TASK, RECEIVE_EVENT, and WAIT.
- **Conditional branching** -- edges carry Jakarta EL expressions evaluated against the instance
  context, with priority ordering and default-edge support.
- **Async / suspending nodes** -- HUMAN_TASK, RECEIVE_EVENT, and WAIT nodes pause execution for
  external completion via `completeCurrentNode()`.
- **Event correlation** -- match incoming events to RECEIVE_EVENT nodes by type and EL
  expressions.
- **Pluggable SPI** -- `NodeExecutor` for action execution, `WorkflowErrorHandler` for
  fail/retry/transition strategies, and `WorkflowEventListener` for lifecycle hooks.
- **Validation** -- structural correctness checks before execution.
- **JSON serialization** -- workflows and instances serialize to/from JSON via Jackson.

## Installation

```xml
<dependency>
    <groupId>io.apitomy</groupId>
    <artifactId>apitomy-flow-engine</artifactId>
    <version>1.0.0</version>
</dependency>
```

## Requirements

- Java 25+

## License

[Apache License 2.0](../LICENSE)
