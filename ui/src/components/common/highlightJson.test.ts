import { describe, it, expect } from 'vitest';
import { highlightJson } from './highlightJson.ts';

describe('highlightJson', () => {
    it('marks object keys as property and their colon stays unstyled', () => {
        const html = highlightJson('{"name": "x"}');
        expect(html).toContain('<span class="token property">"name"</span>:');
    });

    it('marks string values', () => {
        const html = highlightJson('{"name": "alice"}');
        expect(html).toContain('<span class="token string">"alice"</span>');
    });

    it('marks numbers, including negative and decimal', () => {
        expect(highlightJson('{"a": -1}')).toContain('<span class="token number">-1</span>');
        expect(highlightJson('{"a": 3.14}')).toContain('<span class="token number">3.14</span>');
        expect(highlightJson('{"a": 2e10}')).toContain('<span class="token number">2e10</span>');
    });

    it('marks booleans and null', () => {
        expect(highlightJson('{"a": true}')).toContain('<span class="token boolean">true</span>');
        expect(highlightJson('{"a": false}')).toContain('<span class="token boolean">false</span>');
        expect(highlightJson('{"a": null}')).toContain('<span class="token null">null</span>');
    });

    it('does not re-tokenize keyword-like text inside strings', () => {
        const html = highlightJson('{"a": "true and null 42"}');
        expect(html).toContain('<span class="token string">"true and null 42"</span>');
        expect(html).not.toContain('<span class="token boolean">');
        expect(html).not.toContain('<span class="token number">');
    });

    it('HTML-escapes content so it is safe to inject as markup', () => {
        const html = highlightJson('{"html": "<script>&</script>"}');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;&amp;&lt;/script&gt;');
    });

    it('does not throw on partial or invalid JSON typed mid-edit', () => {
        expect(() => highlightJson('{"a":')).not.toThrow();
        expect(() => highlightJson('not json at all')).not.toThrow();
        expect(() => highlightJson('')).not.toThrow();
    });

    it('escapes a quote-preceding ampersand without breaking the string token', () => {
        const html = highlightJson('{"a": "b & c"}');
        expect(html).toContain('<span class="token string">"b &amp; c"</span>');
    });
});
