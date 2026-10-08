# AI-Assisted Editing Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Let a host (Apitomy Axiom) stage or apply AI-authored change sets on `WorkflowEditor`, with a
content revision and change-set semantics that are identical in TypeScript and Java.

**Architecture:**
- **Pure core:** the change-set logic lives in pure modules under `ui/src/changeset/`: canonical JSON,
  `contentRevision`, `applyChangeSet`, the change-status diff, the validation delta and the overlay
  builder.
- **Java:** mirrored in `engine/` under the package `io.apitomy.flow.changeset`. Shared `conformance/` JSON
  fixtures prove that the two implementations agree.
- **Editor wiring:** the editor reducer gains `contentRevision`, `origin`, proposal and highlight state. An
  imperative handle (React 19 ref prop) sits on top of the reducer, and the editor component renders the
  overlay and a review bar.

**Tech Stack:**
- TypeScript, React 19, `@xyflow/react` 12, vitest, Playwright browser tests (`ui/browser/`).
- `@noble/hashes` for synchronous SHA-256.
- Java 21, Jackson 2.22, JUnit Jupiter, and `io.github.erdtman:java-json-canonicalization` (RFC 8785).

**Spec:** `docs/superpowers/specs/2026-10-08-ai-assisted-editing-design.md` (read it before starting any
task).

## Global Constraints

- Work on branch `feat/ai-assisted-editing`. Never commit to `main` or to other branches.
- Commit messages must not include any AI or Claude attribution.
- **Revision format:**
  - `contentRevision` = `"sha256:" + lowercase hex SHA-256 of the UTF-8 bytes of the RFC 8785 (JCS)
    canonical JSON of the workflow`, with `position` removed from every node.
  - Every other field is content: workflow `id`, `name`, `description`, `version`, and config extension
    keys.
  - `null` values are content. `undefined` / absent keys are not.
- **Error codes (exact strings):** `target-missing`, `duplicate-id`, `edge-endpoint-missing`, `malformed`,
  `read-only`, `stale`.
- **Patch semantics:**
  - Patches are shallow. Nested values such as `inputs` are replaced whole.
  - `unset` removes top-level keys and is applied after `patch`.
  - A key that appears in both `patch` and `unset` is `malformed`.
  - `null` in a patch is stored as a value.
- At most one staged proposal at a time.
- A staged proposal becomes stale on any content change (including undo/redo, host metadata and `replace`).
  It does not become stale on layout-only edits.
- **Testing:**
  - No jsdom and no `@testing-library/react`. Testable logic goes in pure functions tested with vitest.
  - React components are exercised by the Playwright suite in `ui/browser/`.
- **Code style:**
  - TS files: keep the indentation style already used in the file being edited. Hooks, changeset and
    layout code use 4 spaces. `WorkflowEditor.tsx` uses 2 spaces.
  - Use explicit `.ts`/`.tsx` import extensions.
  - Add a TSDoc/Javadoc comment to every exported or public symbol.
- **Dependencies:** `ui/package.json` dependency versions are pinned exactly (no `^`).
- **Verification commands:**
  - TS, run from `ui/`: `npx vitest run <file>`, `npx tsc --noEmit`, `npm run lint`.
  - Java, run from `engine/`: `./mvnw -q test -Dtest=<Class>`.
  - Before marking any task done, run the full `npx vitest run` (TS) or `./mvnw -q test` (Java).

## File Map

| File | Responsibility |
|---|---|
| `conformance/content-revision.json` | Shared hash vectors |
| `conformance/changesets.json` | Shared change-set vectors |
| `ui/src/changeset/types.ts` | `ChangeSet`, `ChangeOp`, errors, `Origin`, proposal/highlight types |
| `ui/src/changeset/canonicalJson.ts` | RFC 8785 serialization |
| `ui/src/changeset/contentRevision.ts` | `stripLayout`, `computeContentRevision` |
| `ui/src/changeset/applyChangeSet.ts` | Pure op application, `applyChangeSetChecked` |
| `ui/src/changeset/changeStatus.ts` | added/modified/removed/unchanged map and highlight ids |
| `ui/src/changeset/validationDelta.ts` | Introduced/fixed problems |
| `ui/src/changeset/proposalOverlay.ts` | Pure React Flow overlay builder, counts, details |
| `ui/src/layout/layoutWorkflow.ts` | Adds `placeNewNodes`, `layoutForImport` |
| `ui/src/hooks/editorState.ts` | Revision/origin/proposal/highlight state and commands |
| `ui/src/hooks/editorReadOnly.ts` | Read-only allowlist for the new commands |
| `ui/src/hooks/editorNotifications.ts` | `onChange` meta, proposal and selection publishers |
| `ui/src/hooks/editorHandle.ts` | Pure `createEditorHandle` |
| `ui/src/hooks/useEditorState.ts` | Wires the publishers |
| `ui/src/components/panels/ProposalReviewBar.tsx` | Review bar UI |
| `ui/src/components/WorkflowEditor.tsx` | Props, ref handle, overlay, review bar |
| `ui/src/components/WorkflowEditor.css` | Proposal/highlight styles |
| `ui/src/index.ts` | Public exports |
| `engine/src/main/java/io/apitomy/flow/changeset/*.java` | `ContentRevision`, `ChangeSets`, `ChangeSetError`, `ChangeSetResult` |
| `ui/browser/host.tsx`, `ui/browser/ai-editing.spec.ts` | Browser harness controls and end-to-end tests |
| `docs/user-guide/ai-assisted-editing.md`, `mkdocs.yml`, `conformance/README.md` | Documentation |

---

### Task 1: Canonical JSON and `contentRevision` (TypeScript)

**Files:**
- Modify: `ui/package.json` (add the dependency)
- Create:
  - `ui/src/changeset/canonicalJson.ts`
  - `ui/src/changeset/contentRevision.ts`
  - `ui/src/changeset/contentRevision.test.ts`
  - `conformance/content-revision.json`

**Interfaces:**
- Produces:
  - `canonicalJson(value: unknown): string`
  - `stripLayout(workflow: Workflow): Workflow`
  - `computeContentRevision(workflow: Workflow): string`

- [ ] **Step 1: Add the hashing dependency**

Run from `ui/`: `npm install --save-exact @noble/hashes@2.4.0`

Expected: `"@noble/hashes": "2.4.0"` appears under `dependencies` in `ui/package.json`.

- [ ] **Step 2: Create the shared fixture `conformance/content-revision.json`**

These hashes were verified against both Node's `crypto` and Java (Jackson + erdtman JCS). Copy the file
exactly, preserving the escapes in the "string escaping" case:

```json
[
  {"name": "minimal", "revision": "sha256:e09ffb8ddf410850689c559223eab3d60b3ab7686e2f5f56f7133bce0f53f357", "workflow": {"id":"w","name":"W","nodes":[{"id":"s","type":"start","name":"Start","config":{}},{"id":"e","type":"end","name":"End","config":{}}],"edges":[{"id":"se","source":"s","target":"e","priority":0,"isDefault":false}]}},
  {"name": "key order and positions do not matter", "revision": "sha256:e09ffb8ddf410850689c559223eab3d60b3ab7686e2f5f56f7133bce0f53f357", "workflow": {"edges":[{"isDefault":false,"priority":0,"target":"e","source":"s","id":"se"}],"nodes":[{"position":{"x":10,"y":20},"config":{},"name":"Start","type":"start","id":"s"},{"id":"e","type":"end","name":"End","config":{},"position":{"x":300,"y":20}}],"name":"W","id":"w"}},
  {"name": "number formatting", "revision": "sha256:af7eaff8d8d393c28bd7063d0083d7ed7486e031aecd6ed86b6f61e076aff25c", "workflow": {"id":"w","name":"W","version":3,"nodes":[{"id":"a","type":"action","name":"A","config":{"x-num":{"a":1.0,"b":1.5,"c":1e21,"d":0.1,"e":-0,"f":9007199254740991,"g":1e-7}}}],"edges":[]}},
  {"name": "string escaping and UTF-16 key order", "revision": "sha256:02224449d8fad22348134372b3356ae58fe2d8b6c11b687d3e2233eec7d192b9", "workflow": {"id":"w","name":"W","description":"Quote \" slash \\ ctrl \u0001 tab \t emoji 😀","nodes":[{"id":"a","type":"action","name":"A","config":{"z":1,"é":2,"a":3,"€":4,"\ud83d\ude00":5,"\ufb33":6}}],"edges":[]}},
  {"name": "null config values are content", "revision": "sha256:f7594ccafb4c5779a72def76e38266f5a92e7854bbffc35e224f8487227143bb", "workflow": {"id":"w","name":"W","nodes":[{"id":"a","type":"action","name":"A","config":{"actionType":null}}],"edges":[]}}
]
```

- [ ] **Step 3: Write the failing tests `ui/src/changeset/contentRevision.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import vectors from '../../../conformance/content-revision.json';
import { canonicalJson } from './canonicalJson.ts';
import { computeContentRevision, stripLayout } from './contentRevision.ts';
import type { Workflow } from '../types/workflow.ts';

describe('shared content revision vectors', () => {
    for (const vector of vectors as { name: string; revision: string; workflow: unknown }[]) {
        it(vector.name, () => {
            expect(computeContentRevision(vector.workflow as Workflow)).toBe(vector.revision);
        });
    }
});

describe('canonicalJson', () => {
    it('sorts keys, drops undefined properties and keeps array order', () => {
        expect(canonicalJson({ b: 1, a: [3, 1], c: undefined })).toBe('{"a":[3,1],"b":1}');
    });

    it('rejects non-finite numbers', () => {
        expect(() => canonicalJson({ n: Number.NaN })).toThrow(TypeError);
    });
});

describe('stripLayout', () => {
    it('removes node positions without mutating the input', () => {
        const workflow: Workflow = { id: 'w', name: 'W', edges: [],
            nodes: [{ id: 's', type: 'start', name: 'S', config: {}, position: { x: 1, y: 2 } }] };
        expect(stripLayout(workflow).nodes[0]).not.toHaveProperty('position');
        expect(workflow.nodes[0].position).toEqual({ x: 1, y: 2 });
    });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run src/changeset/contentRevision.test.ts`

Expected: FAIL, because `./canonicalJson.ts` cannot be resolved.

- [ ] **Step 5: Implement `ui/src/changeset/canonicalJson.ts`**

```ts
/**
 * Serializes a JSON-compatible value using RFC 8785 (JSON Canonicalization Scheme).
 *
 * Object keys are sorted by UTF-16 code units (the default `Array.prototype.sort` order), properties whose
 * value is `undefined` are omitted, and numbers/strings use ECMAScript `JSON.stringify` formatting, which is
 * what RFC 8785 mandates.
 *
 * @param value the JSON value to serialize
 * @returns the canonical JSON text
 * @throws TypeError for non-finite numbers or non-JSON values
 */
export function canonicalJson(value: unknown): string {
    if (value === null) return 'null';
    switch (typeof value) {
        case 'boolean':
            return value ? 'true' : 'false';
        case 'number':
            if (!Number.isFinite(value)) throw new TypeError(`Non-finite number ${value} cannot be canonicalized`);
            return JSON.stringify(value);
        case 'string':
            return JSON.stringify(value);
        case 'object': {
            if (Array.isArray(value)) {
                return `[${value.map(item => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
            }
            const record = value as Record<string, unknown>;
            const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
            return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
        }
        default:
            throw new TypeError(`Unsupported JSON value of type ${typeof value}`);
    }
}
```

- [ ] **Step 6: Implement `ui/src/changeset/contentRevision.ts`**

```ts
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Workflow, WorkflowNode } from '../types/workflow.ts';
import { canonicalJson } from './canonicalJson.ts';

/**
 * Returns a shallow copy of the workflow whose nodes carry no `position` (layout is not content).
 *
 * @param workflow the workflow to strip
 * @returns a copy without node positions; the input is not mutated
 */
export function stripLayout(workflow: Workflow): Workflow {
    return {
        ...workflow,
        nodes: workflow.nodes.map(node => {
            const copy: WorkflowNode = { ...node };
            delete copy.position;
            return copy;
        }),
    };
}

/**
 * Computes the content revision of a workflow: `sha256:` + hex SHA-256 of the RFC 8785 canonical JSON of
 * the workflow with layout stripped. Matches `io.apitomy.flow.changeset.ContentRevision` in the engine.
 *
 * @param workflow the workflow document
 * @returns the opaque revision string
 */
export function computeContentRevision(workflow: Workflow): string {
    return `sha256:${bytesToHex(sha256(utf8ToBytes(canonicalJson(stripLayout(workflow)))))}`;
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run src/changeset/contentRevision.test.ts && npx tsc --noEmit`

Expected: all tests PASS and there are no type errors. If the `resolveJsonModule` import fails in `tsc`,
check how `src/simulation/conformance.test.ts` imports its fixtures and copy that pattern.

- [ ] **Step 8: Commit**

```bash
git add ui/package.json ui/package-lock.json ui/src/changeset conformance/content-revision.json
git commit -m "Add canonical JSON and content revision hashing"
```

---

### Task 2: `ContentRevision` (Java)

**Files:**
- Modify: `engine/pom.xml` (add the dependency)
- Create:
  - `engine/src/main/java/io/apitomy/flow/changeset/ContentRevision.java`
  - `engine/src/main/java/io/apitomy/flow/changeset/package-info.java`
  - `engine/src/test/java/io/apitomy/flow/changeset/ContentRevisionTest.java`

**Interfaces:**
- Consumes: `conformance/content-revision.json` (Task 1)
- Produces:
  - `ContentRevision.of(JsonNode workflow): String`
  - `ContentRevision.of(Workflow workflow): String`
  - `ContentRevision.stripLayout(JsonNode workflow): ObjectNode`

- [ ] **Step 1: Add the dependency to `engine/pom.xml`**

Add it next to the Jackson dependencies:

```xml
        <dependency>
            <groupId>io.github.erdtman</groupId>
            <artifactId>java-json-canonicalization</artifactId>
            <version>1.1</version>
        </dependency>
```

- [ ] **Step 2: Write the failing test `ContentRevisionTest.java`**

```java
package io.apitomy.flow.changeset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.apitomy.flow.model.Workflow;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Verifies {@link ContentRevision} against the shared conformance vectors. */
class ContentRevisionTest {

    private static final ObjectMapper MAPPER = new ObjectMapper().registerModule(new JavaTimeModule());

    record Vector(String name, JsonNode data) {
        @Override
        public String toString() {
            return name;
        }
    }

    static Stream<Vector> vectors() throws Exception {
        List<Vector> vectors = new ArrayList<>();
        MAPPER.readTree(Path.of("../conformance/content-revision.json").toFile())
            .forEach(data -> vectors.add(new Vector(data.path("name").asText(), data)));
        return vectors.stream();
    }

    @ParameterizedTest
    @MethodSource("vectors")
    void matchesSharedVector(Vector vector) {
        assertEquals(vector.data().path("revision").asText(), ContentRevision.of(vector.data().path("workflow")));
    }

    @Test
    void recordOverloadMatchesJsonOverload() throws Exception {
        JsonNode json = vectors().findFirst().orElseThrow().data().path("workflow");
        Workflow workflow = MAPPER.treeToValue(json, Workflow.class);
        assertEquals(ContentRevision.of(json), ContentRevision.of(workflow));
    }

    @Test
    void stripLayoutDoesNotMutateInput() throws Exception {
        JsonNode json = MAPPER.readTree("{\"nodes\":[{\"id\":\"a\",\"position\":{\"x\":1,\"y\":2}}]}");
        ContentRevision.stripLayout(json);
        assertFalse(json.path("nodes").get(0).path("position").isMissingNode());
    }
}
```

- [ ] **Step 3: Run the test and confirm it fails**

Run from `engine/`: `./mvnw -q test -Dtest=ContentRevisionTest`

Expected: a compilation failure, because `ContentRevision` does not exist yet.

- [ ] **Step 4: Implement `package-info.java` and `ContentRevision.java`**

```java
/** Change-set application and content revisions shared with the {@code @apitomy/flow-ui} editor. */
package io.apitomy.flow.changeset;
```

```java
package io.apitomy.flow.changeset;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.apitomy.flow.model.Workflow;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.erdtman.jcs.JsonCanonicalizer;

/**
 * Computes workflow content revisions identical to {@code computeContentRevision} in {@code @apitomy/flow-ui}:
 * {@code "sha256:" + hex(SHA-256(JCS(stripLayout(workflow))))}.
 */
public final class ContentRevision {

    private static final ObjectMapper MAPPER = new ObjectMapper()
        .registerModule(new JavaTimeModule())
        .setDefaultPropertyInclusion(
            JsonInclude.Value.construct(JsonInclude.Include.NON_NULL, JsonInclude.Include.ALWAYS));

    private ContentRevision() {
    }

    /**
     * Computes the revision of a workflow JSON document. Hosts must hash exactly the document sent to the
     * editor, without host-specific fields.
     *
     * @param workflow the workflow JSON object
     * @return the revision string, for example {@code sha256:e09f...}
     * @throws IllegalArgumentException if the document is not a JSON object
     */
    public static String of(JsonNode workflow) {
        if (workflow == null || !workflow.isObject()) {
            throw new IllegalArgumentException("workflow must be a JSON object");
        }
        try {
            String canonical = new JsonCanonicalizer(MAPPER.writeValueAsString(stripLayout(workflow)))
                .getEncodedString();
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8));
            return "sha256:" + HexFormat.of().formatHex(digest);
        } catch (IOException | NoSuchAlgorithmException e) {
            throw new IllegalStateException("Unable to compute content revision", e);
        }
    }

    /**
     * Computes the revision of a workflow record. Null record properties are omitted, as they would be
     * absent from the editor's JSON document; null values inside config maps are kept.
     *
     * @param workflow the workflow
     * @return the revision string
     */
    public static String of(Workflow workflow) {
        return of(MAPPER.valueToTree(workflow));
    }

    /**
     * Returns a deep copy of the workflow with {@code position} removed from every node.
     *
     * @param workflow the workflow JSON object
     * @return the stripped copy; the input is not mutated
     */
    public static ObjectNode stripLayout(JsonNode workflow) {
        ObjectNode copy = (ObjectNode) workflow.deepCopy();
        JsonNode nodes = copy.path("nodes");
        if (nodes.isArray()) {
            nodes.forEach(node -> {
                if (node instanceof ObjectNode object) {
                    object.remove("position");
                }
            });
        }
        return copy;
    }
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `./mvnw -q test -Dtest=ContentRevisionTest`

Expected: PASS.

