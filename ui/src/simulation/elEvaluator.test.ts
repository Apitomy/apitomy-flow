import { describe, it, expect } from 'vitest';
import {
    evaluateCondition,
    resolveExpression,
    isValidExpression,
    ElEvaluationError,
    type ElScope,
} from './elEvaluator.ts';

/**
 * Parity tests for the browser EL evaluator. Every case here mirrors an assertion in the Java
 * engine's ConditionEvaluatorTest so the two implementations cannot silently diverge. Additional
 * cases cover EL coercion and keyword operators that the simulation relies on.
 */

function scope(context: Record<string, unknown>, event?: Record<string, unknown>): ElScope {
    return { context, event };
}

describe('evaluateCondition — parity with ConditionEvaluatorTest', () => {
    it('null condition returns true', () => {
        expect(evaluateCondition(null, scope({}))).toBe(true);
    });

    it('empty condition returns true', () => {
        expect(evaluateCondition('', scope({}))).toBe(true);
    });

    it('blank condition returns true', () => {
        expect(evaluateCondition('   ', scope({}))).toBe(true);
    });

    it('simple equality', () => {
        const s = scope({ status: 'active' });
        expect(evaluateCondition("context.status == 'active'", s)).toBe(true);
        expect(evaluateCondition("context.status == 'inactive'", s)).toBe(false);
    });

    it('nested map access', () => {
        const s = scope({ result: { status: 'affected' } });
        expect(evaluateCondition("context.result.status == 'affected'", s)).toBe(true);
        expect(evaluateCondition("context.result.status == 'clean'", s)).toBe(false);
    });

    it('numeric comparison', () => {
        const s = scope({ score: 85 });
        expect(evaluateCondition('context.score > 80', s)).toBe(true);
        expect(evaluateCondition('context.score > 90', s)).toBe(false);
    });

    it('boolean logic', () => {
        const s = scope({ a: true, b: false });
        expect(evaluateCondition('context.a && !context.b', s)).toBe(true);
        expect(evaluateCondition('context.a && context.b', s)).toBe(false);
    });

    it('null-safe access (missing key is null)', () => {
        const s = scope({ key: 'value' });
        expect(evaluateCondition('context.missing != null', s)).toBe(false);
    });

    it('invalid expression throws', () => {
        expect(() => evaluateCondition('this is not valid EL !!!', scope({}))).toThrow(ElEvaluationError);
    });

    it('evaluate with context and event', () => {
        const s = scope(
            { repository: 'apitomy/axiom' },
            { repository: 'apitomy/axiom', action: 'merged' },
        );
        expect(evaluateCondition('event.repository == context.repository', s)).toBe(true);
        expect(evaluateCondition("event.action == 'merged'", s)).toBe(true);
        expect(evaluateCondition("event.action == 'closed'", s)).toBe(false);
    });

    it('evaluate with nested event', () => {
        const s = scope({ prNumber: 42 }, { pull_request: { number: 42 } });
        expect(evaluateCondition('event.pull_request.number == context.prNumber', s)).toBe(true);
    });

    it('nested object access (parsed JSON)', () => {
        const payload = {
            repository: 'apitomy/flow',
            pull_request: { number: 42, author: { login: 'alice' }, merged: true },
            labels: ['bug', 'urgent'],
        };
        const s = scope({ eventPayload: payload });
        expect(evaluateCondition("context.eventPayload.repository == 'apitomy/flow'", s)).toBe(true);
        expect(evaluateCondition('context.eventPayload.pull_request.number == 42', s)).toBe(true);
        expect(evaluateCondition("context.eventPayload.pull_request.author.login == 'alice'", s)).toBe(true);
        expect(evaluateCondition('context.eventPayload.pull_request.merged', s)).toBe(true);
    });

    it('array access via bracket notation', () => {
        const s = scope({ eventPayload: { labels: ['bug', 'urgent'] } });
        expect(evaluateCondition("context.eventPayload.labels[0] == 'bug'", s)).toBe(true);
        expect(evaluateCondition("context.eventPayload.labels[1] == 'urgent'", s)).toBe(true);
    });

    it('array access via dot notation is unsupported (throws)', () => {
        const s = scope({ eventPayload: { labels: ['bug', 'urgent'] } });
        expect(() => evaluateCondition("context.eventPayload.labels.0 == 'bug'", s)).toThrow(ElEvaluationError);
    });

    it('non-boolean result coerces to false (matches Boolean.TRUE.equals)', () => {
        const s = scope({ name: 'Alice' });
        // A bare string result is not boolean true.
        expect(evaluateCondition('context.name', s)).toBe(false);
    });
});

