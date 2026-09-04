import CodeEditor from 'react-simple-code-editor';
import { highlightJson } from './highlightJson.ts';
import './JsonCodeEditor.css';

// `react-simple-code-editor` is published as CommonJS (`exports.default = Editor`). Depending on the
// bundler's ESM interop, the default import can arrive as the module namespace object rather than the
// component itself, so normalize to the actual component before rendering it.
const Editor =
    (CodeEditor as unknown as { default?: typeof CodeEditor }).default ?? CodeEditor;

interface JsonCodeEditorProps {
  /** The JSON source text. */
  value: string;
  /** Called with the new text on every edit. Ignored when {@code readOnly} is true. */
  onChange?: (value: string) => void;
  /** Approximate minimum number of visible rows. Defaults to 6. */
  minRows?: number;
  /** When true, the content is highlighted but not editable. */
  readOnly?: boolean;
  /** Extra class name applied to the editor wrapper. */
  className?: string;
  /** Accessible label for the underlying textarea. */
  ariaLabel?: string;
}

/**
 * A lightweight, syntax-highlighted JSON editor built on {@code react-simple-code-editor} and
 * Prism. Used for the sample-context and mock-output fields in the simulation panel, the inline
 * condition tester, and (read-only) the evolving simulation context view. Bundled into the library
 * (no peer dependency) so consumers get highlighting without extra setup.
 */
export function JsonCodeEditor({ value, onChange, minRows = 6, readOnly = false, className, ariaLabel }: JsonCodeEditorProps) {
    return (
        <div
            className={`flow-json-editor${readOnly ? ' flow-json-editor--readonly' : ''}${className ? ` ${className}` : ''}`}
            style={{ minHeight: `${minRows * 1.5}em` }}
        >
            <Editor
                value={value}
                onValueChange={(next) => onChange?.(next)}
                highlight={(code) => highlightJson(code)}
                padding={8}
                textareaClassName="flow-json-editor__textarea"
                preClassName="flow-json-editor__pre"
                spellCheck={false}
                readOnly={readOnly}
                aria-label={ariaLabel}
            />
        </div>
    );
}