If `recordOverloadMatchesJsonOverload` fails, the `Workflow` record serializes differently from its JSON
source, for example by adding derived properties. Compare `MAPPER.valueToTree(workflow)` with the input,
then either fix the serialization or narrow the test to the JSON overload. Note the reason in the commit
message.

- [ ] **Step 6: Run the full engine suite**

Run: `./mvnw -q test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add engine/pom.xml engine/src/main/java/io/apitomy/flow/changeset engine/src/test/java/io/apitomy/flow/changeset
git commit -m "Add Java ContentRevision matching the editor hash"
```

---

### Task 3: Place only positionless nodes

**Files:**
- Modify:
  - `ui/src/layout/layoutWorkflow.ts` (add `placeNewNodes` and `layoutForImport`)
  - `ui/src/hooks/editorState.ts` (`createEditorState` and the `import` case)
- Create: `ui/src/layout/placeNewNodes.test.ts`
- Test: `ui/src/hooks/editorState.test.ts` (add one test)

**Interfaces:**
- Produces:
  - `placeNewNodes(workflow: Workflow): Workflow`. Returns the same object when every node has a position.
  - `layoutForImport(workflow: Workflow): Workflow`

- [ ] **Step 1: Write the failing tests `ui/src/layout/placeNewNodes.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { placeNewNodes, layoutForImport, NODE_DIMENSIONS } from './layoutWorkflow.ts';
import type { Workflow, WorkflowNode } from '../types/workflow.ts';

const edge = (id: string, source: string, target: string) => ({ id, source, target, priority: 0, isDefault: false });
const node = (id: string, type: WorkflowNode['type'], position?: { x: number; y: number }): WorkflowNode =>
    ({ id, type, name: id, config: {}, ...(position ? { position } : {}) }) as WorkflowNode;
const pos = (workflow: Workflow, id: string) => workflow.nodes.find(n => n.id === id)!.position!;

describe('placeNewNodes', () => {
    it('returns the same object when every node is positioned', () => {
        const workflow: Workflow = { id: 'w', name: 'W', nodes: [node('s', 'start', { x: 0, y: 0 })], edges: [] };
        expect(placeNewNodes(workflow)).toBe(workflow);
    });

    it('lays out every node when none is positioned', () => {
        const workflow: Workflow = { id: 'w', name: 'W', nodes: [node('s', 'start'), node('e', 'end')],
            edges: [edge('se', 's', 'e')] };
        const placed = placeNewNodes(workflow);
        expect(placed.nodes.every(n => n.position && Number.isFinite(n.position.x))).toBe(true);
    });

    it('moves only positionless nodes and places them right of a positioned predecessor', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('s', 'start', { x: 10, y: 40 }), node('a', 'action'), node('e', 'end', { x: 900, y: 40 })],
            edges: [edge('sa', 's', 'a'), edge('ae', 'a', 'e')] };
        const placed = placeNewNodes(workflow);
        expect(pos(placed, 's')).toEqual({ x: 10, y: 40 });
        expect(pos(placed, 'e')).toEqual({ x: 900, y: 40 });
        expect(pos(placed, 'a')).toEqual({ x: 10 + NODE_DIMENSIONS.start.width + 90, y: 40 });
    });

    it('places a node with only a positioned successor to its left', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('a', 'action'), node('e', 'end', { x: 500, y: 0 })], edges: [edge('ae', 'a', 'e')] };
        expect(pos(placeNewNodes(workflow), 'a')).toEqual({ x: 500 - NODE_DIMENSIONS.action.width - 90, y: 0 });
    });

    it('places an unconnected node below the existing bounds', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('s', 'start', { x: 20, y: 0 }), node('e', 'end', { x: 300, y: 80 }), node('x', 'wait')],
            edges: [] };
        expect(pos(placeNewNodes(workflow), 'x')).toEqual({ x: 20, y: 80 + NODE_DIMENSIONS.end.height + 100 });
    });

    it('does not overlap two new nodes that share a predecessor', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('s', 'start', { x: 0, y: 0 }), node('a', 'action'), node('b', 'action')],
            edges: [edge('sa', 's', 'a'), edge('sb', 's', 'b')] };
        const placed = placeNewNodes(workflow);
        expect(pos(placed, 'a').x).toBe(pos(placed, 'b').x);
        expect(Math.abs(pos(placed, 'a').y - pos(placed, 'b').y)).toBeGreaterThanOrEqual(NODE_DIMENSIONS.action.height);
    });
});

describe('layoutForImport', () => {
    it('re-lays out a fully positioned but stacked graph', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('s', 'start', { x: 0, y: 0 }), node('e', 'end', { x: 0, y: 0 })], edges: [edge('se', 's', 'e')] };
        const placed = layoutForImport(workflow);
        expect(pos(placed, 's')).not.toEqual(pos(placed, 'e'));
    });

    it('keeps existing positions when only some nodes lack one', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('s', 'start', { x: 7, y: 9 }), node('e', 'end')], edges: [edge('se', 's', 'e')] };
        expect(pos(layoutForImport(workflow), 's')).toEqual({ x: 7, y: 9 });
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/layout/placeNewNodes.test.ts`

Expected: FAIL, because `placeNewNodes` is not exported.

- [ ] **Step 3: Implement the helpers at the end of `ui/src/layout/layoutWorkflow.ts`**

Add `import type { Workflow } from '../types/workflow.ts';` if `Workflow` is not already imported. This file
uses 2-space indentation, so keep it.

```ts
const PLACEMENT_GAP_X = 90;
const PLACEMENT_GAP_Y = 30;
const PLACEMENT_BELOW = 100;

type Point = { x: number; y: number };

function hasPosition(node: WorkflowNode): boolean {
  const p = node.position;
  return !!p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function sizeOf(node: WorkflowNode): { width: number; height: number } {
  return NODE_DIMENSIONS[node.type] ?? DEFAULT_NODE_DIMENSION;
}

/**
 * Positions only the nodes that have no valid position, leaving every positioned node untouched.
 *
 * Each new node goes right of its positioned predecessors (or left of its positioned successors) at their
 * average height, else below the existing bounds, then is nudged down until it overlaps nothing. When no
 * node has a position the whole graph is laid out with {@link layoutWorkflow}.
 *
 * @param workflow the workflow to place
 * @returns the same object when nothing needed placing, otherwise a copy with positions filled in
 */
export function placeNewNodes(workflow: Workflow): Workflow {
  const missing = workflow.nodes.filter(node => !hasPosition(node));
  if (missing.length === 0) return workflow;
  if (missing.length === workflow.nodes.length) {
    return { ...workflow, nodes: layoutWorkflow(workflow.nodes, workflow.edges) };
  }
  const byId = new Map(workflow.nodes.map(node => [node.id, node]));
  const placed = new Map<string, Point>(workflow.nodes.filter(hasPosition).map(node => [node.id, node.position!]));
  const initial = [...placed.entries()];
  const minX = Math.min(...initial.map(([, p]) => p.x));
  const maxBottom = Math.max(...initial.map(([id, p]) => p.y + sizeOf(byId.get(id)!).height));
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const overlaps = (node: WorkflowNode, p: Point) => [...placed.entries()].some(([id, q]) => {
    const a = sizeOf(node);
    const b = sizeOf(byId.get(id)!);
    return p.x < q.x + b.width && q.x < p.x + a.width && p.y < q.y + b.height && q.y < p.y + a.height;
  });

  for (const node of missing) {
    const preds = workflow.edges.filter(e => e.target === node.id && placed.has(e.source)).map(e => e.source);
    const succs = workflow.edges.filter(e => e.source === node.id && placed.has(e.target)).map(e => e.target);
    let position: Point;
    if (preds.length) {
      position = {
        x: Math.max(...preds.map(id => placed.get(id)!.x + sizeOf(byId.get(id)!).width)) + PLACEMENT_GAP_X,
        y: average(preds.map(id => placed.get(id)!.y)),
      };
    } else if (succs.length) {
      position = {
        x: Math.min(...succs.map(id => placed.get(id)!.x)) - sizeOf(node).width - PLACEMENT_GAP_X,
        y: average(succs.map(id => placed.get(id)!.y)),
      };
    } else {
      position = { x: minX, y: maxBottom + PLACEMENT_BELOW };
    }
    while (overlaps(node, position)) {
      position = { x: position.x, y: position.y + sizeOf(node).height + PLACEMENT_GAP_Y };
    }
    placed.set(node.id, position);
  }
  return { ...workflow, nodes: workflow.nodes.map(node => hasPosition(node) ? node : { ...node, position: placed.get(node.id)! }) };
}

/**
 * Chooses the layout for an imported or replaced document: a full layout only for a fully positioned graph
 * whose nodes are stacked on one point (see {@link needsLayout}); otherwise {@link placeNewNodes}.
 *
 * @param workflow the incoming workflow
 * @returns the workflow with every node positioned
 */
export function layoutForImport(workflow: Workflow): Workflow {
  if (workflow.nodes.length >= 2 && workflow.nodes.every(hasPosition) && needsLayout(workflow.nodes)) {
    return { ...workflow, nodes: layoutWorkflow(workflow.nodes, workflow.edges) };
  }
  return placeNewNodes(workflow);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/layout/placeNewNodes.test.ts`

Expected: PASS.

- [ ] **Step 5: Use `layoutForImport` in the editor**

In `ui/src/hooks/editorState.ts`, change the import line to
`import { layoutForImport } from '../layout/layoutWorkflow.ts';`. Keep `needsLayout` / `layoutWorkflow` in
the import only if they are still used elsewhere in the file.

Replace the first three lines of `createEditorState` with:

```ts
    const placed = layoutForImport(workflow);
    const fallback = placed !== workflow;
    const document = structuredClone(placed);
```

In the `case 'import':` branch, replace the
`needsLayout(imported.nodes) ? { ...imported, nodes: layoutWorkflow(...) } : imported` argument with
`layoutForImport(imported)`.

- [ ] **Step 6: Add the regression test to `ui/src/hooks/editorState.test.ts`**

```ts
it('import keeps existing coordinates and places only positionless nodes', () => {
    const state = createEditorState({ id: 'w', name: 'W', edges: [],
        nodes: [{ id: 's', type: 'start', name: 'S', config: {}, position: { x: 5, y: 6 } }] });
    const next = editorReducer(state, { type: 'import', workflow: { id: 'w', name: 'W', edges: [
        { id: 'sx', source: 's', target: 'x', priority: 0, isDefault: false }],
        nodes: [{ id: 's', type: 'start', name: 'S', config: {}, position: { x: 5, y: 6 } },
            { id: 'x', type: 'end', name: 'X', config: {} }] } });
    expect(next.document.nodes[0].position).toEqual({ x: 5, y: 6 });
    expect(next.document.nodes[1].position).toBeDefined();
});
```

Add any missing imports (`createEditorState`, `editorReducer`) to match the file's existing import line.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`

Expected: PASS.

If an existing test asserted that a *partially* positioned import re-lays out every node, it encodes the bug
this task fixes. Update that test to expect that the existing coordinates are kept, and explain why in the
commit message.

- [ ] **Step 8: Commit**

```bash
git add ui/src/layout ui/src/hooks/editorState.ts ui/src/hooks/editorState.test.ts
git commit -m "Place only positionless nodes on import instead of re-laying out the graph"
```

---

### Task 4: `applyChangeSet` (TypeScript) and the shared change-set fixtures

**Files:**
- Create:
  - `ui/src/changeset/types.ts`
  - `ui/src/changeset/applyChangeSet.ts`
  - `ui/src/changeset/applyChangeSet.test.ts`
  - `ui/src/changeset/changesets.conformance.test.ts`
  - `conformance/changesets.json`

**Interfaces:**
- Consumes:
  - `computeContentRevision` and `stripLayout` (Task 1)
  - `placeNewNodes` (Task 3)
- Produces:
  - All of the types below
  - `applyChangeSet(workflow: Workflow, changeSet: ChangeSet): ChangeSetResult`
  - `applyChangeSetChecked(workflow: Workflow, changeSet: ChangeSet, currentRevision?: string): ChangeSetResult`

- [ ] **Step 1: Create `ui/src/changeset/types.ts`**

```ts
import type { Workflow, WorkflowEdge, WorkflowNode } from '../types/workflow.ts';

/** Who produced a committed change: the person at the editor, the embedding host, or a named agent. */
export type Origin = 'user' | 'host' | `agent:${string}`;

/** Metadata delivered with every `onChange` notification. */
export interface ChangeMeta {
    /** Content revision of the published workflow (see `computeContentRevision`). */
    contentRevision: string;
    /** Origin of the change that produced this revision. */
    origin: Origin;
}

/** One serializable edit. Ops apply in order; later ops see the effects of earlier ops. */
export type ChangeOp =
    | { op: 'addNode'; node: WorkflowNode }
    | { op: 'updateNode'; id: string; patch?: { name?: string; config?: Record<string, unknown> }; unset?: string[] }
    | { op: 'renameNode'; id: string; newId: string }
    | { op: 'removeNode'; id: string }
    | { op: 'addEdge'; edge: WorkflowEdge }
    | { op: 'updateEdge'; id: string; patch?: Partial<Omit<WorkflowEdge, 'id'>>; unset?: string[] }
    | { op: 'removeEdge'; id: string }
    | { op: 'metadata'; patch: Partial<Pick<Workflow, 'name' | 'description' | 'version'>> };

/** An atomic, reviewable set of edits based on a specific content revision. */
export interface ChangeSet {
    id: string;
    /** The `contentRevision` the author based these ops on. */
    baseRevision: string;
    author: `agent:${string}` | 'host';
    summary: string;
    ops: ChangeOp[];
}

/** Stable, machine-readable failure codes shared with the Java engine. */
export type ChangeSetErrorCode =
    | 'target-missing' | 'duplicate-id' | 'edge-endpoint-missing' | 'malformed' | 'read-only' | 'stale';

/** Why a change set was rejected. `opIndex` is absent for whole-set failures such as `stale`. */
export interface ChangeSetError {
    code: ChangeSetErrorCode;
    opIndex?: number;
    reason: string;
}

/** Outcome of applying a change set to a workflow. */
export type ChangeSetResult = { ok: true; workflow: Workflow } | { ok: false; error: ChangeSetError };

/** How a staged proposal was resolved. */
export type ProposalOutcome = 'accepted' | 'rejected' | 'stale' | 'withdrawn';

/** The single proposal currently under review. */
export interface StagedProposal {
    changeSet: ChangeSet;
    /** The workflow as it would be after accepting. */
    preview: Workflow;
    stale: boolean;
}

/** A proposal resolution waiting to be published to the host. */
export interface ProposalEvent {
    seq: number;
    id: string;
    outcome: ProposalOutcome;
}

/** Elements added or modified by the most recently applied change set. */
export interface Highlight {
    nodeIds: string[];
    edgeIds: string[];
}
```

- [ ] **Step 2: Create `conformance/changesets.json` (copy it exactly)**

`"@current"` as a `baseRevision` means "replace this with the input workflow's computed revision". Every
fixture runs through the checked path. Expected workflows are compared with layout stripped.

