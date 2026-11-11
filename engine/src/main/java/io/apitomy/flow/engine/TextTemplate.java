package io.apitomy.flow.engine;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.function.Function;

/**
 * A parsed text template mixing literal text with embedded {@code ${...}} EL expressions, used for
 * human-task markdown bodies. Each expression is evaluated independently so one failing expression cannot
 * break the rest of the template. A literal {@code ${} may be written as {@code \${}.
 */
final class TextTemplate {

    /**
     * One template segment: either literal text or an expression (without its {@code ${}} delimiters).
     *
     * @param text       the literal text or expression source
     * @param expression whether this segment is an expression
     */
    record Segment(String text, boolean expression) {
    }

    private final List<Segment> segments;

    private TextTemplate(List<Segment> segments) {
        this.segments = Collections.unmodifiableList(segments);
    }

    /**
     * Parses a template.
     *
     * @param source the template source
     * @return the parsed template
     * @throws IllegalArgumentException if an expression is unterminated or empty
     */
    static TextTemplate parse(String source) {
        List<Segment> segments = new ArrayList<>();
        StringBuilder literal = new StringBuilder();
        int i = 0;
        while (i < source.length()) {
            char c = source.charAt(i);
            if (c == '\\' && source.startsWith("${", i + 1)) {
                literal.append("${");
                i += 3;
            } else if (c == '$' && source.startsWith("{", i + 1)) {
                int end = findExpressionEnd(source, i + 2);
                String expression = source.substring(i + 2, end).trim();
                if (expression.isEmpty()) {
                    throw new IllegalArgumentException("Empty expression at offset " + i);
                }
                if (!literal.isEmpty()) {
                    segments.add(new Segment(literal.toString(), false));
                    literal.setLength(0);
                }
                segments.add(new Segment(expression, true));
                i = end + 1;
            } else {
                literal.append(c);
                i++;
            }
        }
        if (!literal.isEmpty()) {
            segments.add(new Segment(literal.toString(), false));
        }
        return new TextTemplate(segments);
    }

    /**
     * Finds the closing brace of an expression, skipping string literals and nested braces.
     *
     * @param source the template source
     * @param start  the index just after {@code ${}
     * @return the index of the closing brace
     * @throws IllegalArgumentException if the expression is unterminated
     */
    private static int findExpressionEnd(String source, int start) {
        int depth = 0;
        char quote = 0;
        for (int i = start; i < source.length(); i++) {
            char c = source.charAt(i);
            if (quote != 0) {
                if (c == '\\') {
                    i++;
                } else if (c == quote) {
                    quote = 0;
                }
            } else if (c == '\'' || c == '"') {
                quote = c;
            } else if (c == '{') {
                depth++;
            } else if (c == '}') {
                if (depth == 0) {
                    return i;
                }
                depth--;
            }
        }
        throw new IllegalArgumentException("Unterminated expression starting at offset " + (start - 2));
    }

    /**
     * Returns the parsed segments in order.
     *
     * @return the segments
     */
    List<Segment> segments() {
        return segments;
    }

    /**
     * Renders the template, replacing each expression with the evaluator's result. A {@code null} result
     * renders as an empty string; other results are converted with {@link String#valueOf(Object)}.
     *
     * @param evaluator evaluates one expression; may return {@code null}
     * @return the rendered text
     */
    String render(Function<String, Object> evaluator) {
        StringBuilder out = new StringBuilder();
        for (Segment segment : segments) {
            if (segment.expression()) {
                Object value = evaluator.apply(segment.text());
                out.append(value == null ? "" : String.valueOf(value));
            } else {
                out.append(segment.text());
            }
        }
        return out.toString();
    }
}
