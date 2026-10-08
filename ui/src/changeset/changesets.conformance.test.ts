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