```json
{
  "workflows": {
    "base": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "a", "type": "action", "name": "Call", "config": {"actionType": "http", "inputs": {"url": "context.url", "method": "GET"}, "timeout": "PT5S"}}, {"id": "e", "type": "end", "name": "End", "config": {}}], "edges": [{"id": "sa", "source": "s", "target": "a", "priority": 0, "isDefault": false}, {"id": "ae", "source": "a", "target": "e", "priority": 0, "isDefault": false}]}
  },
  "cases": [
    {"name": "insert wait between action and end", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "removeEdge", "id": "ae"}, {"op": "addNode", "node": {"id": "w", "type": "wait", "name": "Pause", "config": {"duration": "PT1M"}}}, {"op": "addEdge", "edge": {"id": "aw", "source": "a", "target": "w", "priority": 0, "isDefault": false}}, {"op": "addEdge", "edge": {"id": "we", "source": "w", "target": "e", "priority": 0, "isDefault": false}}]}, "expected": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "a", "type": "action", "name": "Call", "config": {"actionType": "http", "inputs": {"url": "context.url", "method": "GET"}, "timeout": "PT5S"}}, {"id": "e", "type": "end", "name": "End", "config": {}}, {"id": "w", "type": "wait", "name": "Pause", "config": {"duration": "PT1M"}}], "edges": [{"id": "sa", "source": "s", "target": "a", "priority": 0, "isDefault": false}, {"id": "aw", "source": "a", "target": "w", "priority": 0, "isDefault": false}, {"id": "we", "source": "w", "target": "e", "priority": 0, "isDefault": false}]}},
    {"name": "updateNode merges config shallowly and renames label", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "updateNode", "id": "a", "patch": {"name": "Call API", "config": {"actionType": "https"}}}]}, "expected": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "a", "type": "action", "name": "Call API", "config": {"actionType": "https", "inputs": {"url": "context.url", "method": "GET"}, "timeout": "PT5S"}}, {"id": "e", "type": "end", "name": "End", "config": {}}], "edges": [{"id": "sa", "source": "s", "target": "a", "priority": 0, "isDefault": false}, {"id": "ae", "source": "a", "target": "e", "priority": 0, "isDefault": false}]}},
    {"name": "updateNode unset removes a config key", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "updateNode", "id": "a", "patch": {}, "unset": ["timeout"]}]}, "expected": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "a", "type": "action", "name": "Call", "config": {"actionType": "http", "inputs": {"url": "context.url", "method": "GET"}}}, {"id": "e", "type": "end", "name": "End", "config": {}}], "edges": [{"id": "sa", "source": "s", "target": "a", "priority": 0, "isDefault": false}, {"id": "ae", "source": "a", "target": "e", "priority": 0, "isDefault": false}]}},
    {"name": "nested mapping is replaced whole", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "updateNode", "id": "a", "patch": {"config": {"inputs": {"url": "context.url"}}}}]}, "expected": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "a", "type": "action", "name": "Call", "config": {"actionType": "http", "inputs": {"url": "context.url"}, "timeout": "PT5S"}}, {"id": "e", "type": "end", "name": "End", "config": {}}], "edges": [{"id": "sa", "source": "s", "target": "a", "priority": 0, "isDefault": false}, {"id": "ae", "source": "a", "target": "e", "priority": 0, "isDefault": false}]}},
    {"name": "null in patch is stored as a value", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "updateNode", "id": "a", "patch": {"config": {"timeout": null}}}]}, "expected": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "a", "type": "action", "name": "Call", "config": {"actionType": "http", "inputs": {"url": "context.url", "method": "GET"}, "timeout": null}}, {"id": "e", "type": "end", "name": "End", "config": {}}], "edges": [{"id": "sa", "source": "s", "target": "a", "priority": 0, "isDefault": false}, {"id": "ae", "source": "a", "target": "e", "priority": 0, "isDefault": false}]}},
    {"name": "renameNode rewrites attached edges", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "renameNode", "id": "a", "newId": "call"}]}, "expected": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "call", "type": "action", "name": "Call", "config": {"actionType": "http", "inputs": {"url": "context.url", "method": "GET"}, "timeout": "PT5S"}}, {"id": "e", "type": "end", "name": "End", "config": {}}], "edges": [{"id": "sa", "source": "s", "target": "call", "priority": 0, "isDefault": false}, {"id": "ae", "source": "call", "target": "e", "priority": 0, "isDefault": false}]}},
    {"name": "renameNode to the same id is a no-op", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "renameNode", "id": "a", "newId": "a"}]}, "expected": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "a", "type": "action", "name": "Call", "config": {"actionType": "http", "inputs": {"url": "context.url", "method": "GET"}, "timeout": "PT5S"}}, {"id": "e", "type": "end", "name": "End", "config": {}}], "edges": [{"id": "sa", "source": "s", "target": "a", "priority": 0, "isDefault": false}, {"id": "ae", "source": "a", "target": "e", "priority": 0, "isDefault": false}]}},
    {"name": "removeNode cascades attached edges", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "removeNode", "id": "a"}]}, "expected": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "e", "type": "end", "name": "End", "config": {}}], "edges": []}},
    {"name": "ops apply in order and updateEdge unset removes a field", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "updateEdge", "id": "ae", "patch": {"condition": "true", "label": "yes"}}, {"op": "updateEdge", "id": "ae", "unset": ["condition"], "patch": {}}]}, "expected": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "a", "type": "action", "name": "Call", "config": {"actionType": "http", "inputs": {"url": "context.url", "method": "GET"}, "timeout": "PT5S"}}, {"id": "e", "type": "end", "name": "End", "config": {}}], "edges": [{"id": "sa", "source": "s", "target": "a", "priority": 0, "isDefault": false}, {"id": "ae", "source": "a", "target": "e", "priority": 0, "isDefault": false, "label": "yes"}]}},
    {"name": "metadata patch", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "metadata", "patch": {"name": "Orders v2", "description": "Handles orders", "version": 2}}]}, "expected": {"id": "orders", "name": "Orders v2", "version": 2, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "a", "type": "action", "name": "Call", "config": {"actionType": "http", "inputs": {"url": "context.url", "method": "GET"}, "timeout": "PT5S"}}, {"id": "e", "type": "end", "name": "End", "config": {}}], "edges": [{"id": "sa", "source": "s", "target": "a", "priority": 0, "isDefault": false}, {"id": "ae", "source": "a", "target": "e", "priority": 0, "isDefault": false}], "description": "Handles orders"}},
    {"name": "later ops see earlier ops", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "addNode", "node": {"id": "x", "type": "end", "name": "Alt", "config": {}}}, {"op": "renameNode", "id": "x", "newId": "y"}, {"op": "addEdge", "edge": {"id": "sy", "source": "s", "target": "y", "priority": 1, "isDefault": false}}]}, "expected": {"id": "orders", "name": "Orders", "version": 1, "nodes": [{"id": "s", "type": "start", "name": "Start", "config": {}}, {"id": "a", "type": "action", "name": "Call", "config": {"actionType": "http", "inputs": {"url": "context.url", "method": "GET"}, "timeout": "PT5S"}}, {"id": "e", "type": "end", "name": "End", "config": {}}, {"id": "y", "type": "end", "name": "Alt", "config": {}}], "edges": [{"id": "sa", "source": "s", "target": "a", "priority": 0, "isDefault": false}, {"id": "ae", "source": "a", "target": "e", "priority": 0, "isDefault": false}, {"id": "sy", "source": "s", "target": "y", "priority": 1, "isDefault": false}]}},
    {"name": "updateNode on a missing node", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "updateNode", "id": "nope", "patch": {"name": "X"}}]}, "error": {"code": "target-missing", "opIndex": 0}},
    {"name": "removeEdge on a missing edge", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "removeEdge", "id": "nope"}]}, "error": {"code": "target-missing", "opIndex": 0}},
    {"name": "addNode with an existing id", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "addNode", "node": {"id": "a", "type": "end", "name": "Dup", "config": {}}}]}, "error": {"code": "duplicate-id", "opIndex": 0}},
    {"name": "renameNode onto an existing id", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "renameNode", "id": "a", "newId": "e"}]}, "error": {"code": "duplicate-id", "opIndex": 0}},
    {"name": "addEdge to a missing node is atomic", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "removeEdge", "id": "ae"}, {"op": "addEdge", "edge": {"id": "ag", "source": "a", "target": "ghost", "priority": 0, "isDefault": false}}]}, "error": {"code": "edge-endpoint-missing", "opIndex": 1}},
    {"name": "updateEdge retargets to a missing node", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "updateEdge", "id": "ae", "patch": {"target": "ghost"}}]}, "error": {"code": "edge-endpoint-missing", "opIndex": 0}},
    {"name": "unknown op", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "explode", "id": "a"}]}, "error": {"code": "malformed", "opIndex": 0}},
    {"name": "key in both patch and unset", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "updateNode", "id": "a", "patch": {"config": {"timeout": "PT1S"}}, "unset": ["timeout"]}]}, "error": {"code": "malformed", "opIndex": 0}},
    {"name": "addNode with an unknown node type", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "addNode", "node": {"id": "r", "type": "robot", "name": "R", "config": {}}}]}, "error": {"code": "malformed", "opIndex": 0}},
    {"name": "updateEdge patch may not change id", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "updateEdge", "id": "ae", "patch": {"id": "zz"}}]}, "error": {"code": "malformed", "opIndex": 0}},
    {"name": "updateEdge may not unset a required field", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "updateEdge", "id": "ae", "patch": {}, "unset": ["priority"]}]}, "error": {"code": "malformed", "opIndex": 0}},
    {"name": "metadata patch may not change id", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "@current", "author": "agent:test", "summary": "t", "ops": [{"op": "metadata", "patch": {"id": "other"}}]}, "error": {"code": "malformed", "opIndex": 0}},
    {"name": "stale base revision", "workflow": "base", "changeSet": {"id": "cs", "baseRevision": "sha256:0000000000000000000000000000000000000000000000000000000000000000", "author": "agent:test", "summary": "t", "ops": [{"op": "removeEdge", "id": "ae"}]}, "error": {"code": "stale"}}
  ]
}
```

- [ ] **Step 3: Write the failing conformance test `ui/src/changeset/changesets.conformance.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import fixtures from '../../../conformance/changesets.json';
import { applyChangeSetChecked } from './applyChangeSet.ts';
import { computeContentRevision, stripLayout } from './contentRevision.ts';
import type { ChangeSet } from './types.ts';
import type { Workflow } from '../types/workflow.ts';

interface Case {
    name: string;
    workflow: string;
    changeSet: ChangeSet;
    expected?: Workflow;
    error?: { code: string; opIndex?: number };
}

const workflows = fixtures.workflows as unknown as Record<string, Workflow>;

describe('shared change-set vectors', () => {
    for (const fixture of fixtures.cases as unknown as Case[]) {
        it(fixture.name, () => {
            const input = structuredClone(workflows[fixture.workflow]);
            const changeSet = { ...fixture.changeSet, baseRevision: fixture.changeSet.baseRevision === '@current'
                ? computeContentRevision(input) : fixture.changeSet.baseRevision };
            const result = applyChangeSetChecked(input, changeSet);
            if (fixture.expected) {
                expect(result.ok, JSON.stringify(result)).toBe(true);
                if (result.ok) expect(stripLayout(result.workflow)).toEqual(fixture.expected);
            } else {
                expect(result.ok).toBe(false);
                if (!result.ok) {
                    expect(result.error.code).toBe(fixture.error!.code);
                    expect(result.error.opIndex).toBe(fixture.error!.opIndex);
                }
            }
        });
    }
});
```

- [ ] **Step 4: Write the failing unit tests `ui/src/changeset/applyChangeSet.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { applyChangeSet, applyChangeSetChecked } from './applyChangeSet.ts';
import { computeContentRevision } from './contentRevision.ts';
import type { ChangeSet } from './types.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow = (): Workflow => ({ id: 'w', name: 'W',
    nodes: [{ id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } }], edges: [] });
const changeSet = (ops: ChangeSet['ops'], baseRevision = ''): ChangeSet =>
    ({ id: 'cs', baseRevision, author: 'agent:test', summary: 'test', ops });

describe('applyChangeSet', () => {
    it('does not mutate its input', () => {
        const input = workflow();
        applyChangeSet(input, changeSet([{ op: 'removeNode', id: 's' }]));
        expect(input.nodes).toHaveLength(1);
    });

    it('places added nodes next to positioned neighbours', () => {
        const result = applyChangeSet(workflow(), changeSet([
            { op: 'addNode', node: { id: 'e', type: 'end', name: 'E', config: {} } },
            { op: 'addEdge', edge: { id: 'se', source: 's', target: 'e', priority: 0, isDefault: false } },
        ]));
        expect(result.ok && result.workflow.nodes[1].position).toEqual({ x: 120 + 90, y: 0 });
    });

    it('rejects a change set without ops as malformed with no opIndex', () => {
        const result = applyChangeSet(workflow(), { id: 'x' } as unknown as ChangeSet);
        expect(result).toEqual({ ok: false, error: { code: 'malformed', reason: expect.any(String) } });
    });

    it('reports a human-readable reason', () => {
        const result = applyChangeSet(workflow(), changeSet([{ op: 'removeNode', id: 'nope' }]));
        expect(!result.ok && result.error.reason).toContain('nope');
    });
});

describe('applyChangeSetChecked', () => {
    it('applies when the base revision matches and rejects as stale otherwise', () => {
        const input = workflow();
        const ops: ChangeSet['ops'] = [{ op: 'metadata', patch: { name: 'Renamed' } }];
        expect(applyChangeSetChecked(input, changeSet(ops, computeContentRevision(input))).ok).toBe(true);
        const stale = applyChangeSetChecked(input, changeSet(ops, 'sha256:old'));
        expect(!stale.ok && stale.error.code).toBe('stale');
        expect(!stale.ok && stale.error.opIndex).toBeUndefined();
    });
});
```

- [ ] **Step 5: Run the tests and confirm they fail**

Run: `npx vitest run src/changeset/`

Expected: FAIL, because `./applyChangeSet.ts` cannot be resolved.

- [ ] **Step 6: Implement `ui/src/changeset/applyChangeSet.ts`**

Checks inside each op run in exactly the order written here. The Java port (Task 5) uses the same order.

```ts
import type { Workflow, WorkflowEdge, WorkflowNode } from '../types/workflow.ts';
import { placeNewNodes } from '../layout/layoutWorkflow.ts';
import { computeContentRevision } from './contentRevision.ts';
import type { ChangeSet, ChangeSetErrorCode, ChangeSetResult } from './types.ts';

const NODE_TYPES = new Set(['start', 'end', 'action', 'human-task', 'receive-event', 'wait']);
const REQUIRED_EDGE_FIELDS = ['id', 'source', 'target', 'priority', 'isDefault'];
const METADATA_KEYS = new Set(['name', 'description', 'version']);

class OpFailure extends Error {
    constructor(readonly code: ChangeSetErrorCode, reason: string) {
        super(reason);
    }
}

function fail(code: ChangeSetErrorCode, reason: string): never {
    throw new OpFailure(code, reason);
}

type JsonRecord = Record<string, unknown>;
const isObject = (value: unknown): value is JsonRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function requireObject(value: unknown, label: string): JsonRecord {
    return isObject(value) ? value : fail('malformed', `${label} must be an object`);
}

function requireString(op: JsonRecord, key: string): string {
    const value = op[key];
    return isString(value) ? value : fail('malformed', `"${key}" must be a non-empty string`);
}

function optionalPatch(op: JsonRecord): JsonRecord {
    return op.patch === undefined ? {} : requireObject(op.patch, '"patch"');
}

function unsetList(op: JsonRecord): string[] {
    if (op.unset === undefined) return [];
    if (!Array.isArray(op.unset) || !op.unset.every(isString)) fail('malformed', '"unset" must be an array of strings');
    return op.unset as string[];
}

function findNode(draft: Workflow, id: string): WorkflowNode | undefined {
    return draft.nodes.find(node => node.id === id);
}

function requireEndpoints(draft: Workflow, source: string, target: string): void {
    for (const id of [source, target]) {
        if (!findNode(draft, id)) fail('edge-endpoint-missing', `Edge endpoint "${id}" does not exist`);
    }
}

function applyOp(draft: Workflow, raw: unknown): void {
    const op = requireObject(raw, 'Each op');
    switch (op.op) {
        case 'addNode': {
            const node = requireObject(op.node, '"node"');
            if (!isString(node.id) || typeof node.type !== 'string' || !NODE_TYPES.has(node.type)
                || !isString(node.name) || !isObject(node.config)) {
                fail('malformed', 'addNode requires a node with id, a known type, name and an object config');
            }
            if (findNode(draft, node.id as string)) fail('duplicate-id', `Node "${node.id}" already exists`);
            draft.nodes.push(structuredClone(node) as unknown as WorkflowNode);
            return;
        }
        case 'updateNode': {
            const id = requireString(op, 'id');
            const patch = optionalPatch(op);
            const unset = unsetList(op);
            const extra = Object.keys(patch).find(key => key !== 'name' && key !== 'config');
            if (extra) fail('malformed', `updateNode patch may only contain "name" and "config", not "${extra}"`);
            if (patch.name !== undefined && !isString(patch.name)) fail('malformed', '"patch.name" must be a non-empty string');
            const config = patch.config === undefined ? {} : requireObject(patch.config, '"patch.config"');
            const both = unset.find(key => key in config);
            if (both) fail('malformed', `"${both}" appears in both patch.config and unset`);
            const node = findNode(draft, id) ?? fail('target-missing', `Node "${id}" does not exist`);
            if (patch.name !== undefined) node.name = patch.name as string;
            const merged: JsonRecord = { ...node.config, ...structuredClone(config) };
            for (const key of unset) delete merged[key];
            node.config = merged as WorkflowNode['config'];
            return;
        }
        case 'renameNode': {
            const id = requireString(op, 'id');
            const newId = requireString(op, 'newId');
            const node = findNode(draft, id) ?? fail('target-missing', `Node "${id}" does not exist`);
            if (newId === id) return;
            if (findNode(draft, newId)) fail('duplicate-id', `Node "${newId}" already exists`);
            node.id = newId;
            for (const edge of draft.edges) {
                if (edge.source === id) edge.source = newId;
                if (edge.target === id) edge.target = newId;
            }
            return;
        }
        case 'removeNode': {
            const id = requireString(op, 'id');
            if (!findNode(draft, id)) fail('target-missing', `Node "${id}" does not exist`);
            draft.nodes = draft.nodes.filter(node => node.id !== id);
            draft.edges = draft.edges.filter(edge => edge.source !== id && edge.target !== id);
            return;
        }
        case 'addEdge': {
            const edge = requireObject(op.edge, '"edge"');
            if (!isString(edge.id) || !isString(edge.source) || !isString(edge.target)
                || typeof edge.priority !== 'number' || typeof edge.isDefault !== 'boolean') {
                fail('malformed', 'addEdge requires id, source, target, a numeric priority and a boolean isDefault');
            }
            if (draft.edges.some(existing => existing.id === edge.id)) fail('duplicate-id', `Edge "${edge.id}" already exists`);
            requireEndpoints(draft, edge.source as string, edge.target as string);
            draft.edges.push(structuredClone(edge) as unknown as WorkflowEdge);
            return;
        }
        case 'updateEdge': {
            const id = requireString(op, 'id');
            const patch = optionalPatch(op);
            const unset = unsetList(op);
            if ('id' in patch) fail('malformed', 'updateEdge patch may not change "id"');
            const required = unset.find(key => REQUIRED_EDGE_FIELDS.includes(key));
            if (required) fail('malformed', `"${required}" is required and cannot be unset`);
            const both = unset.find(key => key in patch);
            if (both) fail('malformed', `"${both}" appears in both patch and unset`);
            if (('source' in patch && !isString(patch.source)) || ('target' in patch && !isString(patch.target))
                || ('priority' in patch && typeof patch.priority !== 'number')
                || ('isDefault' in patch && typeof patch.isDefault !== 'boolean')) {
                fail('malformed', 'updateEdge patch has a field of the wrong type');
            }
            const index = draft.edges.findIndex(edge => edge.id === id);
            if (index < 0) fail('target-missing', `Edge "${id}" does not exist`);
            const merged: JsonRecord = { ...draft.edges[index], ...structuredClone(patch) };
            for (const key of unset) delete merged[key];
            requireEndpoints(draft, merged.source as string, merged.target as string);
            draft.edges[index] = merged as unknown as WorkflowEdge;
            return;
        }
        case 'metadata': {
            const patch = requireObject(op.patch, '"patch"');
            const extra = Object.keys(patch).find(key => !METADATA_KEYS.has(key));
            if (extra) fail('malformed', `metadata patch may only contain name, description and version, not "${extra}"`);
            if (('name' in patch && !isString(patch.name)) || ('description' in patch && typeof patch.description !== 'string')
                || ('version' in patch && typeof patch.version !== 'number')) {
                fail('malformed', 'metadata patch has a field of the wrong type');
            }
            Object.assign(draft, structuredClone(patch));
            return;
        }
        default:
            fail('malformed', `Unknown op "${String(op.op)}"`);
    }
}

/**
 * Applies every op of a change set atomically. Positionless added nodes are placed with `placeNewNodes`.
 * Does not check `baseRevision`; see {@link applyChangeSetChecked}.
 *
 * @param workflow the workflow to change; never mutated
 * @param changeSet the change set to apply
 * @returns the changed workflow, or the first failure with its op index
 */
export function applyChangeSet(workflow: Workflow, changeSet: ChangeSet): ChangeSetResult {
    if (!isObject(changeSet) || !Array.isArray(changeSet.ops)) {
        return { ok: false, error: { code: 'malformed', reason: 'A change set must have an "ops" array' } };
    }
    const draft = structuredClone(workflow);
    for (const [opIndex, op] of changeSet.ops.entries()) {
        try {
            applyOp(draft, op);
        } catch (error) {
            if (error instanceof OpFailure) return { ok: false, error: { code: error.code, opIndex, reason: error.message } };
            throw error;
        }
    }
    return { ok: true, workflow: placeNewNodes(draft) };
}

/**
 * Applies a change set only if its `baseRevision` equals the workflow's current content revision.
 *
 * @param workflow the workflow to change; never mutated
 * @param changeSet the change set to apply
 * @param currentRevision the workflow's revision when already known (avoids rehashing)
 * @returns the result, or a `stale` error without `opIndex`
 */
export function applyChangeSetChecked(workflow: Workflow, changeSet: ChangeSet,
    currentRevision: string = computeContentRevision(workflow)): ChangeSetResult {
    if (isObject(changeSet) && changeSet.baseRevision !== currentRevision) {
        return { ok: false, error: { code: 'stale',
            reason: `Change set is based on ${String(changeSet.baseRevision)} but the workflow is at ${currentRevision}` } };
    }
    return applyChangeSet(workflow, changeSet);
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run src/changeset/ && npx tsc --noEmit && npm run lint`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ui/src/changeset conformance/changesets.json
git commit -m "Add atomic change-set application with shared conformance fixtures"
```

---

### Task 5: `ChangeSets` (Java)

**Files:**
- Create:
  - `engine/src/main/java/io/apitomy/flow/changeset/ChangeSetError.java`
  - `engine/src/main/java/io/apitomy/flow/changeset/ChangeSetResult.java`
  - `engine/src/main/java/io/apitomy/flow/changeset/ChangeSets.java`
  - `engine/src/test/java/io/apitomy/flow/changeset/ChangeSetConformanceTest.java`

**Interfaces:**
- Consumes:
  - `ContentRevision.of(JsonNode)` and `ContentRevision.stripLayout(JsonNode)` (Task 2)
  - `conformance/changesets.json` (Task 4)
- Produces:
  - `ChangeSets.apply(JsonNode workflow, JsonNode changeSet): ChangeSetResult`
  - `ChangeSets.applyChecked(JsonNode workflow, JsonNode changeSet): ChangeSetResult`
  - `ChangeSetResult.Applied(ObjectNode workflow)` and `ChangeSetResult.Rejected(ChangeSetError error)`
  - `ChangeSetError(String code, Integer opIndex, String reason)`

The Java side operates on Jackson trees rather than model records. That way host extension keys and
`null` values round-trip exactly as they do in the editor. Java does not place nodes.

- [ ] **Step 1: Write the failing test `ChangeSetConformanceTest.java`**

```java
package io.apitomy.flow.changeset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Runs the shared change-set vectors against {@link ChangeSets}. */
class ChangeSetConformanceTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static JsonNode fixtures;

    record Case(String name, JsonNode data) {
        @Override
        public String toString() {
            return name;
        }
    }

    static Stream<Case> cases() throws Exception {
        fixtures = MAPPER.readTree(Path.of("../conformance/changesets.json").toFile());
        List<Case> cases = new ArrayList<>();
        fixtures.path("cases").forEach(data -> cases.add(new Case(data.path("name").asText(), data)));
        return cases.stream();
    }

    @ParameterizedTest
    @MethodSource("cases")
    void matchesSharedVector(Case fixture) {
        JsonNode input = fixtures.path("workflows").path(fixture.data().path("workflow").asText());
        ObjectNode changeSet = (ObjectNode) fixture.data().path("changeSet").deepCopy();
        if ("@current".equals(changeSet.path("baseRevision").asText())) {
            changeSet.put("baseRevision", ContentRevision.of(input));
        }
        ChangeSetResult result = ChangeSets.applyChecked(input, changeSet);
        JsonNode expected = fixture.data().path("expected");
        if (!expected.isMissingNode()) {
            ChangeSetResult.Applied applied = assertInstanceOf(ChangeSetResult.Applied.class, result, result::toString);
            assertEquals(ContentRevision.stripLayout(expected), ContentRevision.stripLayout(applied.workflow()));
        } else {
            ChangeSetResult.Rejected rejected = assertInstanceOf(ChangeSetResult.Rejected.class, result);
            JsonNode error = fixture.data().path("error");
            assertEquals(error.path("code").asText(), rejected.error().code());
            assertEquals(error.has("opIndex") ? error.path("opIndex").asInt() : null, rejected.error().opIndex());
        }
    }

    @Test
    void doesNotMutateInput() throws Exception {
        JsonNode input = MAPPER.readTree("{\"id\":\"w\",\"name\":\"W\",\"nodes\":[{\"id\":\"s\",\"type\":\"start\","
            + "\"name\":\"S\",\"config\":{}}],\"edges\":[]}");
        JsonNode before = input.deepCopy();
        ChangeSets.apply(input, MAPPER.readTree("{\"ops\":[{\"op\":\"removeNode\",\"id\":\"s\"}]}"));
        assertEquals(before, input);
    }
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `./mvnw -q test -Dtest=ChangeSetConformanceTest`

