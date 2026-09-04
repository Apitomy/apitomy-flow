// Token matcher for the JSON-highlighting subset. Strings are matched first (and greedily) so their
// contents can never be re-tokenized as numbers/keywords. A quoted string immediately followed by a
// colon is treated as an object key (`property`).
const JSON_TOKEN =
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/**
 * Produces an HTML string with Prism-compatible `<span class="token …">` wrappers for a JSON
 * document, suitable for {@code react-simple-code-editor}'s `highlight` callback (which injects the
 * result as markup). The input is HTML-escaped first, so it is safe to render, and the function
 * never throws — partial/invalid JSON typed mid-edit simply leaves unmatched text unstyled.
 *
 * This is a dependency-free replacement for Prism's JSON grammar; the emitted class names match the
 * `.flow-json-editor .token.*` rules in {@code JsonCodeEditor.css}.
 *
 * @param code the (possibly incomplete) JSON source text
 * @returns HTML-escaped, syntax-highlighted markup
 */
export function highlightJson(code: string): string {
    const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return escaped.replace(
        JSON_TOKEN,
        (match, str: string | undefined, colon: string | undefined,
            bool: string | undefined, nul: string | undefined, num: string | undefined): string => {
            if (str !== undefined) {
                // A string followed by a colon is an object key; the colon itself stays unstyled.
                return colon !== undefined
                    ? `<span class="token property">${str}</span>${colon}`
                    : `<span class="token string">${str}</span>`;
            }
            if (bool !== undefined) return `<span class="token boolean">${match}</span>`;
            if (nul !== undefined) return `<span class="token null">${match}</span>`;
            if (num !== undefined) return `<span class="token number">${match}</span>`;
            return match;
        },
    );
}
