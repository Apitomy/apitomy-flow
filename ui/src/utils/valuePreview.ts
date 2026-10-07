/** Default maximum number of characters shown inline before a value is cut off. */
export const PREVIEW_MAX_LENGTH = 80;

/** How a single value is presented inline, and how it is shown in full. */
export interface ValuePreview {
  /** The inline text, shortened with a trailing "…" when {@link truncated}. */
  short: string;
  /** The complete text: pretty-printed JSON (2-space indent) when {@link isJson}, otherwise the raw text. */
  full: string;
  /** Whether {@link short} omits part of the value. */
  truncated: boolean;
  /** Whether the value is a JSON object/array (or a string containing one) and should be highlighted. */
  isJson: boolean;
}

/** Parses a string as a JSON object or array, returning `undefined` for anything else. */
function parseJsonContainer(text: string): object | undefined {
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Computes the inline and full presentations of a value shown in the viewer. Objects and arrays — and
 * strings that parse as one — are treated as JSON. The inline text is a single line cut at the first line
 * break or `maxLength` characters, whichever comes first. `null`/`undefined` render as an em dash.
 *
 * @param value the value to present
 * @param maxLength the maximum inline length before truncation
 * @return the value's preview
 */
export function previewValue(value: unknown, maxLength: number = PREVIEW_MAX_LENGTH): ValuePreview {
  if (value === null || value === undefined) {
    return { short: '—', full: '—', truncated: false, isJson: false };
  }
  let inline: string;
  let full: string;
  let isJson = false;
  if (typeof value === 'object') {
    inline = JSON.stringify(value);
    full = JSON.stringify(value, null, 2);
    isJson = true;
  } else if (typeof value === 'string') {
    const parsed = parseJsonContainer(value);
    isJson = parsed !== undefined;
    inline = isJson ? JSON.stringify(parsed) : value;
    full = isJson ? JSON.stringify(parsed, null, 2) : value;
  } else {
    inline = String(value);
    full = inline;
  }
  const lineBreak = inline.search(/\r?\n/);
  const cut = Math.min(lineBreak === -1 ? Infinity : lineBreak, maxLength);
  const truncated = cut < inline.length;
  return { short: truncated ? `${inline.slice(0, cut).trimEnd()}…` : inline, full, truncated, isJson };
}
