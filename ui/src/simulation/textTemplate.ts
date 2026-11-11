import { classifyExpression, type ExpressionSyntax } from './elEvaluator.ts';

/** One segment of a parsed text template: literal text, or an expression without its `${}` delimiters. */
export interface TextTemplateSegment {
    text: string;
    expression: boolean;
}

/**
 * Parses a text template mixing literal text with embedded `${...}` EL expressions, as used by human-task
 * bodies. Mirrors the engine's `TextTemplate`: string literals and nested braces inside an expression are
 * skipped when finding its closing brace, and `\${` produces a literal `${`.
 *
 * @param source the template source
 * @return the segments in order
 * @throws Error if an expression is unterminated or empty
 */
export function parseTextTemplate(source: string): TextTemplateSegment[] {
    const segments: TextTemplateSegment[] = [];
    let literal = '';
    let i = 0;
    while (i < source.length) {
        const c = source[i];
        if (c === '\\' && source.startsWith('${', i + 1)) {
            literal += '${';
            i += 3;
        } else if (c === '$' && source[i + 1] === '{') {
            const end = findExpressionEnd(source, i + 2);
            const expression = source.substring(i + 2, end).trim();
            if (expression === '') throw new Error(`Empty expression at offset ${i}`);
            if (literal) {
                segments.push({ text: literal, expression: false });
                literal = '';
            }
            segments.push({ text: expression, expression: true });
            i = end + 1;
        } else {
            literal += c;
            i++;
        }
    }
    if (literal) segments.push({ text: literal, expression: false });
    return segments;
}

function findExpressionEnd(source: string, start: number): number {
    let depth = 0;
    let quote = '';
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = '';
        } else if (c === "'" || c === '"') {
            quote = c;
        } else if (c === '{') {
            depth++;
        } else if (c === '}') {
            if (depth === 0) return i;
            depth--;
        }
    }
    throw new Error(`Unterminated expression starting at offset ${start - 2}`);
}

/**
 * Classifies a text template: `invalid` if it cannot be parsed or any embedded expression is invalid,
 * otherwise `unsupported` if any expression uses engine-only syntax, otherwise `supported`.
 *
 * @param source the template source
 * @return the template's syntax classification
 */
export function classifyTextTemplate(source: string): ExpressionSyntax {
    let segments: TextTemplateSegment[];
    try {
        segments = parseTextTemplate(source);
    } catch {
        return 'invalid';
    }
    const classes = segments.filter(s => s.expression).map(s => classifyExpression(s.text));
    if (classes.includes('invalid')) return 'invalid';
    return classes.includes('unsupported') ? 'unsupported' : 'supported';
}

/**
 * Renders a template, replacing each expression with the evaluator's result. `null`/`undefined` render as
 * an empty string, objects as JSON, and other values via `String`.
 *
 * @param source the template source
 * @param evaluate evaluates one expression
 * @return the rendered text
 * @throws Error if the template cannot be parsed
 */
export function renderTextTemplate(source: string, evaluate: (expression: string) => unknown): string {
    return parseTextTemplate(source).map(segment => {
        if (!segment.expression) return segment.text;
        const value = evaluate(segment.text);
        if (value === null || value === undefined) return '';
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }).join('');
}
