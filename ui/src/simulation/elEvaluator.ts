/**
 * A small, dependency-free evaluator for the subset of Jakarta EL used by workflow edge
 * conditions and node input expressions. It exists so the editor can simulate routing and test
 * conditions in the browser with semantics that match the Java engine's
 * {@code io.apitomy.flow.engine.ConditionEvaluator} (which delegates to a real Jakarta
 * {@code ELProcessor}). Parity is enforced by tests that mirror {@code ConditionEvaluatorTest}.
 *
 * Supported grammar:
 *  - property access (`a.b.c`) and bracket access (`a[0]`, `a['k']`) over plain JS objects/arrays;
 *  - comparison `== != < > <= >=` and their EL keyword aliases `eq ne lt gt le ge`;
 *  - logical `&& || !` and aliases `and or not`;
 *  - arithmetic `+ - * / %` and aliases `div mod`, plus unary minus;
 *  - the `empty` operator;
 *  - literals: single/double-quoted strings, numbers, `true`, `false`, `null`;
 *  - the `context` and (optionally) `event` root beans.
 *
 * The browser context is already plain parsed JSON, so the engine's `JsonNodeELResolver` has no
 * analog here — plain object/array navigation is sufficient.
 */

/** The root beans an expression may reference, matching the engine's `defineBean` calls. */
export interface ElScope {
    /** The workflow instance context. Referenced as `context` in expressions. */
    context: Record<string, unknown>;
    /** An optional event payload. Referenced as `event` in expressions. */
    event?: Record<string, unknown>;
}

/**
 * Thrown when an expression cannot be parsed or evaluated. Mirrors the engine's
 * {@code ConditionEvaluationException}: it carries the offending expression so callers can tie
 * the failure to a specific node/edge.
 */
export class ElEvaluationError extends Error {
    readonly expression: string;