Expected: a compilation failure.

- [ ] **Step 3: Implement `ChangeSetError.java` and `ChangeSetResult.java`**

```java
package io.apitomy.flow.changeset;

/**
 * Why a change set was rejected.
 *
 * @param code one of {@code target-missing}, {@code duplicate-id}, {@code edge-endpoint-missing},
 *             {@code malformed}, {@code read-only}, {@code stale}
 * @param opIndex index of the failing op, or {@code null} for whole-set failures
 * @param reason human-readable explanation
 */
public record ChangeSetError(String code, Integer opIndex, String reason) {
}
```

```java
package io.apitomy.flow.changeset;

import com.fasterxml.jackson.databind.node.ObjectNode;

/** Outcome of applying a change set. */
public sealed interface ChangeSetResult permits ChangeSetResult.Applied, ChangeSetResult.Rejected {

    /**
     * The change set applied cleanly.
     *
     * @param workflow the resulting workflow document
     */
    record Applied(ObjectNode workflow) implements ChangeSetResult {
    }

    /**
     * The change set was rejected and nothing changed.
     *
     * @param error the failure
     */
    record Rejected(ChangeSetError error) implements ChangeSetResult {
    }
}
```

- [ ] **Step 4: Implement `ChangeSets.java`**

The validation order must match `applyChangeSet.ts` (Task 4, Step 6) exactly.

```java
package io.apitomy.flow.changeset;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/**
 * Applies editor change sets to workflow JSON documents with the same semantics and error codes as
 * {@code applyChangeSet} in {@code @apitomy/flow-ui}. Nodes are not positioned.
 */
public final class ChangeSets {

    private static final Set<String> NODE_TYPES =
        Set.of("start", "end", "action", "human-task", "receive-event", "wait");
    private static final List<String> REQUIRED_EDGE_FIELDS = List.of("id", "source", "target", "priority", "isDefault");
    private static final Set<String> METADATA_KEYS = Set.of("name", "description", "version");

    private ChangeSets() {
    }

    /**
     * Applies every op atomically without checking {@code baseRevision}.
     *
     * @param workflow the workflow JSON object; never mutated
     * @param changeSet the change set JSON object
     * @return {@link ChangeSetResult.Applied} or {@link ChangeSetResult.Rejected}
     */
    public static ChangeSetResult apply(JsonNode workflow, JsonNode changeSet) {
        if (workflow == null || !workflow.isObject()) {
            throw new IllegalArgumentException("workflow must be a JSON object");
        }
        JsonNode ops = changeSet == null ? null : changeSet.get("ops");
        if (ops == null || !ops.isArray()) {
            return new ChangeSetResult.Rejected(new ChangeSetError("malformed", null, "A change set must have an \"ops\" array"));
        }
        ObjectNode draft = (ObjectNode) workflow.deepCopy();
        for (int i = 0; i < ops.size(); i++) {
            try {
                applyOp(draft, ops.get(i));
            } catch (OpFailure failure) {
                return new ChangeSetResult.Rejected(new ChangeSetError(failure.code, i, failure.getMessage()));
            }
        }
        return new ChangeSetResult.Applied(draft);
    }

    /**
     * Applies the change set only if its {@code baseRevision} equals {@link ContentRevision#of(JsonNode)}.
     *
     * @param workflow the workflow JSON object; never mutated
     * @param changeSet the change set JSON object
     * @return the result, or a {@code stale} rejection without op index
     */
    public static ChangeSetResult applyChecked(JsonNode workflow, JsonNode changeSet) {
        String current = ContentRevision.of(workflow);
        String base = changeSet == null ? null : changeSet.path("baseRevision").asText(null);
        if (!current.equals(base)) {
            return new ChangeSetResult.Rejected(new ChangeSetError("stale", null,
                "Change set is based on " + base + " but the workflow is at " + current));
        }
        return apply(workflow, changeSet);
    }

    private static final class OpFailure extends RuntimeException {
        private final String code;

        OpFailure(String code, String reason) {
            super(reason, null, false, false);
            this.code = code;
        }
    }

    private static OpFailure fail(String code, String reason) {
        return new OpFailure(code, reason);
    }

    private static boolean isString(JsonNode node) {
        return node != null && node.isTextual() && !node.asText().isEmpty();
    }

    private static ObjectNode requireObject(JsonNode node, String label) {
        if (node == null || !node.isObject()) {
            throw fail("malformed", label + " must be an object");
        }
        return (ObjectNode) node;
    }

    private static String requireString(JsonNode op, String key) {
        JsonNode value = op.get(key);
        if (!isString(value)) {
            throw fail("malformed", "\"" + key + "\" must be a non-empty string");
        }
        return value.asText();
    }

    private static ObjectNode optionalPatch(ObjectNode op) {
        return op.has("patch") ? requireObject(op.get("patch"), "\"patch\"") : op.objectNode();
    }

    private static List<String> unsetList(ObjectNode op) {
        List<String> keys = new ArrayList<>();
        if (!op.has("unset")) {
            return keys;
        }
        JsonNode unset = op.get("unset");
        if (!unset.isArray()) {
            throw fail("malformed", "\"unset\" must be an array of strings");
        }
        for (JsonNode key : unset) {
            if (!isString(key)) {
                throw fail("malformed", "\"unset\" must be an array of strings");
            }
            keys.add(key.asText());
        }
        return keys;
    }

    private static ArrayNode nodes(ObjectNode draft) {
        return (ArrayNode) draft.get("nodes");
    }

    private static ArrayNode edges(ObjectNode draft) {
        return (ArrayNode) draft.get("edges");
    }

    private static ObjectNode findById(ArrayNode items, String id) {
        for (JsonNode item : items) {
            if (id.equals(item.path("id").asText(null))) {
                return (ObjectNode) item;
            }
        }
        return null;
    }

    private static void requireEndpoints(ObjectNode draft, String source, String target) {
        for (String id : List.of(source, target)) {
            if (findById(nodes(draft), id) == null) {
                throw fail("edge-endpoint-missing", "Edge endpoint \"" + id + "\" does not exist");
            }
        }
    }

    private static void removeById(ArrayNode items, String id) {
        for (Iterator<JsonNode> it = items.iterator(); it.hasNext();) {
            if (id.equals(it.next().path("id").asText(null))) {
                it.remove();
            }
        }
    }

    private static void applyOp(ObjectNode draft, JsonNode raw) {
        ObjectNode op = requireObject(raw, "Each op");
        String kind = op.path("op").asText("");
        switch (kind) {
            case "addNode" -> addNode(draft, op);
            case "updateNode" -> updateNode(draft, op);
            case "renameNode" -> renameNode(draft, op);
            case "removeNode" -> removeNode(draft, op);
            case "addEdge" -> addEdge(draft, op);
            case "updateEdge" -> updateEdge(draft, op);
            case "removeEdge" -> {
                String id = requireString(op, "id");
                if (findById(edges(draft), id) == null) {
                    throw fail("target-missing", "Edge \"" + id + "\" does not exist");
                }
                removeById(edges(draft), id);
            }
            case "metadata" -> metadata(draft, op);
            default -> throw fail("malformed", "Unknown op \"" + kind + "\"");
        }
    }

    private static void addNode(ObjectNode draft, ObjectNode op) {
        ObjectNode node = requireObject(op.get("node"), "\"node\"");
        if (!isString(node.get("id")) || !node.path("type").isTextual() || !NODE_TYPES.contains(node.path("type").asText())
            || !isString(node.get("name")) || !node.path("config").isObject()) {
            throw fail("malformed", "addNode requires a node with id, a known type, name and an object config");
        }
        if (findById(nodes(draft), node.get("id").asText()) != null) {
            throw fail("duplicate-id", "Node \"" + node.get("id").asText() + "\" already exists");
        }
        nodes(draft).add(node.deepCopy());
    }

    private static void updateNode(ObjectNode draft, ObjectNode op) {
        String id = requireString(op, "id");
        ObjectNode patch = optionalPatch(op);
        List<String> unset = unsetList(op);
        for (Iterator<String> it = patch.fieldNames(); it.hasNext();) {
            String key = it.next();
            if (!key.equals("name") && !key.equals("config")) {
                throw fail("malformed", "updateNode patch may only contain \"name\" and \"config\", not \"" + key + "\"");
            }
        }
        if (patch.has("name") && !isString(patch.get("name"))) {
            throw fail("malformed", "\"patch.name\" must be a non-empty string");
        }
        ObjectNode config = patch.has("config") ? requireObject(patch.get("config"), "\"patch.config\"") : patch.objectNode();
        for (String key : unset) {
            if (config.has(key)) {
                throw fail("malformed", "\"" + key + "\" appears in both patch.config and unset");
            }
        }
        ObjectNode node = findById(nodes(draft), id);
        if (node == null) {
            throw fail("target-missing", "Node \"" + id + "\" does not exist");
        }
        if (patch.has("name")) {
            node.set("name", patch.get("name").deepCopy());
        }
        ObjectNode merged = node.path("config").isObject() ? (ObjectNode) node.get("config").deepCopy() : node.objectNode();
        merged.setAll(config.deepCopy());
        unset.forEach(merged::remove);
        node.set("config", merged);
    }

    private static void renameNode(ObjectNode draft, ObjectNode op) {
        String id = requireString(op, "id");
        String newId = requireString(op, "newId");
        ObjectNode node = findById(nodes(draft), id);
        if (node == null) {
            throw fail("target-missing", "Node \"" + id + "\" does not exist");
        }
        if (newId.equals(id)) {
            return;
        }
        if (findById(nodes(draft), newId) != null) {
            throw fail("duplicate-id", "Node \"" + newId + "\" already exists");
        }
        node.put("id", newId);
        for (JsonNode edge : edges(draft)) {
            ObjectNode e = (ObjectNode) edge;
            if (id.equals(e.path("source").asText(null))) {
                e.put("source", newId);
            }
            if (id.equals(e.path("target").asText(null))) {
                e.put("target", newId);
            }
        }
    }

    private static void removeNode(ObjectNode draft, ObjectNode op) {
        String id = requireString(op, "id");
        if (findById(nodes(draft), id) == null) {
            throw fail("target-missing", "Node \"" + id + "\" does not exist");
        }
        removeById(nodes(draft), id);
        for (Iterator<JsonNode> it = edges(draft).iterator(); it.hasNext();) {
            JsonNode edge = it.next();
            if (id.equals(edge.path("source").asText(null)) || id.equals(edge.path("target").asText(null))) {
                it.remove();
            }
        }
    }

    private static void addEdge(ObjectNode draft, ObjectNode op) {
        ObjectNode edge = requireObject(op.get("edge"), "\"edge\"");
        if (!isString(edge.get("id")) || !isString(edge.get("source")) || !isString(edge.get("target"))
            || !edge.path("priority").isNumber() || !edge.path("isDefault").isBoolean()) {
            throw fail("malformed", "addEdge requires id, source, target, a numeric priority and a boolean isDefault");
        }
        if (findById(edges(draft), edge.get("id").asText()) != null) {
            throw fail("duplicate-id", "Edge \"" + edge.get("id").asText() + "\" already exists");
        }
        requireEndpoints(draft, edge.get("source").asText(), edge.get("target").asText());
        edges(draft).add(edge.deepCopy());
    }

    private static void updateEdge(ObjectNode draft, ObjectNode op) {
        String id = requireString(op, "id");
        ObjectNode patch = optionalPatch(op);
        List<String> unset = unsetList(op);
        if (patch.has("id")) {
            throw fail("malformed", "updateEdge patch may not change \"id\"");
        }
        for (String key : unset) {
            if (REQUIRED_EDGE_FIELDS.contains(key)) {
                throw fail("malformed", "\"" + key + "\" is required and cannot be unset");
            }
        }
        for (String key : unset) {
            if (patch.has(key)) {
                throw fail("malformed", "\"" + key + "\" appears in both patch and unset");
            }
        }
        if ((patch.has("source") && !isString(patch.get("source"))) || (patch.has("target") && !isString(patch.get("target")))
            || (patch.has("priority") && !patch.get("priority").isNumber())
            || (patch.has("isDefault") && !patch.get("isDefault").isBoolean())) {
            throw fail("malformed", "updateEdge patch has a field of the wrong type");
        }
        ObjectNode edge = findById(edges(draft), id);
        if (edge == null) {
            throw fail("target-missing", "Edge \"" + id + "\" does not exist");
        }
        ObjectNode merged = edge.deepCopy();
        merged.setAll(patch.deepCopy());
        unset.forEach(merged::remove);
        requireEndpoints(draft, merged.path("source").asText(), merged.path("target").asText());
        edge.removeAll();
        edge.setAll(merged);
    }

    private static void metadata(ObjectNode draft, ObjectNode op) {
        ObjectNode patch = requireObject(op.get("patch"), "\"patch\"");
        for (Iterator<String> it = patch.fieldNames(); it.hasNext();) {
            String key = it.next();
            if (!METADATA_KEYS.contains(key)) {
                throw fail("malformed", "metadata patch may only contain name, description and version, not \"" + key + "\"");
            }
        }
        if ((patch.has("name") && !isString(patch.get("name")))
            || (patch.has("description") && !patch.get("description").isTextual())
            || (patch.has("version") && !patch.get("version").isNumber())) {
            throw fail("malformed", "metadata patch has a field of the wrong type");
        }
        draft.setAll(patch.deepCopy());
    }
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `./mvnw -q test -Dtest=ChangeSetConformanceTest && ./mvnw -q test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add engine/src/main/java/io/apitomy/flow/changeset engine/src/test/java/io/apitomy/flow/changeset
git commit -m "Add Java ChangeSets matching editor change-set semantics"
```

---

### Task 6: Content revision and origin in editor state

**Files:**
- Modify:
  - `ui/src/hooks/editorState.ts`
  - `ui/src/hooks/editorNotifications.ts`
  - `ui/src/hooks/useEditorState.ts`
  - `ui/src/components/WorkflowEditor.tsx` (the `onChange` prop type only)
  - `ui/src/index.ts`
- Create: `ui/src/hooks/editorRevision.test.ts`

**Interfaces:**
- Consumes:
  - `computeContentRevision` (Task 1)
  - `Origin` and `ChangeMeta` (Task 4)
- Produces:
  - `EditorState.contentRevision: string` and `EditorState.origin: Origin`, both also stored in undo
    snapshots
  - The `import` command accepts `origin?: Origin`
  - The private `reduceCommand` holds the old reducer body. The exported `editorReducer` wraps it and stamps
    `origin` (later tasks extend this wrapper).
  - `createDocumentPublisher` calls `onChange(workflow, meta: ChangeMeta)`

- [ ] **Step 1: Write the failing tests `ui/src/hooks/editorRevision.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createEditorState, editorReducer } from './editorState.ts';
import { createDocumentPublisher } from './editorNotifications.ts';
import { computeContentRevision } from '../changeset/contentRevision.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow = (): Workflow => ({ id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', name: 'A', config: {}, position: { x: 200, y: 0 } },
], edges: [{ id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false }] });

