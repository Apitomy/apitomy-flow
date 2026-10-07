import { describe, it, expect } from 'vitest';
import { previewValue } from './valuePreview.ts';

describe('previewValue', () => {
  it('renders null and undefined as an em dash', () => {
    expect(previewValue(null)).toEqual({ short: '—', full: '—', truncated: false, isJson: false });
    expect(previewValue(undefined).short).toBe('—');
  });

  it('leaves short scalars untouched', () => {
    expect(previewValue('abc')).toEqual({ short: 'abc', full: 'abc', truncated: false, isJson: false });
    expect(previewValue(42).short).toBe('42');
    expect(previewValue(false).short).toBe('false');
  });

  it('truncates long strings at the max length', () => {
    const preview = previewValue('x'.repeat(30), 10);
    expect(preview.truncated).toBe(true);
    expect(preview.short).toBe(`${'x'.repeat(10)}…`);
    expect(preview.full).toBe('x'.repeat(30));
  });

  it('does not truncate a value exactly at the limit', () => {
    expect(previewValue('x'.repeat(10), 10).truncated).toBe(false);
  });

  it('truncates multi-line text at the first line break', () => {
    const preview = previewValue('first line\nsecond line');
    expect(preview).toEqual({ short: 'first line…', full: 'first line\nsecond line', truncated: true, isJson: false });
  });

  it('treats objects and arrays as JSON, compact inline and pretty in full', () => {
    const preview = previewValue({ a: 1, b: [true] });
    expect(preview.isJson).toBe(true);
    expect(preview.short).toBe('{"a":1,"b":[true]}');
    expect(preview.truncated).toBe(false);
    expect(preview.full).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}');
  });

  it('truncates large JSON values', () => {
    const preview = previewValue({ text: 'y'.repeat(50) }, 20);
    expect(preview.truncated).toBe(true);
    expect(preview.short).toHaveLength(21);
  });

  it('detects JSON embedded in strings', () => {
    const preview = previewValue('  {"notes": "hi"}');
    expect(preview.isJson).toBe(true);
    expect(preview.short).toBe('{"notes":"hi"}');
    expect(preview.full).toBe('{\n  "notes": "hi"\n}');
  });

  it('keeps non-JSON or scalar-JSON strings as plain text', () => {
    expect(previewValue('{not json').isJson).toBe(false);
    expect(previewValue('42').isJson).toBe(false);
    expect(previewValue('"quoted"').isJson).toBe(false);
  });
});