    constructor(expression: string, message: string) {
        super(`Failed to evaluate expression "${expression}": ${message}`);
        this.name = 'ElEvaluationError';
        this.expression = expression;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluates an expression as a routing condition. A blank/undefined expression is `true` (an
 * unconditional edge), matching the engine. Only a genuine boolean `true` result is treated as
 * true — every other result type coerces to `false` — mirroring the engine's
 * `Boolean.TRUE.equals(result)` check.
 *
 * @throws ElEvaluationError if the expression is malformed or evaluation fails
 */
export function evaluateCondition(expression: string | null | undefined, scope: ElScope): boolean {
    if (expression == null || expression.trim() === '') {
        return true;
    }
    const value = resolveExpression(expression, scope);
    return value === true;
}

/**
 * Resolves an expression to its raw value. Used for node input resolution and for showing the
 * concrete value produced by an expression. A blank/undefined expression resolves to `null`,
 * matching the engine's `resolve`.
 *
 * @throws ElEvaluationError if the expression is malformed or evaluation fails
 */
export function resolveExpression(expression: string | null | undefined, scope: ElScope): unknown {
    if (expression == null || expression.trim() === '') {
        return null;
    }
    let ast: Node;
    try {
        ast = parse(expression);
    } catch (e) {
        throw new ElEvaluationError(expression, e instanceof Error ? e.message : String(e));
    }
    try {
        return evaluate(ast, scope);
    } catch (e) {
        if (e instanceof ElEvaluationError) throw e;
        throw new ElEvaluationError(expression, e instanceof Error ? e.message : String(e));
    }
}

/**
 * Returns whether an expression is syntactically valid EL (parse-only, no evaluation). Used by
 * the workflow validator to flag malformed conditions, closer to the Java validator's compile
 * check than the previous paren/quote balance heuristic.
 */
export function isValidExpression(expression: string | null | undefined): boolean {
    if (expression == null || expression.trim() === '') {
        return true;
    }
    try {
        parse(expression);
        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
    | 'number' | 'string' | 'identifier'
    | 'op' | 'lparen' | 'rparen' | 'lbracket' | 'rbracket' | 'dot' | 'eof';

interface Token {
    type: TokenType;
    value: string;
    /** For numbers/strings, the parsed literal value. */
    literal?: unknown;
    pos: number;
}

/** Multi-character symbolic operators, matched longest-first. */
const SYMBOL_OPERATORS = ['==', '!=', '<=', '>=', '&&', '||'];
const SINGLE_OPERATORS = new Set(['<', '>', '!', '+', '-', '*', '/', '%']);

/** Keyword operators (Jakarta EL aliases). */
const KEYWORD_OPERATORS = new Set([
    'and', 'or', 'not', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'div', 'mod', 'empty',
]);

function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const n = input.length;

    while (i < n) {
        const ch = input[i];

        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }

        // String literals
        if (ch === '\'' || ch === '"') {
            const quote = ch;
            let str = '';
            let j = i + 1;
            let closed = false;
            while (j < n) {
                const c = input[j];
                if (c === '\\' && j + 1 < n) {
                    const next = input[j + 1];
                    str += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next;
                    j += 2;
                    continue;
                }
                if (c === quote) {
                    closed = true;
                    j++;
                    break;
                }
                str += c;
                j++;
            }
            if (!closed) {
                throw new Error(`Unterminated string literal at position ${i}`);
            }
            tokens.push({ type: 'string', value: str, literal: str, pos: i });
            i = j;
            continue;
        }

        // Numbers
        if (isDigit(ch) || (ch === '.' && isDigit(input[i + 1]))) {
            let j = i;
            while (j < n && isDigit(input[j])) j++;
            if (input[j] === '.') {
                j++;
                while (j < n && isDigit(input[j])) j++;
            }
            if (input[j] === 'e' || input[j] === 'E') {
                j++;
                if (input[j] === '+' || input[j] === '-') j++;
                while (j < n && isDigit(input[j])) j++;
            }
            const raw = input.slice(i, j);
            tokens.push({ type: 'number', value: raw, literal: Number(raw), pos: i });
            i = j;
            continue;
        }

        // Identifiers / keyword operators
        if (isIdentStart(ch)) {
            let j = i + 1;
            while (j < n && isIdentPart(input[j])) j++;
            const word = input.slice(i, j);
            if (KEYWORD_OPERATORS.has(word)) {
                tokens.push({ type: 'op', value: word, pos: i });
            } else {
                tokens.push({ type: 'identifier', value: word, pos: i });
            }
            i = j;
            continue;
        }

        // Structural
        if (ch === '(') { tokens.push({ type: 'lparen', value: ch, pos: i }); i++; continue; }
        if (ch === ')') { tokens.push({ type: 'rparen', value: ch, pos: i }); i++; continue; }
        if (ch === '[') { tokens.push({ type: 'lbracket', value: ch, pos: i }); i++; continue; }
        if (ch === ']') { tokens.push({ type: 'rbracket', value: ch, pos: i }); i++; continue; }
        if (ch === '.') { tokens.push({ type: 'dot', value: ch, pos: i }); i++; continue; }

        // Operators
        const two = input.slice(i, i + 2);
        if (SYMBOL_OPERATORS.includes(two)) {
            tokens.push({ type: 'op', value: two, pos: i });
            i += 2;
            continue;
        }
        if (SINGLE_OPERATORS.has(ch)) {
            tokens.push({ type: 'op', value: ch, pos: i });
            i++;
            continue;
        }

        throw new Error(`Unexpected character '${ch}' at position ${i}`);
    }

    tokens.push({ type: 'eof', value: '', pos: n });
    return tokens;
}

function isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function isIdentPart(ch: string): boolean {
    return isIdentStart(ch) || isDigit(ch);
}

// ---------------------------------------------------------------------------
// Parser (recursive descent, EL precedence)
// ---------------------------------------------------------------------------

type Node =
    | { kind: 'literal'; value: unknown }
    | { kind: 'identifier'; name: string }
    | { kind: 'property'; object: Node; name: string }
    | { kind: 'index'; object: Node; index: Node }
    | { kind: 'unary'; op: string; operand: Node }
    | { kind: 'binary'; op: string; left: Node; right: Node };

class Parser {
    private tokens: Token[];
    private pos = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    parse(): Node {
        const node = this.parseOr();
        if (this.peek().type !== 'eof') {
            throw new Error(`Unexpected token '${this.peek().value}' at position ${this.peek().pos}`);
        }
        return node;
    }

    private peek(): Token {
        return this.tokens[this.pos];
    }

    private next(): Token {
        return this.tokens[this.pos++];
    }

    private matchOp(...ops: string[]): Token | null {
        const t = this.peek();
        if (t.type === 'op' && ops.includes(t.value)) {
            return this.next();
        }
        return null;
    }

    private parseOr(): Node {
        let left = this.parseAnd();
        while (this.matchOp('||', 'or')) {
            const right = this.parseAnd();
            left = { kind: 'binary', op: '||', left, right };
        }
        return left;
    }

    private parseAnd(): Node {
        let left = this.parseEquality();
        while (this.matchOp('&&', 'and')) {
            const right = this.parseEquality();
            left = { kind: 'binary', op: '&&', left, right };
        }
        return left;
    }

    private parseEquality(): Node {
        let left = this.parseRelational();
        let op: Token | null;
        while ((op = this.matchOp('==', '!=', 'eq', 'ne'))) {
            const canonical = op.value === 'eq' ? '==' : op.value === 'ne' ? '!=' : op.value;
            const right = this.parseRelational();
            left = { kind: 'binary', op: canonical, left, right };
        }
        return left;
    }

    private parseRelational(): Node {
        let left = this.parseAdditive();
        let op: Token | null;
        while ((op = this.matchOp('<', '>', '<=', '>=', 'lt', 'gt', 'le', 'ge'))) {
            const canonical = { lt: '<', gt: '>', le: '<=', ge: '>=' }[op.value] ?? op.value;
            const right = this.parseAdditive();
            left = { kind: 'binary', op: canonical, left, right };
        }
        return left;
    }

    private parseAdditive(): Node {
        let left = this.parseMultiplicative();
        let op: Token | null;
        while ((op = this.matchOp('+', '-'))) {
            const right = this.parseMultiplicative();
            left = { kind: 'binary', op: op.value, left, right };
        }
        return left;
    }

    private parseMultiplicative(): Node {
        let left = this.parseUnary();
        let op: Token | null;
        while ((op = this.matchOp('*', '/', 'div', '%', 'mod'))) {
            const canonical = op.value === 'div' ? '/' : op.value === 'mod' ? '%' : op.value;
            const right = this.parseUnary();
            left = { kind: 'binary', op: canonical, left, right };
        }
        return left;
    }

    private parseUnary(): Node {
        const op = this.matchOp('!', 'not', '-', 'empty');
        if (op) {
            const canonical = op.value === 'not' ? '!' : op.value;
            const operand = this.parseUnary();
            return { kind: 'unary', op: canonical, operand };
        }
        return this.parsePostfix();
    }

    private parsePostfix(): Node {
        let node = this.parsePrimary();
        for (;;) {
            const t = this.peek();
            if (t.type === 'dot') {
                this.next();
                const name = this.next();
                if (name.type !== 'identifier') {
                    throw new Error(`Expected property name after '.' at position ${name.pos}`);
                }
                node = { kind: 'property', object: node, name: name.value };
            } else if (t.type === 'lbracket') {
                this.next();
                const index = this.parseOr();
                const close = this.next();
                if (close.type !== 'rbracket') {
                    throw new Error(`Expected ']' at position ${close.pos}`);
                }
                node = { kind: 'index', object: node, index };
            } else {
                break;
            }
        }
        return node;
    }

    private parsePrimary(): Node {
        const t = this.next();
        switch (t.type) {
            case 'number':
            case 'string':
                return { kind: 'literal', value: t.literal };
            case 'identifier':
                if (t.value === 'true') return { kind: 'literal', value: true };
                if (t.value === 'false') return { kind: 'literal', value: false };
                if (t.value === 'null') return { kind: 'literal', value: null };
                return { kind: 'identifier', name: t.value };
            case 'lparen': {
                const node = this.parseOr();
                const close = this.next();
                if (close.type !== 'rparen') {
                    throw new Error(`Expected ')' at position ${close.pos}`);
                }
                return node;
            }
            default:
                throw new Error(`Unexpected token '${t.value}' at position ${t.pos}`);
        }
    }
}

function parse(expression: string): Node {
    return new Parser(tokenize(expression)).parse();
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function evaluate(node: Node, scope: ElScope): unknown {
    switch (node.kind) {
        case 'literal':
            return node.value;
        case 'identifier':
            return resolveIdentifier(node.name, scope);
        case 'property':
            return getProperty(evaluate(node.object, scope), node.name);
        case 'index':
            return getIndex(evaluate(node.object, scope), evaluate(node.index, scope));
        case 'unary':
            return evalUnary(node.op, node.operand, scope);
        case 'binary':
            return evalBinary(node.op, node.left, node.right, scope);
    }
}

function resolveIdentifier(name: string, scope: ElScope): unknown {
    if (name === 'context') return scope.context ?? null;
    if (name === 'event') return scope.event ?? null;
    throw new Error(`Unknown identifier '${name}' (only 'context' and 'event' are available)`);
}

function getProperty(base: unknown, name: string): unknown {
    if (base === null || base === undefined) {
        throw new Error(`Cannot read property '${name}' of ${base}`);
    }
    if (typeof base !== 'object') {
        throw new Error(`Cannot read property '${name}' of a ${typeof base}`);
    }
    const value = (base as Record<string, unknown>)[name];
    return value === undefined ? null : value;
}

function getIndex(base: unknown, index: unknown): unknown {
    if (base === null || base === undefined) {
        throw new Error(`Cannot index ${base}`);
    }
    if (Array.isArray(base)) {
        const i = typeof index === 'number' ? index : Number(index);
        const value = base[i];
        return value === undefined ? null : value;
    }
    if (typeof base === 'object') {
        const value = (base as Record<string, unknown>)[String(index)];
        return value === undefined ? null : value;
    }
    throw new Error(`Cannot index a ${typeof base}`);
}

function evalUnary(op: string, operandNode: Node, scope: ElScope): unknown {
    if (op === 'empty') {
        return isEmpty(evaluate(operandNode, scope));
    }
    if (op === '!') {
        return !coerceToBoolean(evaluate(operandNode, scope));
    }
    // unary minus
    return -coerceToNumber(evaluate(operandNode, scope));
}

function evalBinary(op: string, leftNode: Node, rightNode: Node, scope: ElScope): unknown {
    // Short-circuit logical operators.
    if (op === '&&') {
        return coerceToBoolean(evaluate(leftNode, scope)) && coerceToBoolean(evaluate(rightNode, scope));
    }
    if (op === '||') {
        return coerceToBoolean(evaluate(leftNode, scope)) || coerceToBoolean(evaluate(rightNode, scope));
    }

    const left = evaluate(leftNode, scope);
    const right = evaluate(rightNode, scope);

    switch (op) {
        case '==': return elEquals(left, right);
        case '!=': return !elEquals(left, right);
        case '<': return elCompare(left, right) < 0;
        case '>': return elCompare(left, right) > 0;
        case '<=': return elLessOrEqual(left, right);
        case '>=': return elGreaterOrEqual(left, right);
        case '+': return coerceToNumber(left) + coerceToNumber(right);
        case '-': return coerceToNumber(left) - coerceToNumber(right);
        case '*': return coerceToNumber(left) * coerceToNumber(right);
        case '/': return coerceToNumber(left) / coerceToNumber(right);
        case '%': return coerceToNumber(left) % coerceToNumber(right);
        default:
            throw new Error(`Unsupported operator '${op}'`);
    }
}

// ---------------------------------------------------------------------------
// Jakarta EL coercion / comparison semantics
// ---------------------------------------------------------------------------

function isNullish(v: unknown): boolean {
    return v === null || v === undefined;
}

/** Jakarta EL `==` semantics for the supported types. */
function elEquals(a: unknown, b: unknown): boolean {
    if (isNullish(a) || isNullish(b)) {
        return isNullish(a) && isNullish(b);
    }
    if (typeof a === 'number' || typeof b === 'number') {
        return coerceToNumber(a) === coerceToNumber(b);
    }
    if (typeof a === 'boolean' || typeof b === 'boolean') {
        return coerceToBoolean(a) === coerceToBoolean(b);
    }
    if (typeof a === 'string' || typeof b === 'string') {
        return String(a) === String(b);
    }
    return a === b;
}

/**
 * Jakarta EL relational comparison. Returns a negative/zero/positive number. Callers must first
 * handle the null case (EL returns `false` for all relational operators when either side is null).
 */
function elCompare(a: unknown, b: unknown): number {
    if (isNullish(a) || isNullish(b)) {
        // Sentinel: relational operators against null are always false. Return NaN so every
        // comparison (`< 0`, `> 0`, etc.) is false.
        return NaN;
    }
    if (typeof a === 'number' || typeof b === 'number') {
        const an = coerceToNumber(a);
        const bn = coerceToNumber(b);
        return an < bn ? -1 : an > bn ? 1 : 0;
    }
    if (typeof a === 'string' || typeof b === 'string') {
        const as = String(a);
        const bs = String(b);
        return as < bs ? -1 : as > bs ? 1 : 0;
    }
    throw new Error(`Cannot compare ${typeof a} with ${typeof b}`);
}

function elLessOrEqual(a: unknown, b: unknown): boolean {
    if (isNullish(a) || isNullish(b)) return false;
    return elCompare(a, b) <= 0;
}

function elGreaterOrEqual(a: unknown, b: unknown): boolean {
    if (isNullish(a) || isNullish(b)) return false;
    return elCompare(a, b) >= 0;
}

/** Jakarta EL boolean coercion: null/""→false, Boolean→itself, String→"true" (case-insensitive). */
function coerceToBoolean(v: unknown): boolean {
    if (isNullish(v)) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
        if (v === '') return false;
        return v.toLowerCase() === 'true';
    }
    throw new Error(`Cannot coerce ${typeof v} to boolean`);
}

/** Jakarta EL numeric coercion: null/""→0, number→itself, numeric string→number. */
function coerceToNumber(v: unknown): number {
    if (isNullish(v)) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
        if (v.trim() === '') return 0;
        const n = Number(v);
        if (Number.isNaN(n)) {
            throw new Error(`Cannot coerce string "${v}" to number`);
        }
        return n;
    }
    throw new Error(`Cannot coerce ${typeof v} to number`);
}

/** Jakarta EL `empty` operator: null, "", empty array, and empty object are empty. */
function isEmpty(v: unknown): boolean {
    if (isNullish(v)) return true;
    if (v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v as object).length === 0;
    return false;
}