describe('content revision', () => {
    it('starts at the hash of the seeded workflow', () => {
        expect(createEditorState(workflow()).contentRevision).toBe(computeContentRevision(workflow()));
    });

    it('ignores layout-only edits, changes on content edits and is restored by undo', () => {
        const initial = createEditorState(workflow());
        const moved = editorReducer(editorReducer(initial, { type: 'positions', positions: { a: { x: 999, y: 7 } } }),
            { type: 'commitPositions' });
        expect(moved.contentRevision).toBe(initial.contentRevision);
        const renamed = editorReducer(moved, { type: 'nodeData', id: 'a', data: { name: 'Renamed' } });
        expect(renamed.contentRevision).not.toBe(initial.contentRevision);
        expect(editorReducer(renamed, { type: 'undo' }).contentRevision).toBe(initial.contentRevision);
    });
});

describe('origin', () => {
    it('defaults to user, records import origin, uses host for metadata and user for undo', () => {
        const initial = createEditorState(workflow());
        expect(initial.origin).toBe('user');
        const imported = editorReducer(initial, { type: 'import', workflow: { ...workflow(), name: 'Agent' }, origin: 'agent:x' });
        expect(imported.origin).toBe('agent:x');
        expect(editorReducer(imported, { type: 'undo' }).origin).toBe('user');
        const meta = editorReducer(initial, { type: 'metadata', metadata: { id: 'w', name: 'Host name' } });
        expect(meta.origin).toBe('host');
    });

    it('publishes contentRevision and origin with onChange', () => {
        const onChange = vi.fn();
        const state = editorReducer(createEditorState(workflow()), { type: 'nodeData', id: 'a', data: { name: 'New' } });
        createDocumentPublisher()(state, onChange);
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'w' }),
            { contentRevision: state.contentRevision, origin: 'user' });
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/hooks/editorRevision.test.ts`

Expected: FAIL. `contentRevision` is undefined, and the type errors are reported only by `tsc`.

- [ ] **Step 3: Extend the state, snapshots and commit in `ui/src/hooks/editorState.ts`**

1. Add these imports:
   - `import { computeContentRevision } from '../changeset/contentRevision.ts';`
   - `import type { Origin } from '../changeset/types.ts';`
2. Add these fields to `interface Snapshot`:
   ```ts
       /** Content revision of `semanticDocument`; layout-only edits keep it. */
       contentRevision: string;
       /** Origin of the change that produced this state. */
       origin: Origin;
   ```
3. In `createEditorState`, add `contentRevision: computeContentRevision(document), origin: 'user',` to the
   returned object.
4. In `snapshot(state)`, add `contentRevision: state.contentRevision, origin: state.origin,`.
5. In `commit(...)`, add this to the returned object, after `semanticDocument`:
   ```ts
           contentRevision: semanticDocument === state.semanticDocument
               ? state.contentRevision : computeContentRevision(semanticDocument),
   ```
6. Change the import command to `| { type: 'import'; workflow: Workflow; origin?: Origin }`.

- [ ] **Step 4: Split the reducer into `reduceCommand` plus the exported wrapper**

1. Rename the existing `export function editorReducer(` to `function reduceCommand(`, keeping its body.
2. Inside that body, change the recursive calls `editorReducer(next, { type: 'delete', ... })` and
   `editorReducer(next, { type: 'commitPositions' })` to `reduceCommand(...)`.
3. Add the following after the body:

```ts
function commandOrigin(command: EditorCommand): Origin {
    if (command.type === 'import' && command.origin) return command.origin;
    return command.type === 'metadata' ? 'host' : 'user';
}

/** Applies one atomic editor command without effects, clocks, IDs, or mutable history refs. */
export function editorReducer(state: EditorState, command: EditorCommand): EditorState {
    const next = reduceCommand(state, command);
    if (next === state || next.revision === state.revision) return next;
    return { ...next, origin: commandOrigin(command) };
}
```

- [ ] **Step 5: Publish the metadata in `ui/src/hooks/editorNotifications.ts`**

1. Add `import type { ChangeMeta } from '../changeset/types.ts';`.
2. Change the publisher's `onChange` parameter type to `(document: Workflow, meta: ChangeMeta) => void`.
3. Change the call to:

```ts
        onChange(structuredClone(state.document), { contentRevision: state.contentRevision, origin: state.origin });
```

In `ui/src/hooks/useEditorState.ts`, change the `onChange` parameter type to
`(workflow: Workflow, meta: ChangeMeta) => void`.

In `WorkflowEditor.tsx`, change the prop to:

```ts
  /**
   * Called with every committed revision. `meta.origin` tells host- and agent-made changes apart from the
   * user's; `meta.contentRevision` is the base revision for the next change set.
   */
  onChange?: (workflow: Workflow, meta: ChangeMeta) => void;
```

Add `import type { ChangeMeta } from '../changeset/types.ts';` to `WorkflowEditor.tsx`.

In `ui/src/index.ts`, add:

```ts
export type { ChangeMeta, Origin } from './changeset/types.ts';
export { computeContentRevision } from './changeset/contentRevision.ts';
```

- [ ] **Step 6: Run the full suite and the checks**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`

Expected: PASS. Existing tests that build `EditorState` literals by hand may need the two new fields; add
`contentRevision` and `origin` to them.

- [ ] **Step 7: Commit**

```bash
git add ui/src
git commit -m "Track content revision and change origin in editor state"
```

---

### Task 7: Change status and validation delta helpers

**Files:**
- Create:
  - `ui/src/changeset/changeStatus.ts`
  - `ui/src/changeset/changeStatus.test.ts`
  - `ui/src/changeset/validationDelta.ts`
  - `ui/src/changeset/validationDelta.test.ts`

**Interfaces:**
- Consumes:
  - `diffWorkflows(base, compare): WorkflowDiffResult` and `DiffStatus` (from `ui/src/diff/`)
  - `Highlight` (Task 4)
- Produces:
  - `type ChangeKind = 'added' | 'modified' | 'removed' | 'unchanged'`
  - `interface ChangeStatusMap { nodes: Record<string, ChangeKind>; edges: Record<string, ChangeKind> }`
  - `changeStatus(before: Workflow, after: Workflow): ChangeStatusMap`
  - `highlightOf(status: ChangeStatusMap): Highlight | null`
  - `interface ValidationDelta { introduced: ValidationProblem[]; fixed: ValidationProblem[] }`
  - `validationDelta(current: ValidationProblem[], preview: ValidationProblem[]): ValidationDelta`

- [ ] **Step 1: Write the failing tests**

`ui/src/changeset/changeStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { changeStatus, highlightOf } from './changeStatus.ts';
import type { Workflow } from '../types/workflow.ts';

const before: Workflow = { id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', name: 'A', config: {}, position: { x: 200, y: 0 } },
    { id: 'x', type: 'end', name: 'X', config: {}, position: { x: 400, y: 0 } },
], edges: [{ id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false }] };

const after: Workflow = { ...before, nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 50, y: 50 } },
    { id: 'a', type: 'action', name: 'A2', config: {}, position: { x: 200, y: 0 } },
    { id: 'n', type: 'end', name: 'N', config: {} },
], edges: [{ id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false },
    { id: 'an', source: 'a', target: 'n', priority: 0, isDefault: false }] };

describe('changeStatus', () => {
    it('maps diff results onto added/modified/removed/unchanged, treating moves as unchanged', () => {
        expect(changeStatus(before, after)).toEqual({
            nodes: { s: 'unchanged', a: 'modified', x: 'removed', n: 'added' },
            edges: { sa: 'unchanged', an: 'added' },
        });
    });
});

describe('highlightOf', () => {
    it('lists added and modified ids sorted, and returns null when nothing changed', () => {
        expect(highlightOf(changeStatus(before, after))).toEqual({ nodeIds: ['a', 'n'], edgeIds: ['an'] });
        expect(highlightOf(changeStatus(before, before))).toBeNull();
    });
});
```

`ui/src/changeset/validationDelta.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validationDelta } from './validationDelta.ts';
import type { ValidationProblem } from '../types/validation.ts';

const problem = (code: string, nodeId?: string): ValidationProblem =>
    ({ severity: 'error', code, message: `${code} message`, ...(nodeId ? { nodeId } : {}) });

describe('validationDelta', () => {
    it('reports problems introduced and fixed, ignoring message text', () => {
        const current = [problem('A', 'n1'), problem('B')];
        const preview = [{ ...problem('B'), message: 'reworded' }, problem('C', 'n2')];
        expect(validationDelta(current, preview)).toEqual({ introduced: [problem('C', 'n2')], fixed: [problem('A', 'n1')] });
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/changeset/changeStatus.test.ts src/changeset/validationDelta.test.ts`

Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement `ui/src/changeset/changeStatus.ts`**

```ts
import { diffWorkflows } from '../diff/workflowDiff.ts';
import type { DiffStatus } from '../diff/workflowDiffTypes.ts';
import type { Workflow } from '../types/workflow.ts';
import type { Highlight } from './types.ts';

/** Review-oriented change classification; position-only (cosmetic) changes count as unchanged. */
export type ChangeKind = 'added' | 'modified' | 'removed' | 'unchanged';

/** Per-element change classification keyed by node and edge id. */
export interface ChangeStatusMap {
    nodes: Record<string, ChangeKind>;
    edges: Record<string, ChangeKind>;
}

function toKind(status: DiffStatus): ChangeKind {
    if (status === 'changed') return 'modified';
    if (status === 'cosmetic') return 'unchanged';
    return status;
}

/**
 * Classifies every node and edge of `before` ∪ `after`, reusing the `WorkflowDiffViewer` diff.
 *
 * @param before the current workflow
 * @param after the proposed or newly applied workflow
 * @returns the classification map
 */
export function changeStatus(before: Workflow, after: Workflow): ChangeStatusMap {
    const diff = diffWorkflows(before, after);
    return {
        nodes: Object.fromEntries(diff.nodeOrder.map(id => [id, toKind(diff.nodes[id].status)])),
        edges: Object.fromEntries(diff.edgeOrder.map(id => [id, toKind(diff.edges[id].status)])),
    };
}

/**
 * Collects the ids worth highlighting after an apply (added and modified, never removed).
 *
 * @param status the classification map
 * @returns sorted ids, or null when nothing was added or modified
 */
export function highlightOf(status: ChangeStatusMap): Highlight | null {
    const pick = (map: Record<string, ChangeKind>) =>
        Object.keys(map).filter(id => map[id] === 'added' || map[id] === 'modified').sort();
    const nodeIds = pick(status.nodes);
    const edgeIds = pick(status.edges);
    return nodeIds.length || edgeIds.length ? { nodeIds, edgeIds } : null;
}
```

If `diffWorkflows` lives under a different file name than `../diff/workflowDiff.ts`, or `DiffStatus` lives
somewhere other than `../diff/workflowDiffTypes.ts`, fix the import paths. Both were confirmed in
`ui/src/diff/`.

- [ ] **Step 4: Implement `ui/src/changeset/validationDelta.ts`**

```ts
import type { ValidationProblem } from '../types/validation.ts';

/** Problems a proposal would introduce and problems it would fix. */
export interface ValidationDelta {
    introduced: ValidationProblem[];
    fixed: ValidationProblem[];
}

const problemKey = (problem: ValidationProblem) =>
    [problem.code, problem.severity, problem.nodeId ?? '', problem.edgeId ?? ''].join('|');

/**
 * Compares current and previewed validation results by code, severity and target (not message text).
 *
 * @param current problems of the current workflow
 * @param preview problems of the proposed workflow
 * @returns introduced and fixed problems
 */
export function validationDelta(current: ValidationProblem[], preview: ValidationProblem[]): ValidationDelta {
    const currentKeys = new Set(current.map(problemKey));
    const previewKeys = new Set(preview.map(problemKey));
    return {
        introduced: preview.filter(problem => !currentKeys.has(problemKey(problem))),
        fixed: current.filter(problem => !previewKeys.has(problemKey(problem))),
    };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/changeset/ && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/changeset
git commit -m "Add change status and validation delta helpers"
```

---

### Task 8: Proposals, apply and highlights in the reducer

**Files:**
- Modify:
  - `ui/src/hooks/editorState.ts`
  - `ui/src/hooks/editorReadOnly.ts`
  - `ui/src/hooks/editorNotifications.ts`
- Create: `ui/src/hooks/editorProposals.test.ts`
- Test: `ui/src/hooks/editorReadOnly.test.ts` and `ui/src/hooks/editorNotifications.test.ts` (add cases)

**Interfaces:**
- Consumes:
  - `applyChangeSetChecked` (Task 4)
  - `changeStatus` and `highlightOf` (Task 7)
  - `StagedProposal`, `Highlight`, `ProposalEvent`, `ProposalOutcome` and `ChangeSet` (Task 4)
- Produces:
  - `EditorState` gains `proposal: StagedProposal | null`, `highlight: Highlight | null`,
    `proposalEvents: ProposalEvent[]` and `proposalSeq: number`. None of these are stored in undo
    snapshots.
  - New commands:
    - `{ type: 'propose'; changeSet: ChangeSet; preview: Workflow }`
    - `{ type: 'withdraw'; id: string }`
    - `{ type: 'applyChangeSet'; changeSet: ChangeSet }`
    - `{ type: 'acceptProposal' }`
    - `{ type: 'rejectProposal' }`
    - `{ type: 'clearHighlights' }`
  - In `editorNotifications.ts`:
    - `interface EditorSelection { nodeIds: string[]; edgeIds: string[] }`
    - `selectionOf(state: EditorState): EditorSelection`
    - `createProposalPublisher(): (state, onResolved?: (id: string, outcome: ProposalOutcome) => void) => void`
    - `createSelectionPublisher(): (state, onSelectionChange?: (selection: EditorSelection) => void) => void`

**Behaviour rules:**
- **Staleness:** any content change, whatever its origin, marks a fresh staged proposal stale and emits
  `stale` once.
- **Highlight clearing:** a user-origin content change clears the highlight. Host and agent changes keep it.
- **Applying:**
  - `applyChangeSet` produces one undo step with `origin = changeSet.author` and replaces the highlight.
  - If the applied set is the staged proposal, the editor emits `accepted` and clears the proposal.
    Otherwise the staged proposal goes stale.
  - The reducer re-checks `baseRevision` and ignores stale or invalid sets. The handle reports the reason
    (Task 9).
- **Rejecting and withdrawing:** rejecting or withdrawing a proposal that is already stale clears it
  without emitting a second event.

- [ ] **Step 1: Write the failing tests `ui/src/hooks/editorProposals.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createEditorState, editorReducer, type EditorState } from './editorState.ts';
import { applyChangeSetChecked } from '../changeset/applyChangeSet.ts';
import type { ChangeSet } from '../changeset/types.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow = (): Workflow => ({ id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', name: 'A', config: {}, position: { x: 200, y: 0 } },
    { id: 'e', type: 'end', name: 'E', config: {}, position: { x: 400, y: 0 } },
], edges: [
    { id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false },
    { id: 'ae', source: 'a', target: 'e', priority: 0, isDefault: false },
] });

const addWait = (state: EditorState, id = 'cs-1'): ChangeSet => ({ id, baseRevision: state.contentRevision,
    author: 'agent:test', summary: 'Add wait', ops: [
        { op: 'removeEdge', id: 'ae' },
        { op: 'addNode', node: { id: 'w', type: 'wait', name: 'Wait', config: { duration: 'PT1M' } } },
        { op: 'addEdge', edge: { id: 'aw', source: 'a', target: 'w', priority: 0, isDefault: false } },
        { op: 'addEdge', edge: { id: 'we', source: 'w', target: 'e', priority: 0, isDefault: false } },
    ] });

function propose(state: EditorState, changeSet: ChangeSet): EditorState {
    const result = applyChangeSetChecked(state.document, changeSet, state.contentRevision);
    if (!result.ok) throw new Error(result.error.reason);
    return editorReducer(state, { type: 'propose', changeSet, preview: result.workflow });
}

const outcomes = (state: EditorState) => state.proposalEvents.map(event => `${event.id}:${event.outcome}`);
const rename = (state: EditorState) => editorReducer(state, { type: 'nodeData', id: 'a', data: { name: 'Edited' } });

describe('applyChangeSet', () => {
    it('applies as one undo step tagged with the author', () => {
        const initial = createEditorState(workflow());
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial) });
        expect(applied.document.nodes.map(node => node.id)).toContain('w');
        expect(applied.past).toHaveLength(initial.past.length + 1);
        expect(applied.origin).toBe('agent:test');
        const undone = editorReducer(applied, { type: 'undo' });
        expect(undone.document.nodes.map(node => node.id)).not.toContain('w');
        expect(undone.contentRevision).toBe(initial.contentRevision);
        expect(undone.origin).toBe('user');
    });

    it('ignores a stale change set', () => {
        const initial = createEditorState(workflow());
        const stale = { ...addWait(initial), baseRevision: 'sha256:old' };
        expect(editorReducer(initial, { type: 'applyChangeSet', changeSet: stale })).toBe(initial);
    });

    it('highlights added and modified elements and keeps them across layout edits', () => {
        const initial = createEditorState(workflow());
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial) });
        expect(applied.highlight).toEqual({ nodeIds: ['w'], edgeIds: ['aw', 'we'] });
        const moved = editorReducer(editorReducer(applied, { type: 'positions', positions: { s: { x: 5, y: 5 } } }),
            { type: 'commitPositions' });
        expect(moved.highlight).not.toBeNull();
        expect(rename(moved).highlight).toBeNull();
        expect(editorReducer(applied, { type: 'clearHighlights' }).highlight).toBeNull();
    });

    it('keeps the highlight across host metadata changes', () => {
        const initial = createEditorState(workflow());
        const applied = editorReducer(initial, { type: 'applyChangeSet', changeSet: addWait(initial) });
        const hosted = editorReducer(applied, { type: 'metadata', metadata: { id: 'w', name: 'Host' } });
        expect(hosted.origin).toBe('host');
        expect(hosted.highlight).not.toBeNull();
    });
});

describe('proposals', () => {
    it('stages without touching the document or history', () => {
        const initial = createEditorState(workflow());
        const staged = propose(initial, addWait(initial));
        expect(staged.document).toBe(initial.document);
        expect(staged.past).toBe(initial.past);
        expect(staged.proposal?.stale).toBe(false);
    });

    it('withdraws the previous proposal when a new one is staged', () => {
        const initial = createEditorState(workflow());
        const second = propose(propose(initial, addWait(initial, 'cs-1')), addWait(initial, 'cs-2'));
        expect(outcomes(second)).toEqual(['cs-1:withdrawn']);
        expect(second.proposal?.changeSet.id).toBe('cs-2');
    });

    it('goes stale once on a content edit, including undo, but not on layout edits', () => {
        const initial = rename(createEditorState(workflow()));
        const staged = propose(initial, addWait(initial));
        const moved = editorReducer(editorReducer(staged, { type: 'positions', positions: { s: { x: 9, y: 9 } } }),
            { type: 'commitPositions' });
        expect(moved.proposal?.stale).toBe(false);
        const undone = editorReducer(moved, { type: 'undo' });
        const twice = rename(rename(undone));
        expect(twice.proposal?.stale).toBe(true);
        expect(outcomes(twice)).toEqual(['cs-1:stale']);
    });

    it('accepts a fresh proposal and ignores accept when stale', () => {
        const initial = createEditorState(workflow());
        const accepted = editorReducer(propose(initial, addWait(initial)), { type: 'acceptProposal' });
        expect(accepted.proposal).toBeNull();
        expect(accepted.origin).toBe('agent:test');
        expect(outcomes(accepted)).toEqual(['cs-1:accepted']);
        const stale = rename(propose(initial, addWait(initial)));
        expect(editorReducer(stale, { type: 'acceptProposal' })).toBe(stale);
    });

    it('rejects with an event, and dismisses a stale proposal silently', () => {
        const initial = createEditorState(workflow());
        const rejected = editorReducer(propose(initial, addWait(initial)), { type: 'rejectProposal' });
        expect(rejected.proposal).toBeNull();
        expect(outcomes(rejected)).toEqual(['cs-1:rejected']);
        const dismissed = editorReducer(rename(propose(initial, addWait(initial))), { type: 'rejectProposal' });
        expect(dismissed.proposal).toBeNull();
        expect(outcomes(dismissed)).toEqual(['cs-1:stale']);
    });

    it('withdraws only a matching id', () => {
        const initial = createEditorState(workflow());
        const staged = propose(initial, addWait(initial));
        expect(editorReducer(staged, { type: 'withdraw', id: 'other' })).toBe(staged);
        expect(outcomes(editorReducer(staged, { type: 'withdraw', id: 'cs-1' }))).toEqual(['cs-1:withdrawn']);
    });

    it('marks the staged proposal stale when a different change set is applied', () => {
        const initial = createEditorState(workflow());
        const staged = propose(initial, addWait(initial, 'cs-1'));
        const other: ChangeSet = { id: 'cs-2', baseRevision: initial.contentRevision, author: 'host', summary: 'Rename',
            ops: [{ op: 'metadata', patch: { name: 'Other' } }] };
        const applied = editorReducer(staged, { type: 'applyChangeSet', changeSet: other });
        expect(applied.proposal?.stale).toBe(true);
        expect(outcomes(applied)).toEqual(['cs-1:stale']);
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/hooks/editorProposals.test.ts`

Expected: FAIL. `proposal` is undefined and the commands are unknown.

- [ ] **Step 3: Add the state fields and commands to `ui/src/hooks/editorState.ts`**

1. Add these imports:
   ```ts
   import { applyChangeSetChecked } from '../changeset/applyChangeSet.ts';
   import { changeStatus, highlightOf } from '../changeset/changeStatus.ts';
   import type { ChangeSet, Highlight, ProposalEvent, ProposalOutcome, StagedProposal } from '../changeset/types.ts';
   ```
   Extend the existing `Origin` import from `../changeset/types.ts` with these names.
2. Add these fields to `interface EditorState`:
   ```ts
       /** The single proposal under review, if any. Not part of undo history. */
       proposal: StagedProposal | null;
       /** Elements changed by the most recently applied change set. Not part of undo history. */
       highlight: Highlight | null;
       /** Recent proposal resolutions, drained by `createProposalPublisher`. */
       proposalEvents: ProposalEvent[];
       /** Sequence number of the last emitted proposal event. */
       proposalSeq: number;
   ```
3. In `createEditorState`, add `proposal: null, highlight: null, proposalEvents: [], proposalSeq: 0,`.
4. Add these members to the `EditorCommand` union:
   ```ts
       | { type: 'propose'; changeSet: ChangeSet; preview: Workflow }
       | { type: 'withdraw'; id: string }
       | { type: 'applyChangeSet'; changeSet: ChangeSet }
       | { type: 'acceptProposal' }
       | { type: 'rejectProposal' }
       | { type: 'clearHighlights' }
   ```
5. Change the `reduceCommand` signature to accept only the older commands, so its switch never sees the new
   ones:
   ```ts
   type ProposalCommandType = 'propose' | 'withdraw' | 'applyChangeSet' | 'acceptProposal' | 'rejectProposal' | 'clearHighlights';
   function reduceCommand(state: EditorState, command: Exclude<EditorCommand, { type: ProposalCommandType }>): EditorState {
   ```

- [ ] **Step 4: Replace the wrapper from Task 6 with the full version**

```ts
function emit(state: EditorState, id: string, outcome: ProposalOutcome): EditorState {
    const seq = state.proposalSeq + 1;
    return { ...state, proposalSeq: seq, proposalEvents: [...state.proposalEvents, { seq, id, outcome }].slice(-20) };
}

function markStale(state: EditorState): EditorState {
    const proposal = state.proposal;
    if (!proposal || proposal.stale) return state;
    return { ...emit(state, proposal.changeSet.id, 'stale'), proposal: { ...proposal, stale: true } };
}

function applyChangeSetCommand(state: EditorState, changeSet: ChangeSet): EditorState {
    const result = applyChangeSetChecked(state.document, changeSet, state.contentRevision);
    if (!result.ok) return state;
    const committed = commit(state, result.workflow);
    let next: EditorState = { ...committed, origin: changeSet.author, group: undefined,
        highlight: highlightOf(changeStatus(state.document, committed.document)) };
    if (state.proposal?.changeSet.id === changeSet.id) {
        next = { ...emit(next, changeSet.id, 'accepted'), proposal: null };
    } else if (next.contentRevision !== state.contentRevision) {
        next = markStale(next);
    }
    return next;
}

/** Applies one atomic editor command without effects, clocks, IDs, or mutable history refs. */
export function editorReducer(state: EditorState, command: EditorCommand): EditorState {
    switch (command.type) {
        case 'propose': {
            if (command.changeSet.baseRevision !== state.contentRevision) return state;
            const next = state.proposal && !state.proposal.stale
                ? emit(state, state.proposal.changeSet.id, 'withdrawn') : state;
            return { ...next, proposal: { changeSet: command.changeSet, preview: command.preview, stale: false } };
        }
        case 'withdraw': {
            const proposal = state.proposal;
            if (!proposal || proposal.changeSet.id !== command.id) return state;
            return { ...(proposal.stale ? state : emit(state, command.id, 'withdrawn')), proposal: null };
        }
        case 'rejectProposal': {
            const proposal = state.proposal;
            if (!proposal) return state;
            return { ...(proposal.stale ? state : emit(state, proposal.changeSet.id, 'rejected')), proposal: null };
        }
        case 'acceptProposal':
            return state.proposal && !state.proposal.stale ? applyChangeSetCommand(state, state.proposal.changeSet) : state;
        case 'applyChangeSet':
            return applyChangeSetCommand(state, command.changeSet);
        case 'clearHighlights':
            return state.highlight ? { ...state, highlight: null } : state;
    }
    const next = reduceCommand(state, command);
    if (next === state || next.revision === state.revision) return next;
    const origin = commandOrigin(command);
    let result: EditorState = { ...next, origin };
    if (result.contentRevision !== state.contentRevision) {
        if (origin === 'user' && result.highlight) result = { ...result, highlight: null };
        result = markStale(result);
    }
    return result;
}
```

`applyChangeSetCommand` calls `commit` directly rather than going through `import`. This keeps the user's
selection, and it also works while simulating. That is intentional: an agent may apply changes during a
simulation run.

- [ ] **Step 5: Allow the presentation-only commands in `ui/src/hooks/editorReadOnly.ts`**

Add these cases to the pass-through group (`case 'select': case 'endGroup': case 'metadata':`):

```ts
        case 'propose':
        case 'withdraw':
        case 'rejectProposal':
        case 'clearHighlights':
```

`applyChangeSet` and `acceptProposal` fall through to `default` and return `null`. Update the doc comment to
say that proposals may be previewed but not accepted or applied.

Add this to `ui/src/hooks/editorReadOnly.test.ts`:

```ts
it('lets proposals be previewed but never applied when read-only', () => {
    const changeSet = { id: 'c', baseRevision: 'r', author: 'host' as const, summary: 's', ops: [] };
    expect(readOnlyCommand({ type: 'propose', changeSet, preview: { id: 'w', name: 'W', nodes: [], edges: [] } })).not.toBeNull();
    expect(readOnlyCommand({ type: 'rejectProposal' })).not.toBeNull();
    expect(readOnlyCommand({ type: 'clearHighlights' })).not.toBeNull();
    expect(readOnlyCommand({ type: 'withdraw', id: 'c' })).not.toBeNull();
    expect(readOnlyCommand({ type: 'acceptProposal' })).toBeNull();
    expect(readOnlyCommand({ type: 'applyChangeSet', changeSet })).toBeNull();
});
```

- [ ] **Step 6: Add the publishers to `ui/src/hooks/editorNotifications.ts`**

```ts
/** The nodes and edges currently selected on the canvas, sorted by id. */
export interface EditorSelection {
    nodeIds: string[];
    edgeIds: string[];
}

/**
 * Derives the selection from React Flow selection flags plus the focused node/edge.
 *
 * @param state the editor state
 * @returns sorted, de-duplicated ids
 */
export function selectionOf(state: EditorState): EditorSelection {
    const nodeIds = new Set(state.nodes.filter(node => node.selected).map(node => node.id));
    const edgeIds = new Set(state.edges.filter(edge => edge.selected).map(edge => edge.id));
    if (state.selectedNodeId) nodeIds.add(state.selectedNodeId);
    if (state.selectedEdgeId) edgeIds.add(state.selectedEdgeId);
    return { nodeIds: [...nodeIds].sort(), edgeIds: [...edgeIds].sort() };
}

/** Creates a per-mount publisher that reports each proposal resolution exactly once. */
export function createProposalPublisher():
    (state: EditorState, onResolved?: (id: string, outcome: ProposalOutcome) => void) => void {
    let emittedSeq = 0;
    return (state, onResolved) => {
        const pending = state.proposalEvents.filter(event => event.seq > emittedSeq);
        if (pending.length === 0) return;
        emittedSeq = pending[pending.length - 1].seq;
        pending.forEach(event => onResolved?.(event.id, event.outcome));
    };
}

/** Creates a per-mount publisher that reports selection only when it actually changes. */
export function createSelectionPublisher():
    (state: EditorState, onSelectionChange?: (selection: EditorSelection) => void) => void {
    let last = JSON.stringify({ nodeIds: [], edgeIds: [] });
    return (state, onSelectionChange) => {
        const selection = selectionOf(state);
        const key = JSON.stringify(selection);
        if (key === last) return;
        last = key;
        onSelectionChange?.(selection);
    };
}
```

Add `import type { ProposalOutcome } from '../changeset/types.ts';`.

Add these tests to `ui/src/hooks/editorNotifications.test.ts`, reusing its existing `workflow` fixture
helper (the file already builds state with `createEditorState(workflow)`):

```ts
it('publishes each proposal resolution once', () => {
    const resolved: string[] = [];
    const publish = createProposalPublisher();
    const state = { ...createEditorState(workflow), proposalSeq: 2, proposalEvents: [
        { seq: 1, id: 'a', outcome: 'withdrawn' as const }, { seq: 2, id: 'b', outcome: 'accepted' as const }] };
    publish(state, (id, outcome) => resolved.push(`${id}:${outcome}`));
    publish(state, (id, outcome) => resolved.push(`${id}:${outcome}`));
    expect(resolved).toEqual(['a:withdrawn', 'b:accepted']);
});

it('publishes selection only when it changes', () => {
    const seen: unknown[] = [];
    const publish = createSelectionPublisher();
    const initial = createEditorState(workflow);
    publish(initial, selection => seen.push(selection));
    const nodeId = initial.document.nodes[0].id;
    const selected = editorReducer(initial, { type: 'select', nodeId });
    publish(selected, selection => seen.push(selection));
    publish(selected, selection => seen.push(selection));
    expect(seen).toEqual([{ nodeIds: [nodeId], edgeIds: [] }]);
});
```

- [ ] **Step 7: Run everything**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ui/src/hooks
git commit -m "Stage, accept and apply change sets in the editor reducer"
```

---

### Task 9: Imperative handle and new editor props

**Files:**
- Create:
  - `ui/src/hooks/editorHandle.ts`
  - `ui/src/hooks/editorHandle.test.ts`
- Modify:
  - `ui/src/hooks/useEditorState.ts`
  - `ui/src/components/WorkflowEditor.tsx`
  - `ui/src/index.ts`

**Interfaces:**
- Consumes:
  - `editorReducer` and its commands (Task 8)
  - `selectionOf`, `createProposalPublisher` and `createSelectionPublisher` (Task 8)
  - `applyChangeSetChecked` (Task 4)
- Produces:
  - Types:
    - `WorkflowEditorHandle`
    - `EditorSnapshot`
    - `ProposeResult = { status: 'staged' } | { status: 'rejected'; error: ChangeSetError }`
    - `ApplyResult = { status: 'applied' } | { status: 'rejected'; error: ChangeSetError }`
  - `createEditorHandle(access: HandleAccess): WorkflowEditorHandle`
  - New `WorkflowEditorProps`: `ref`, `onProposalResolved`, `onSelectionChange`, `highlightApplied`
    (default `true`; it is used in Task 10)

- [ ] **Step 1: Write the failing tests `ui/src/hooks/editorHandle.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createEditorState, editorReducer, type EditorCommand, type EditorState } from './editorState.ts';
import { readOnlyCommand } from './editorReadOnly.ts';
import { createEditorHandle } from './editorHandle.ts';
import type { ChangeSet } from '../changeset/types.ts';
import type { Workflow } from '../types/workflow.ts';

const workflow = (): Workflow => ({ id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'e', type: 'end', name: 'E', config: {}, position: { x: 300, y: 0 } },
], edges: [{ id: 'se', source: 's', target: 'e', priority: 0, isDefault: false }] });

