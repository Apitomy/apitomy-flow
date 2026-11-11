import { describe, it, expect } from 'vitest';
import { parseTextTemplate, classifyTextTemplate, renderTextTemplate } from './textTemplate.ts';
import type { WorkflowNode } from '../types/workflow.ts';
import { taskBody } from './simulate.ts';

function task(config: Record<string, unknown>): WorkflowNode {
    return { id: 't', type: 'human-task', name: 'Task', config, position: { x: 0, y: 0 } } as WorkflowNode;
}

describe('parseTextTemplate', () => {
    it('splits literal text and expressions, honoring quotes, nested braces and \\${ escapes', () => {
        expect(parseTextTemplate("A ${context.x} B ${'}'} \\${lit} {x}")).toEqual([
            { text: 'A ', expression: false },
            { text: 'context.x', expression: true },
            { text: ' B ', expression: false },
            { text: "'}'", expression: true },
            { text: ' ${lit} {x}', expression: false },
        ]);
    });

    it('throws on unterminated or empty expressions', () => {
        expect(() => parseTextTemplate('Hi ${context.x')).toThrow();
        expect(() => parseTextTemplate('Hi ${ }')).toThrow();
    });
});

describe('classifyTextTemplate', () => {
    it('accepts plain text and valid expressions', () => {
        expect(classifyTextTemplate('# Title\n\n${context.a} and {braces}')).toBe('supported');
    });

    it('rejects unterminated templates and invalid expressions', () => {
        expect(classifyTextTemplate('Hi ${context.x')).toBe('invalid');
        expect(classifyTextTemplate("Hi ${'a' +=}")).toBe('invalid');
    });

    it('reports engine-only syntax as unsupported', () => {
        expect(classifyTextTemplate('Hi ${context.items.stream().count()}')).toBe('unsupported');
    });
});

describe('renderTextTemplate', () => {
    it('renders null results as empty strings and converts other values to text', () => {
        const values: Record<string, unknown> = { a: 42, b: null };
        expect(renderTextTemplate('${a}|${b}|', e => values[e])).toBe('42||');
    });
});

describe('taskBody', () => {
    it('interpolates the body against the context', () => {
        expect(taskBody(task({ body: '## ${context.id}\n**${context.sev}**' }), { id: 'X', sev: 'high' }))
            .toBe('## X\n**high**');
    });

    it('renders failing expressions empty', () => {
        expect(taskBody(task({ body: 'A ${context.missing.deep} B' }), {})).toBe('A  B');
    });

    it('falls back to the description when absent, blank or unparseable', () => {
        expect(taskBody(task({ description: 'd' }), {})).toBe('d');
        expect(taskBody(task({ description: 'd', body: '  ' }), {})).toBe('d');
        expect(taskBody(task({ description: 'd', body: 'Hi ${context.x' }), {})).toBe('d');
        expect(taskBody(task({}), {})).toBeUndefined();
    });
});
