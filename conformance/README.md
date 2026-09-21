# Java/browser conformance contract

These JSON files are executable examples, read directly by both Maven and Vitest. Expectations are
hand-authored. Changes to either implementation must preserve the common results or explicitly document
an intentional difference here and in the fixture. Normal CI runs both suites; no generator or copied
language-specific fixture is required.

## Corpus

| File | Contract |
| --- | --- |
| `expressions.json` | Raw values, strict boolean routing, numeric coercion, nulls, access, short circuiting, ternaries, malformed syntax, engine-only syntax |
| `validation.json` | Common duration validation examples and problem codes/severities |
| `routing.json` | Priority/default routing, event mappings, pre-merge context, output aliases, literal inputs, workflow round trips, parked branches and join arrivals across serialized resumes |
| `budgets.json` | Fresh budget per advancement, repeated resumes, exact limit and one-over-limit, browser Step and Run |
| `parallel-topology.json` | C2 topology acceptance/rejection, conditional parallel paths, nested regions, loops and branch completion orders |
| `workflow-v1.schema.json` | Versioned structural wire schema; semantic validation remains in the runtime validators |
| `config-v1.json`, `config-invalid-v1.json` | All built-in configs, nullability/defaults, optional positions, nested host extensions, and shared rejection cases |

Run from `engine/`: `mvn test`. Run from `ui/`: `npm test` and `npx tsc --noEmit`.
See [typed configuration](../docs/user-guide/typed-configuration.md) for schema versioning and migration.
Focused runners are `ConformanceTest`/`ParallelTopologyTest` and
`src/simulation/conformance.test.ts`/`src/simulation/parallelTopology.test.ts`.

## Expression subset and engine-only syntax

The browser supports JSON object/array navigation from `context` and `event`, string/number/boolean/null
literals, parentheses, comparison, arithmetic, logical and `empty` operators (including keyword aliases),
and lazy right-associative `condition ? yes : no`. Exponents require digits after the optional sign.
Only an actual boolean `true` selects a conditional edge; a blank edge is unconditional.

Java uses Jakarta EL. Browser parsing is not a complete Jakarta EL validator. Method/function calls,
collection literals, lambdas, assignment, sequencing and concatenation are outside the browser dialect.
Fixtures marked `browser: "unsupported"` must compile and evaluate to their expected values in Java;
the browser must warn with `UNSUPPORTED_EXPRESSION_DIALECT` and refuse evaluation with an explicit
unsupported-dialect error. Import retains these expressions verbatim, including event-output mappings.

`classifyExpression` returns `supported`, `invalid`, or `unsupported`. `isValidExpression` is retained
as a boolean check for the **browser subset**. Both edge and event-output validation use the classifier.
Malformed subset syntax retains `INVALID_CONDITION` (warning) or `INVALID_OUTPUT_EXPRESSION` (error).
Recognition of an engine-only construct is conservative: it means **not validated here**, not valid EL.
Malformed expressions containing such constructs may also receive the unsupported warning; use Java
validation as the authority. Expressions are parsed in full before evaluation, including lazy branches.

## Verified guarantees and limits

- The corpus pins results for the listed examples, not universal equivalence with Jakarta EL. Java
  numeric types and JavaScript IEEE-754 numbers differ; large integers, overflow, integer-versus-decimal
  coercion, object identity/equality, Java beans, and host functions are outside the verified contract.
- Duration fixtures cover common nonnegative days/time strings. Java accepts additional signed and
  case-insensitive duration forms that the existing browser duration validator does not accept.
- Simulation never executes host actions, checks event correlation, waits for timers, or exercises
  error-handler retries. All actions pause for mock output; waits pass through immediately. Java action
  inputs are resolved by the real engine; browser tests verify their import/edit/export preservation.
- Event payload mocks are delivered as `SimMock.output`, as in the simulation panel. `SimMock.event`
  remains informational. All event mappings resolve against the same pre-merge context.
- Each successful resume resets the 100-transition advancement budget, shared by all runnable branches.
  Step and Run calls within one advancement do not reset it. Fork dispatch counts once, as in Java.
  Browser waits substitute for immediate Java actions in the uninterrupted budget fixtures because
  browser actions always park and Java waits always park. Thus timing/budget placement can differ in
  a real graph containing synchronous actions or timers even though advancement reset rules agree.
- Workflow round trips preserve supplied fields, including arbitrary nested config extensions and
  literal inputs. Optional omitted fields may be materialized as null/defaults by Jackson or browser
  normalization; key order, whitespace and omission are not byte-for-byte contracts. Java models do not
  support arbitrary unknown top-level fields, while browser imports preserve them (inherited behavior).
- Shared routing checkpoints assert status, context, visited nodes, active branch IDs and join arrivals
  after every resume, with a JSON round trip before each completion. Timestamps and random instance IDs
  are intentionally not compared. SimState is not the WorkflowInstance wire format.

Inherited literal handling and C2 parallel restrictions remain in force. Add a fixture when extending
the subset or changing a contract; do not silently skip a case in either runner.