describe('resolveExpression — parity with ConditionEvaluatorTest', () => {
    it('resolve returns value', () => {
        const s = scope({ name: 'Alice', score: 95 });
        expect(resolveExpression('context.name', s)).toBe('Alice');
        expect(resolveExpression('context.score', s)).toBe(95);
    });

    it('resolve nested value', () => {
        const s = scope({ loan: { amount: 50000, currency: 'USD' } });
        expect(resolveExpression('context.loan.amount', s)).toBe(50000);
        expect(resolveExpression('context.loan.currency', s)).toBe('USD');
    });

    it('resolve null or blank returns null', () => {
        expect(resolveExpression(null, scope({}))).toBeNull();
        expect(resolveExpression('', scope({}))).toBeNull();
        expect(resolveExpression('   ', scope({}))).toBeNull();
    });

    it('resolve invalid expression throws', () => {
        expect(() => resolveExpression('this is not valid !!!', scope({}))).toThrow(ElEvaluationError);
    });
});

describe('EL coercion and keyword operators', () => {
    it('numeric coercion in equality (number vs numeric string)', () => {
        expect(evaluateCondition("context.score == '85'", scope({ score: 85 }))).toBe(true);
        expect(evaluateCondition("context.score == '86'", scope({ score: 85 }))).toBe(false);
    });

    it('comparison operators', () => {
        const s = scope({ n: 10 });
        expect(evaluateCondition('context.n >= 10', s)).toBe(true);
        expect(evaluateCondition('context.n <= 9', s)).toBe(false);
        expect(evaluateCondition('context.n < 20', s)).toBe(true);
    });

    it('relational operators against null are false', () => {
        const s = scope({});
        expect(evaluateCondition('context.missing > 5', s)).toBe(false);
        expect(evaluateCondition('context.missing < 5', s)).toBe(false);
        expect(evaluateCondition('context.missing >= 5', s)).toBe(false);
        expect(evaluateCondition('context.missing <= 5', s)).toBe(false);
    });

    it('keyword operators (and, or, not, eq, ne, gt, lt)', () => {
        const s = scope({ a: true, b: false, score: 85 });
        expect(evaluateCondition('context.a and not context.b', s)).toBe(true);
        expect(evaluateCondition('context.a or context.b', s)).toBe(true);
        expect(evaluateCondition("context.score gt 80", s)).toBe(true);
        expect(evaluateCondition("context.score lt 80", s)).toBe(false);
        expect(evaluateCondition("context.score eq 85", s)).toBe(true);
        expect(evaluateCondition("context.score ne 85", s)).toBe(false);
    });

    it('empty operator', () => {
        expect(evaluateCondition('empty context.missing', scope({}))).toBe(true);
        expect(evaluateCondition('empty context.list', scope({ list: [] }))).toBe(true);
        expect(evaluateCondition('empty context.list', scope({ list: [1] }))).toBe(false);
        expect(evaluateCondition('empty context.str', scope({ str: '' }))).toBe(true);
        expect(evaluateCondition('empty context.str', scope({ str: 'x' }))).toBe(false);
    });

    it('arithmetic', () => {
        expect(resolveExpression('context.a + context.b', scope({ a: 2, b: 3 }))).toBe(5);
        expect(resolveExpression('context.a * 2', scope({ a: 4 }))).toBe(8);
        expect(resolveExpression('10 mod 3', scope({}))).toBe(1);
        expect(resolveExpression('10 div 4', scope({}))).toBe(2.5);
    });

    it('parentheses and precedence', () => {
        const s = scope({ a: 1, b: 2, c: 3 });
        expect(evaluateCondition('(context.a + context.b) == context.c', s)).toBe(true);
        expect(evaluateCondition('context.a + context.b == context.c', s)).toBe(true);
        expect(evaluateCondition('context.a == 1 || context.b == 99 && context.c == 99', s)).toBe(true);
    });

    it('bracket access with string key', () => {
        const s = scope({ map: { 'a-b': 'hit' } });
        expect(evaluateCondition("context.map['a-b'] == 'hit'", s)).toBe(true);
    });
});

describe('isValidExpression', () => {
    it('accepts valid expressions and blanks', () => {
        expect(isValidExpression("context.status == 'active'")).toBe(true);
        expect(isValidExpression('')).toBe(true);
        expect(isValidExpression(null)).toBe(true);
        expect(isValidExpression('context.a && context.b')).toBe(true);
    });

    it('rejects malformed expressions', () => {
        expect(isValidExpression('this is not valid !!!')).toBe(false);
        expect(isValidExpression("context.status == 'unterminated")).toBe(false);
        expect(isValidExpression('context.(bad)')).toBe(false);
        expect(isValidExpression('context.a &&')).toBe(false);
    });
});