function harness(readOnly = false) {
    let state: EditorState = createEditorState(workflow());
    const handle = createEditorHandle({
        state: () => state,
        dispatch: (command: EditorCommand) => {
            const allowed = command.type === 'import' ? command : readOnly ? readOnlyCommand(command) : command;
            if (allowed) state = editorReducer(state, allowed);
        },
        readOnly: () => readOnly,
        problems: () => [],
    });
    return { handle, state: () => state };
}

const rename = (baseRevision: string, id = 'cs'): ChangeSet =>
    ({ id, baseRevision, author: 'agent:t', summary: 'Rename', ops: [{ op: 'metadata', patch: { name: 'New' } }] });

describe('createEditorHandle', () => {
    it('stages a valid proposal', () => {
        const { handle, state } = harness();
        expect(handle.propose(rename(handle.getSnapshot().contentRevision))).toEqual({ status: 'staged' });
        expect(state().proposal?.preview.name).toBe('New');
    });

    it('rejects stale and invalid change sets with codes', () => {
        const { handle } = harness();
        expect(handle.propose(rename('sha256:old'))).toMatchObject({ status: 'rejected', error: { code: 'stale' } });
        const bad: ChangeSet = { ...rename(handle.getSnapshot().contentRevision), ops: [{ op: 'removeNode', id: 'nope' }] };
        expect(handle.apply(bad)).toMatchObject({ status: 'rejected', error: { code: 'target-missing', opIndex: 0 } });
    });

    it('applies and advances the revision', () => {
        const { handle, state } = harness();
        const before = handle.getSnapshot().contentRevision;
        expect(handle.apply(rename(before))).toEqual({ status: 'applied' });
        expect(handle.getSnapshot().contentRevision).not.toBe(before);
        expect(state().origin).toBe('agent:t');
    });

    it('refuses to apply when read-only but still previews', () => {
        const { handle } = harness(true);
        const revision = handle.getSnapshot().contentRevision;
        expect(handle.apply(rename(revision))).toMatchObject({ status: 'rejected', error: { code: 'read-only' } });
        expect(handle.propose(rename(revision))).toEqual({ status: 'staged' });
    });

    it('replaces the document as a host change that keeps existing positions', () => {
        const { handle, state } = harness();
        const next = workflow();
        next.nodes.push({ id: 'x', type: 'wait', name: 'X', config: {} });
        handle.replace(next);
        expect(state().origin).toBe('host');
        expect(state().document.nodes[0].position).toEqual({ x: 0, y: 0 });
        expect(state().document.nodes[2].position).toBeDefined();
    });

    it('withdraws, clears highlights and returns detached snapshots', () => {
        const { handle, state } = harness();
        handle.apply(rename(handle.getSnapshot().contentRevision, 'a'));
        handle.clearHighlights();
        expect(state().highlight).toBeNull();
        handle.propose(rename(handle.getSnapshot().contentRevision, 'b'));
        handle.withdraw('b');
        expect(state().proposal).toBeNull();
        const snapshot = handle.getSnapshot();
        snapshot.workflow.nodes.length = 0;
        expect(state().document.nodes).toHaveLength(2);
        expect(snapshot.selection).toEqual({ nodeIds: [], edgeIds: [] });
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/hooks/editorHandle.test.ts`

Expected: FAIL, because the module is missing. If `EditorCommand` is not exported from `editorState.ts`,
note that it already is (`export type EditorCommand`).

- [ ] **Step 3: Implement `ui/src/hooks/editorHandle.ts`**

```ts
import { applyChangeSetChecked } from '../changeset/applyChangeSet.ts';
import type { ChangeSet, ChangeSetError, Origin } from '../changeset/types.ts';
import type { ValidationProblem } from '../types/validation.ts';
import type { Workflow } from '../types/workflow.ts';
import type { EditorCommand, EditorState } from './editorState.ts';
import { selectionOf, type EditorSelection } from './editorNotifications.ts';

/** Point-in-time view of the editor for building agent context and change sets. */
export interface EditorSnapshot {
    workflow: Workflow;
    contentRevision: string;
    selection: EditorSelection;
    problems: ValidationProblem[];
}

/** Result of {@link WorkflowEditorHandle.propose}. */
export type ProposeResult = { status: 'staged' } | { status: 'rejected'; error: ChangeSetError };

/** Result of {@link WorkflowEditorHandle.apply}. */
export type ApplyResult = { status: 'applied' } | { status: 'rejected'; error: ChangeSetError };

/** Imperative API exposed through the `ref` prop of `WorkflowEditor`. No method throws. */
export interface WorkflowEditorHandle {
    /** Stages a change set for review, replacing (and withdrawing) any staged proposal. */
    propose(changeSet: ChangeSet): ProposeResult;
    /** Applies a change set immediately as one undoable step tagged with its author. */
    apply(changeSet: ChangeSet): ApplyResult;
    /** Removes the staged proposal if its id matches. */
    withdraw(id: string): void;
    /** Replaces the whole document as one undoable step; exits simulation first. */
    replace(workflow: Workflow, origin?: Origin): void;
    /** Removes the highlight left by the last applied change set. */
    clearHighlights(): void;
    /** Returns a detached copy of the current document, revision, selection and problems. */
    getSnapshot(): EditorSnapshot;
}

/** Live accessors the handle needs; the component supplies React-backed ones, tests supply plain ones. */
export interface HandleAccess {
    state(): EditorState;
    dispatch(command: EditorCommand): void;
    readOnly(): boolean;
    problems(): ValidationProblem[];
}

/**
 * Builds the editor handle. Results are computed from the same pure functions the reducer uses, so the
 * returned status always matches what the reducer does with the dispatched command.
 *
 * @param access live accessors for state, dispatch and validation
 * @returns the handle
 */
export function createEditorHandle(access: HandleAccess): WorkflowEditorHandle {
    return {
        propose(changeSet) {
            const state = access.state();
            const result = applyChangeSetChecked(state.document, changeSet, state.contentRevision);
            if (!result.ok) return { status: 'rejected', error: result.error };
            access.dispatch({ type: 'propose', changeSet: structuredClone(changeSet), preview: result.workflow });
            return { status: 'staged' };
        },
        apply(changeSet) {
            if (access.readOnly()) {
                return { status: 'rejected', error: { code: 'read-only', reason: 'The editor is read-only' } };
            }
            const state = access.state();
            const result = applyChangeSetChecked(state.document, changeSet, state.contentRevision);
            if (!result.ok) return { status: 'rejected', error: result.error };
            access.dispatch({ type: 'applyChangeSet', changeSet: structuredClone(changeSet) });
            return { status: 'applied' };
        },
        withdraw(id) {
            access.dispatch({ type: 'withdraw', id });
        },
        replace(workflow, origin = 'host') {
            access.dispatch({ type: 'mode', simulating: false });
            access.dispatch({ type: 'import', workflow: structuredClone(workflow), origin });
        },
        clearHighlights() {
            access.dispatch({ type: 'clearHighlights' });
        },
        getSnapshot() {
            const state = access.state();
            return { workflow: structuredClone(state.document), contentRevision: state.contentRevision,
                selection: selectionOf(state), problems: structuredClone(access.problems()) };
        },
    };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/hooks/editorHandle.test.ts`

Expected: PASS.

- [ ] **Step 5: Wire the publishers into `ui/src/hooks/useEditorState.ts`**

1. Add a third parameter and two more publishers after the existing document publisher:

```ts
/** Host callbacks beyond `onChange`. */
export interface EditorListeners {
    onProposalResolved?: (id: string, outcome: ProposalOutcome) => void;
    onSelectionChange?: (selection: EditorSelection) => void;
}
```

```ts
export function useEditorState(workflow: Workflow, onChange: (workflow: Workflow, meta: ChangeMeta) => void,
    listeners: EditorListeners = {}) {
    // ...existing body up to the document publisher...
    const [publishProposals] = useState(createProposalPublisher);
    const [publishSelection] = useState(createSelectionPublisher);
    const { onProposalResolved, onSelectionChange } = listeners;
    useEffect(() => {
        publishProposals(state, onProposalResolved);
    }, [state, onProposalResolved, publishProposals]);
    useEffect(() => {
        publishSelection(state, onSelectionChange);
    }, [state, onSelectionChange, publishSelection]);
    return { state, dispatch };
}
```

2. Import `ProposalOutcome` and `ChangeMeta` from `../changeset/types.ts`, and `EditorSelection`,
   `createProposalPublisher` and `createSelectionPublisher` from `./editorNotifications.ts`.

- [ ] **Step 6: Add the props and the handle to `ui/src/components/WorkflowEditor.tsx`**

This file uses 2-space indentation.

1. Add these to `WorkflowEditorProps`:

```ts
  /** Imperative handle for staging and applying change sets (React 19 ref prop). */
  ref?: Ref<WorkflowEditorHandle>;
  /** Called once for every proposal resolution: accepted, rejected, stale or withdrawn. */
  onProposalResolved?: (id: string, outcome: ProposalOutcome) => void;
  /** Called when the set of selected nodes/edges changes. */
  onSelectionChange?: (selection: EditorSelection) => void;
  /** Keep elements changed by the last applied change set highlighted. Defaults to true. */
  highlightApplied?: boolean;
```

2. Add these imports:
   - `type Ref`, `useImperativeHandle` and `useLayoutEffect` from `react`
   - `createEditorHandle` and `type WorkflowEditorHandle` from `../hooks/editorHandle.ts`
   - `type EditorSelection` from `../hooks/editorNotifications.ts`
   - `type ProposalOutcome` from `../changeset/types.ts`
   - `editorReducer` from `../hooks/editorState.ts` (extend the existing `EditorCommand` import)

3. Destructure the new props in `WorkflowEditorInner`:
   `ref, onProposalResolved, onSelectionChange, highlightApplied = true`.
   `highlightApplied` is unused until Task 10. If lint complains, prefix the destructured name with `_` or
   defer destructuring it to Task 10.

4. Pass the listeners to `useEditorState`:

```tsx
  const { state, dispatch: rawDispatch } = useEditorState(workflow, readOnly ? ignoreChange : onChange ?? ignoreChange,
    { onProposalResolved, onSelectionChange });
```

5. Add this immediately after the `useEffect` that calls `onValidationChange?.(validationProblems)`:

```tsx
  // The handle reads the latest committed state; dispatches update it eagerly with the same pure reducer so
  // consecutive handle calls (propose → apply) observe each other before React re-renders.
  const stateRef = useRef(state);
  const problemsRef = useRef(validationProblems);
  useLayoutEffect(() => {
    stateRef.current = state;
    problemsRef.current = validationProblems;
  }, [state, validationProblems]);
  useImperativeHandle(ref, () => createEditorHandle({
    state: () => stateRef.current,
    dispatch: (command) => {
      // Host document replacement bypasses the read-only filter; everything else obeys it.
      const allowed = command.type === 'import' ? command : readOnly ? readOnlyCommand(command) : command;
      if (!allowed) return;
      stateRef.current = editorReducer(stateRef.current, allowed);
      rawDispatch(allowed);
    },
    readOnly: () => readOnly,
    problems: () => problemsRef.current,
  }), [readOnly, rawDispatch]);
```

The outer `WorkflowEditor` already spreads `{...props}` into `WorkflowEditorInner`. In React 19 `ref` is an
ordinary prop for function components, so no `forwardRef` is needed.

- [ ] **Step 7: Export the public API from `ui/src/index.ts`**

```ts
export type {
    ChangeSet, ChangeOp, ChangeSetError, ChangeSetErrorCode, ChangeSetResult, ProposalOutcome,
} from './changeset/types.ts';
export { applyChangeSet, applyChangeSetChecked } from './changeset/applyChangeSet.ts';
export type {
    WorkflowEditorHandle, EditorSnapshot, ProposeResult, ApplyResult,
} from './hooks/editorHandle.ts';
export type { EditorSelection } from './hooks/editorNotifications.ts';
```

- [ ] **Step 8: Run everything**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ui/src
git commit -m "Expose an imperative editor handle for change sets"
```

---

### Task 10: Proposal overlay, review bar and applied highlight

**Files:**
- Create:
  - `ui/src/changeset/proposalOverlay.ts`
  - `ui/src/changeset/proposalOverlay.test.ts`
  - `ui/src/components/panels/ProposalReviewBar.tsx`
- Modify:
  - `ui/src/components/WorkflowEditor.tsx`
  - `ui/src/components/WorkflowEditor.css`

**Interfaces:**
- Consumes:
  - `changeStatus` and `ChangeStatusMap` (Task 7)
  - `validationDelta` and `ValidationDelta` (Task 7)
  - `StagedProposal` and `Highlight` (Task 4)
  - `toReactFlowNodes` and `toReactFlowEdges` from `ui/src/utils/conversion.ts`
  - `stripLayout` (Task 1) and `jsonEqual` from `ui/src/utils/jsonEqual.ts`
- Produces:
  - `buildProposalOverlay(nodes, edges, document, proposal, highlight): ProposalOverlay`
  - `proposalCounts(status): ProposalCounts`
  - `formatCounts(counts): string`
  - `validationText(delta): string`
  - `proposalDetails(document, preview, id): ProposalDetails | null`
  - `<ProposalReviewBar>`

- [ ] **Step 1: Write the failing tests `ui/src/changeset/proposalOverlay.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildProposalOverlay, formatCounts, proposalCounts, proposalDetails, validationText } from './proposalOverlay.ts';
import { changeStatus } from './changeStatus.ts';
import { toReactFlowEdges, toReactFlowNodes } from '../utils/conversion.ts';
import type { StagedProposal } from './types.ts';
import type { Workflow } from '../types/workflow.ts';

const current: Workflow = { id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', name: 'A', config: {}, position: { x: 200, y: 0 } },
    { id: 'x', type: 'end', name: 'X', config: {}, position: { x: 400, y: 0 } },
], edges: [{ id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false },
    { id: 'ax', source: 'a', target: 'x', priority: 0, isDefault: false }] };
const preview: Workflow = { ...current, nodes: [
    current.nodes[0], { ...current.nodes[1], name: 'A2' },
    { id: 'n', type: 'end', name: 'N', config: {}, position: { x: 400, y: 100 } },
], edges: [current.edges[0], { id: 'an', source: 'a', target: 'n', priority: 0, isDefault: false }] };
const proposal = (stale = false): StagedProposal => ({ preview, stale,
    changeSet: { id: 'c', baseRevision: 'r', author: 'agent:t', summary: 'S', ops: [] } });
const rfNodes = () => toReactFlowNodes(current.nodes);
const rfEdges = () => toReactFlowEdges(current.edges);

describe('buildProposalOverlay', () => {
    it('marks modified and removed elements and adds non-interactive ghosts', () => {
        const overlay = buildProposalOverlay(rfNodes(), rfEdges(), current, proposal(), null);
        const byId = Object.fromEntries(overlay.nodes.map(node => [node.id, node]));
        expect(byId.s.className ?? '').not.toContain('flow-proposal');
        expect(byId.a.className).toContain('flow-proposal--modified');
        expect(byId.x.className).toContain('flow-proposal--removed');
        expect(byId.n).toMatchObject({ draggable: false, deletable: false, connectable: false, selectable: false });
        expect(byId.n.className).toContain('flow-proposal--added');
        expect(overlay.edges.find(edge => edge.id === 'an')?.className).toContain('flow-proposal--added');
        expect(overlay.edges.find(edge => edge.id === 'ax')?.className).toContain('flow-proposal--removed');
    });

    it('adds a stale modifier', () => {
        const overlay = buildProposalOverlay(rfNodes(), rfEdges(), current, proposal(true), null);
        expect(overlay.nodes.find(node => node.id === 'a')?.className).toContain('flow-proposal--stale');
    });

    it('applies the highlight only when no proposal is staged', () => {
        const highlight = { nodeIds: ['a'], edgeIds: ['sa'] };
        const plain = buildProposalOverlay(rfNodes(), rfEdges(), current, null, highlight);
        expect(plain.status).toBeNull();
        expect(plain.nodes.find(node => node.id === 'a')?.className).toContain('flow-applied');
        expect(plain.edges.find(edge => edge.id === 'sa')?.className).toContain('flow-applied');
        const staged = buildProposalOverlay(rfNodes(), rfEdges(), current, proposal(), highlight);
        expect(staged.nodes.find(node => node.id === 'a')?.className).not.toContain('flow-applied');
    });
});

describe('review bar text', () => {
    it('counts and formats changes', () => {
        expect(formatCounts(proposalCounts(changeStatus(current, preview))))
            .toBe('+1 node, +1 edge, ~1 node, −1 node, −1 edge');
        expect(formatCounts(proposalCounts(changeStatus(current, current)))).toBe('No changes');
    });

    it('describes the validation delta', () => {
        const problem = { severity: 'error' as const, code: 'X', message: 'm' };
        expect(validationText({ introduced: [], fixed: [] })).toBe('No validation changes');
        expect(validationText({ introduced: [problem, problem], fixed: [problem] })).toBe('Introduces 2 problems, fixes 1 problem');
        expect(validationText({ introduced: [], fixed: [problem] })).toBe('Fixes 1 problem');
    });
});

describe('proposalDetails', () => {
    it('returns before and after without positions, or null when unchanged', () => {
        expect(proposalDetails(current, preview, 'a')).toEqual({ id: 'a', kind: 'node',
            before: { id: 'a', type: 'action', name: 'A', config: {} }, after: { id: 'a', type: 'action', name: 'A2', config: {} } });
        expect(proposalDetails(current, preview, 'n')?.before).toBeNull();
        expect(proposalDetails(current, preview, 'ax')).toMatchObject({ kind: 'edge', after: null });
        expect(proposalDetails(current, preview, 's')).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/changeset/proposalOverlay.test.ts`

Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `ui/src/changeset/proposalOverlay.ts`**

```ts
import type { Edge, Node } from '@xyflow/react';
import type { Workflow, WorkflowNode } from '../types/workflow.ts';
import { toReactFlowEdges, toReactFlowNodes, type FlowNodeData } from '../utils/conversion.ts';
import { jsonEqual } from '../utils/jsonEqual.ts';
import { changeStatus, type ChangeKind, type ChangeStatusMap } from './changeStatus.ts';
import type { ValidationDelta } from './validationDelta.ts';
import type { Highlight, StagedProposal } from './types.ts';

/** Canvas elements to render plus the classification used to build them (null without a proposal). */
export interface ProposalOverlay {
    nodes: Node<FlowNodeData>[];
    edges: Edge[];
    status: ChangeStatusMap | null;
}

type CountedKind = 'added' | 'modified' | 'removed';

/** Number of added, modified and removed nodes and edges. */
export interface ProposalCounts {
    nodes: Record<CountedKind, number>;
    edges: Record<CountedKind, number>;
}

/** Read-only before/after of one proposal element, without layout. */
export interface ProposalDetails {
    id: string;
    kind: 'node' | 'edge';
    before: unknown;
    after: unknown;
}

const withClass = (existing: string | undefined, extra: string) => [existing, extra].filter(Boolean).join(' ');

/**
 * Decorates the editor's canvas elements with the staged proposal (ghost additions, modified and removed
 * markers) or, with no proposal, with the applied-change highlight.
 *
 * @param nodes the editor's display nodes
 * @param edges the editor's display edges
 * @param document the current workflow
 * @param proposal the staged proposal, if any
 * @param highlight the applied-change highlight, if any and enabled
 * @returns the elements to hand to React Flow
 */
export function buildProposalOverlay(nodes: Node<FlowNodeData>[], edges: Edge[], document: Workflow,
    proposal: StagedProposal | null, highlight: Highlight | null): ProposalOverlay {
    if (!proposal) {
        if (!highlight) return { nodes, edges, status: null };
        const nodeIds = new Set(highlight.nodeIds);
        const edgeIds = new Set(highlight.edgeIds);
        return {
            nodes: nodes.map(node => nodeIds.has(node.id) ? { ...node, className: withClass(node.className, 'flow-applied') } : node),
            edges: edges.map(edge => edgeIds.has(edge.id) ? { ...edge, className: withClass(edge.className, 'flow-applied') } : edge),
            status: null,
        };
    }
    const status = changeStatus(document, proposal.preview);
    const stale = proposal.stale ? ' flow-proposal--stale' : '';
    const marker = (kind: ChangeKind | undefined) =>
        kind === 'modified' || kind === 'removed' ? `flow-proposal flow-proposal--${kind}${stale}` : undefined;
    const ghost = { draggable: false, deletable: false, connectable: false, selectable: false, focusable: false };
    return {
        nodes: [
            ...nodes.map(node => {
                const cls = marker(status.nodes[node.id]);
                return cls ? { ...node, className: withClass(node.className, cls) } : node;
            }),
            ...toReactFlowNodes(proposal.preview.nodes.filter(node => status.nodes[node.id] === 'added'))
                .map(node => ({ ...node, ...ghost, className: `flow-proposal flow-proposal--added${stale}` })),
        ],
        edges: [
            ...edges.map(edge => {
                const cls = marker(status.edges[edge.id]);
                return cls ? { ...edge, className: withClass(edge.className, cls) } : edge;
            }),
            ...toReactFlowEdges(proposal.preview.edges.filter(edge => status.edges[edge.id] === 'added'))
                .map(edge => ({ ...edge, deletable: false, selectable: false, focusable: false,
                    className: `flow-proposal flow-proposal--added${stale}` })),
        ],
        status,
    };
}

/**
 * Counts changed elements by kind.
 *
 * @param status the classification map
 * @returns the counts
 */
export function proposalCounts(status: ChangeStatusMap): ProposalCounts {
    const count = (map: Record<string, ChangeKind>) => {
        const result: Record<CountedKind, number> = { added: 0, modified: 0, removed: 0 };
        Object.values(map).forEach(kind => { if (kind !== 'unchanged') result[kind] += 1; });
        return result;
    };
    return { nodes: count(status.nodes), edges: count(status.edges) };
}

/**
 * Formats counts like `+1 node, +2 edges, ~1 node, −1 edge`.
 *
 * @param counts the counts
 * @returns the summary, or `No changes`
 */
export function formatCounts(counts: ProposalCounts): string {
    const parts: string[] = [];
    for (const [kind, symbol] of [['added', '+'], ['modified', '~'], ['removed', '−']] as const) {
        for (const what of ['nodes', 'edges'] as const) {
            const n = counts[what][kind];
            if (n) parts.push(`${symbol}${n} ${n === 1 ? what.slice(0, -1) : what}`);
        }
    }
    return parts.length ? parts.join(', ') : 'No changes';
}

/**
 * Describes a validation delta for the review bar.
 *
 * @param delta introduced and fixed problems
 * @returns a sentence such as `Introduces 2 problems, fixes 1 problem`
 */
export function validationText(delta: ValidationDelta): string {
    const plural = (n: number) => `${n} problem${n === 1 ? '' : 's'}`;
    const parts = [
        delta.introduced.length ? `introduces ${plural(delta.introduced.length)}` : '',
        delta.fixed.length ? `fixes ${plural(delta.fixed.length)}` : '',
    ].filter(Boolean);
    if (!parts.length) return 'No validation changes';
    const text = parts.join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function withoutPosition(node: WorkflowNode | undefined): unknown {
    if (!node) return null;
    const copy: WorkflowNode = { ...node };
    delete copy.position;
    return copy;
}

/**
 * Builds the before/after view of a node or edge touched by a proposal.
 *
 * @param document the current workflow
 * @param preview the proposed workflow
 * @param id a node or edge id
 * @returns the details, or null when the element is unknown or only moved
 */
export function proposalDetails(document: Workflow, preview: Workflow, id: string): ProposalDetails | null {
    const beforeNode = document.nodes.find(node => node.id === id);
    const afterNode = preview.nodes.find(node => node.id === id);
    if (beforeNode || afterNode) {
        const before = withoutPosition(beforeNode);
        const after = withoutPosition(afterNode);
        return jsonEqual(before, after) ? null : { id, kind: 'node', before, after };
    }
    const before = document.edges.find(edge => edge.id === id) ?? null;
    const after = preview.edges.find(edge => edge.id === id) ?? null;
    if (!before && !after) return null;
    return jsonEqual(before, after) ? null : { id, kind: 'edge', before, after };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/changeset/proposalOverlay.test.ts`

Expected: PASS. If the count order or the minus sign differs, the test text is the source of truth; it uses
U+2212 `−`.

- [ ] **Step 5: Create `ui/src/components/panels/ProposalReviewBar.tsx`**

```tsx
import { Button } from '@patternfly/react-core';
import type { StagedProposal } from '../../changeset/types.ts';
import type { ProposalDetails } from '../../changeset/proposalOverlay.ts';

/** Props for {@link ProposalReviewBar}. */
export interface ProposalReviewBarProps {
  proposal: StagedProposal;
  counts: string;
  validation: string;
  details: ProposalDetails | null;
  onAccept: () => void;
  onReject: () => void;
}

const show = (value: unknown, missing: string) => (value === null ? missing : JSON.stringify(value, null, 2));

/** Floating review bar for the staged proposal: summary, counts, validation delta and accept/reject. */
export function ProposalReviewBar({ proposal, counts, validation, details, onAccept, onReject }: ProposalReviewBarProps) {
  return (
    <div className="flow-proposal-bar" role="region" aria-label="Proposed changes">
      <div className="flow-proposal-bar__summary">
        <strong>{proposal.changeSet.summary}</strong>
        <span className="flow-proposal-bar__author">{proposal.changeSet.author}</span>
        <span className="flow-proposal-bar__counts">{counts}</span>
        {proposal.stale
          ? <span className="flow-proposal-bar__stale" role="status">Out of date</span>
          : <span className="flow-proposal-bar__validation">{validation}</span>}
      </div>
      <div className="flow-proposal-bar__actions">
        {proposal.stale ? (
          <Button variant="secondary" size="sm" onClick={onReject}>Dismiss</Button>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={onAccept}>Accept</Button>
            <Button variant="secondary" size="sm" onClick={onReject}>Reject</Button>
          </>
        )}
      </div>
      {details && (
        <div className="flow-proposal-bar__details" role="group" aria-label={`Proposed change to ${details.id}`}>
          <div><h4>Before</h4><pre>{show(details.before, '(new)')}</pre></div>
          <div><h4>After</h4><pre>{show(details.after, '(removed)')}</pre></div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Integrate the overlay into `WorkflowEditor.tsx`**

1. Add these imports:
   - `buildProposalOverlay`, `formatCounts`, `proposalCounts`, `proposalDetails` and `validationText` from
     `../changeset/proposalOverlay.ts`
   - `validationDelta` from `../changeset/validationDelta.ts`
   - `ProposalReviewBar` from `./panels/ProposalReviewBar.tsx`

2. Destructure `highlightApplied = true` if you deferred it in Task 9.

3. Compute the preview problems. Put this after the `validationProblems` memo, and compute the preview's
   built-in problems *exactly* like `builtInProblems` and `validationProblems` are computed for the current
   document. If those memos also merge `parallelAnalysis` problems, apply the same merge to the preview.
   Otherwise the delta reports false "fixes".

```tsx
  const proposal = state.proposal;
  const previewBuiltInProblems = useMemo(
    () => (proposal ? validateWorkflow(proposal.preview) : []),
    [proposal],
  );
  const previewHostProblems = useHostValidation(proposal?.preview ?? semanticWorkflow, proposal ? spi?.validate : undefined);
  const proposalValidation = useMemo(
    () => validationText(validationDelta(validationProblems, [...previewBuiltInProblems, ...previewHostProblems])),
    [validationProblems, previewBuiltInProblems, previewHostProblems],
  );
```

4. Compute the overlay and the focused element. Put this after `displayEdges`:

```tsx
  const overlay = useMemo(
    () => buildProposalOverlay(displayNodes, displayEdges, currentWorkflow, proposal, highlightApplied ? state.highlight : null),
    [displayNodes, displayEdges, currentWorkflow, proposal, highlightApplied, state.highlight],
  );
  // Focus is tied to a proposal id so it resets automatically when the proposal changes.
  const [proposalFocus, setProposalFocus] = useState<{ proposalId: string; elementId: string } | null>(null);
  const focusedDetails = proposal && proposalFocus?.proposalId === proposal.changeSet.id
    ? proposalDetails(currentWorkflow, proposal.preview, proposalFocus.elementId) : null;
  const focusProposalElement = useCallback((id: string, kind: 'nodes' | 'edges') => {
    const changed = overlay.status && overlay.status[kind][id] && overlay.status[kind][id] !== 'unchanged';
    setProposalFocus(changed && proposal ? { proposalId: proposal.changeSet.id, elementId: id } : null);
    return overlay.status?.[kind][id] === 'added';
  }, [overlay.status, proposal]);
```

5. Wrap the existing click handlers. Keep their exact parameter types and use the same signature as the
   existing `onNodeClick`/`onEdgeClick`:

```tsx
  const onCanvasNodeClick: typeof onNodeClick = useCallback((event, node) => {
    if (!focusProposalElement(node.id, 'nodes')) onNodeClick(event, node);
  }, [focusProposalElement, onNodeClick]);
  const onCanvasEdgeClick: typeof onEdgeClick = useCallback((event, edge) => {
    if (!focusProposalElement(edge.id, 'edges')) onEdgeClick(event, edge);
  }, [focusProposalElement, onEdgeClick]);
```

6. In the `<ReactFlow>` element, change `nodes={displayNodes}` to `nodes={overlay.nodes}`,
   `edges={displayEdges}` to `edges={overlay.edges}`, `onNodeClick={onNodeClick}` to
   `onNodeClick={onCanvasNodeClick}`, and `onEdgeClick={onEdgeClick}` to `onEdgeClick={onCanvasEdgeClick}`.

7. Render the bar inside `<div className="workflow-editor__canvas ...">`, right after the closing
   `</ReactFlow>`:

```tsx
          {proposal && !readOnly && (
            <ProposalReviewBar
              proposal={proposal}
              counts={formatCounts(proposalCounts(overlay.status!))}
              validation={proposalValidation}
              details={focusedDetails}
              onAccept={() => dispatch({ type: 'acceptProposal' })}
              onReject={() => dispatch({ type: 'rejectProposal' })}
            />
          )}
```

- [ ] **Step 7: Add the styles to `ui/src/components/WorkflowEditor.css`**

```css
/* AI-assisted editing: staged proposal overlay */
.workflow-editor__canvas { position: relative; }
.react-flow__node.flow-proposal--added { opacity: 0.8; outline: 2px dashed var(--flow-status-success, #3e8635); outline-offset: 3px; }
.react-flow__node.flow-proposal--modified { outline: 2px solid var(--flow-brand, #06c); outline-offset: 3px; }
.react-flow__node.flow-proposal--removed { opacity: 0.45; outline: 2px dashed var(--flow-status-danger, #c9190b); outline-offset: 3px; }
.react-flow__edge.flow-proposal--added .react-flow__edge-path { stroke: var(--flow-status-success, #3e8635); stroke-width: 2.5; stroke-dasharray: 6 3; }
.react-flow__edge.flow-proposal--removed .react-flow__edge-path { stroke: var(--flow-status-danger, #c9190b); stroke-dasharray: 5 3; opacity: 0.6; }
.flow-proposal--stale { filter: grayscale(1); }

/* Elements changed by the most recently applied change set */
.react-flow__node.flow-applied { box-shadow: 0 0 0 3px var(--flow-brand, #06c); border-radius: 6px; }
.react-flow__edge.flow-applied .react-flow__edge-path { stroke: var(--flow-brand, #06c); stroke-width: 2.5; }

.flow-proposal-bar {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 5;
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; max-width: min(90%, 720px);
  padding: 8px 12px; border-radius: 8px; background: var(--flow-surface, #fff);
  border: 1px solid var(--flow-border, #d2d2d2); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.flow-proposal-bar__summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
.flow-proposal-bar__author, .flow-proposal-bar__counts, .flow-proposal-bar__validation { font-size: 0.85em; opacity: 0.8; }
.flow-proposal-bar__stale { font-weight: 600; color: var(--flow-status-warning, #f0ab00); }
.flow-proposal-bar__actions { display: flex; gap: 8px; margin-left: auto; }
.flow-proposal-bar__details { flex-basis: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.flow-proposal-bar__details pre { max-height: 200px; overflow: auto; margin: 0; font-size: 0.8em; }
```

If `.workflow-editor__canvas` already has a `position`, drop the first rule. Use the theme variables already
defined in `theme.css` where their names differ.

- [ ] **Step 8: Run everything**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ui/src
git commit -m "Render staged proposals, review bar and applied-change highlight"
```

---

### Task 11: Browser harness, end-to-end tests and documentation

**Files:**
- Modify:
  - `ui/browser/host.tsx`
  - `mkdocs.yml`
  - `conformance/README.md`
- Create:
  - `ui/browser/ai-editing.spec.ts`
  - `docs/user-guide/ai-assisted-editing.md`

**Interfaces:**
- Consumes:
  - The public exports from Task 9: `WorkflowEditorHandle`, `ChangeSet` and the `ref` /
    `onProposalResolved` props

- [ ] **Step 1: Add the AI controls to `ui/browser/host.tsx`**

1. Add `type WorkflowEditorHandle` and `type ChangeSet` to the existing import from `'../src/index.ts'`.
2. Add `useRef` to the React import.
3. In `EditorHost`, add the following:

```tsx
    const editorRef = useRef<WorkflowEditorHandle>(null);
    const [handleResults, setHandleResults] = useState<string[]>([]);
    const [resolutions, setResolutions] = useState<string[]>([]);
    const insertWait = (id: string): ChangeSet => ({ id, author: 'agent:demo', summary: 'Add a wait before End',
        baseRevision: editorRef.current!.getSnapshot().contentRevision, ops: [
            { op: 'removeEdge', id: 'he' },
            { op: 'addNode', node: { id: 'w', type: 'wait', name: 'Wait', config: { duration: 'PT1M' } } },
            { op: 'addEdge', edge: { id: 'hw', source: 'h', target: 'w', priority: 0, isDefault: false } },
            { op: 'addEdge', edge: { id: 'we', source: 'w', target: 'e', priority: 0, isDefault: false } },
        ] });
    const record = (result: unknown) => setHandleResults(previous => [...previous, JSON.stringify(result)]);
```

4. Inside the `<nav>`, add:

```tsx
            {params.has('ai') && <>
                <button onClick={() => record(editorRef.current!.propose(insertWait('cs-1')))}>Propose change</button>
                <button onClick={() => record(editorRef.current!.apply(insertWait('cs-2')))}>Apply change</button>
                <button onClick={() => record(editorRef.current!.propose({ ...insertWait('cs-3'), baseRevision: 'sha256:old' }))}>
                    Propose stale change</button>
                <button onClick={() => editorRef.current!.withdraw('cs-1')}>Withdraw change</button>
            </>}
```

5. On `<WorkflowEditor ...>`, add:

```tsx
ref={editorRef} onProposalResolved={(id, outcome) => setResolutions(previous => [...previous, `${id}:${outcome}`])}
```

6. After the existing `<output>` elements, add:

```tsx
        <output data-testid="handle-results">{JSON.stringify(handleResults)}</output>
        <output data-testid="proposal-resolutions">{JSON.stringify(resolutions)}</output>
```

- [ ] **Step 2: Write `ui/browser/ai-editing.spec.ts`**

```ts
import { test, expect, ready } from './test.ts';

const node = (editor: import('@playwright/test').Locator, id: string) => editor.locator(`.react-flow__node[data-id="${id}"]`);

test('a staged proposal previews, accepts as one undo step and stays highlighted', async ({ page }) => {
    await page.goto('/?ai');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('button', { name: 'Propose change' }).click();
    const bar = editor.getByRole('region', { name: 'Proposed changes' });
    await expect(bar).toContainText('Add a wait before End');
    await expect(bar).toContainText('+1 node');
    await expect(node(editor, 'w')).toHaveClass(/flow-proposal--added/);
    await node(editor, 'w').click();
    await expect(bar.getByRole('group', { name: 'Proposed change to w' })).toContainText('PT1M');
    await bar.getByRole('button', { name: 'Accept' }).click();
    await expect(bar).toBeHidden();
    await expect(node(editor, 'w')).toHaveClass(/flow-applied/);
    await expect(editor.getByTestId('proposal-resolutions')).toHaveText('["cs-1:accepted"]');
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(node(editor, 'w')).toHaveCount(0);
});

test('a user edit makes a staged proposal stale and it can only be dismissed', async ({ page }) => {
    await page.goto('/?ai');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('button', { name: 'Propose change' }).click();
    await node(editor, 'a').click();
    await page.keyboard.press('Delete');
    const bar = editor.getByRole('region', { name: 'Proposed changes' });
    await expect(bar).toContainText('Out of date');
    await expect(bar.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(editor.getByTestId('proposal-resolutions')).toHaveText('["cs-1:stale"]');
    await bar.getByRole('button', { name: 'Dismiss' }).click();
    await expect(bar).toBeHidden();
});

test('rejecting removes the ghosts and stale change sets are refused with a code', async ({ page }) => {
    await page.goto('/?ai');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('button', { name: 'Propose stale change' }).click();
    await expect(editor.getByTestId('handle-results')).toContainText('\\"code\\":\\"stale\\"');
    await editor.getByRole('button', { name: 'Propose change' }).click();
    await editor.getByRole('region', { name: 'Proposed changes' }).getByRole('button', { name: 'Reject' }).click();
    await expect(node(editor, 'w')).toHaveCount(0);
    await expect(editor.getByTestId('proposal-resolutions')).toHaveText('["cs-1:rejected"]');
});

test('an applied change set is highlighted until the user edits content', async ({ page }) => {
    await page.goto('/?ai');
    const editor = page.getByTestId('one');
    await ready(editor);
    await editor.getByRole('button', { name: 'Apply change' }).click();
    await expect(node(editor, 'w')).toHaveClass(/flow-applied/);
    await node(editor, 'a').click();
    await page.keyboard.press('Delete');
    await expect(node(editor, 'w')).not.toHaveClass(/flow-applied/);
});
```

- [ ] **Step 3: Run the browser suite**

Run from `ui/`: `npm run test:browser -- ai-editing.spec.ts`

Expected: 4 passed.

If the Delete key does not delete the clicked node in this harness, check how `editor.spec.ts` deletes a
node and use the same gesture.

Then run the whole browser suite: `npm run test:browser`. Expected: PASS. The `?ai` controls appear only
with that parameter, so existing specs are unaffected.

- [ ] **Step 4: Verify manually in Chrome**

1. Start the browser host the way the Playwright config does. Check `ui/playwright.config.ts` for its
   `webServer` command and port.
2. Open `/?ai` with the Chrome DevTools MCP.
3. Propose, inspect a ghost node, accept and undo.
4. Confirm the review bar does not cover the toolbar, and that the overlay is readable in both the light and
   dark themes.

- [ ] **Step 5: Write `docs/user-guide/ai-assisted-editing.md`**

Wrap lines at 110 characters. Cover each of the following, with one short TypeScript example per section:

1. **Overview:** the host or agent stays outside Flow, and change sets are the editing primitive.
2. **Content revisions:**
   - The format (`sha256:` + JCS, positions stripped).
   - Hash exactly the document you send to the editor.
   - Java `ContentRevision.of`.
3. **Change sets:**
   - The op table.
   - Patch semantics: shallow merge, `unset`, `null` stored as a value.
   - An example of removing one input by resending the whole `inputs` mapping.
   - The error codes.
   - Java `ChangeSets.applyChecked`.
4. **The editor handle:** `propose`, `apply`, `withdraw`, `replace`, `clearHighlights`, `getSnapshot`.
5. **Review UX:**
   - One staged proposal at a time; staleness rules.
   - Accept/Reject/Dismiss; the validation delta.
   - The applied highlight and `highlightApplied`.
6. **Events:** `onChange(workflow, { contentRevision, origin })`, `onProposalResolved`,
   `onSelectionChange`.
7. **Read-only behaviour.**

- [ ] **Step 6: Update the navigation and the conformance README**

In `mkdocs.yml`, add `- AI-assisted editing: user-guide/ai-assisted-editing.md` to the user-guide nav,
directly after the workflow-diff entry.

In `conformance/README.md`, add entries for `content-revision.json` (hash vectors) and `changesets.json`
(change-set vectors; `"@current"` base revision placeholder; expected workflows compared without layout).
Follow the existing list format.

- [ ] **Step 7: Run the docs check if the repo has one**

Check `docs/developer-guide/documentation-checks.md` for the command and run it.

Expected: PASS.

- [ ] **Step 8: Final full verification**

Run from `ui/`: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build && npm run test:browser`

Run from `engine/`: `./mvnw -q test`

Expected: everything passes.

- [ ] **Step 9: Commit**

```bash
git add ui/browser docs/user-guide/ai-assisted-editing.md mkdocs.yml conformance/README.md
git commit -m "Add AI-assisted editing browser tests and user guide"
```
