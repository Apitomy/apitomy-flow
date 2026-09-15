/*
 * Vendored from `react-simple-code-editor` v0.14.1 (https://github.com/satya164/react-simple-code-editor),
 * which is published as a CommonJS-only package. Depending on a downstream consumer's bundler and its
 * CJS/ESM interop implementation, importing it can produce a `require("react")` call that isn't
 * converted to ESM, crashing the app at runtime (see issue #107). The component itself is small,
 * dependency-free (aside from React) and stable, so it is copied here as a normal ESM component
 * instead of depending on the external package.
 *
 * Original work Copyright (c) 2018-2019 Satyajit Sahoo, licensed under the MIT License:
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
 * OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import * as React from 'react';

type Padding<T> = T | { top?: T; right?: T; bottom?: T; left?: T };

/** Props accepted by {@link CodeEditor}: a subset of `div`/`textarea` attributes plus editor options. */
type CodeEditorProps = React.HTMLAttributes<HTMLDivElement> & {
    // Props for the component
    highlight: (value: string) => string | React.ReactNode;
    ignoreTabKey?: boolean;
    insertSpaces?: boolean;
    onValueChange: (value: string) => void;
    padding?: Padding<number | string>;
    style?: React.CSSProperties;
    tabSize?: number;
    value: string;

    // Props for the textarea
    autoFocus?: boolean;
    disabled?: boolean;
    form?: string;
    maxLength?: number;
    minLength?: number;
    name?: string;
    onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
    onClick?: React.MouseEventHandler<HTMLTextAreaElement>;
    onFocus?: React.FocusEventHandler<HTMLTextAreaElement>;
    onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
    onKeyUp?: React.KeyboardEventHandler<HTMLTextAreaElement>;
    placeholder?: string;
    readOnly?: boolean;
    required?: boolean;
    textareaClassName?: string;
    textareaId?: string;

    // Props for the highlighted code's pre element
    preClassName?: string;
};

type EditorRecord = {
    value: string;
    selectionStart: number;
    selectionEnd: number;
};

type EditorHistory = {
    stack: (EditorRecord & { timestamp: number })[];
    offset: number;
};

const KEYCODE_Y = 89;
const KEYCODE_Z = 90;
const KEYCODE_M = 77;
const KEYCODE_PARENS = 57;
const KEYCODE_BRACKETS = 219;
const KEYCODE_QUOTE = 222;
const KEYCODE_BACK_QUOTE = 192;

const HISTORY_LIMIT = 100;
const HISTORY_TIME_GAP = 3000;

const isWindows =
    typeof window !== 'undefined' &&
    'navigator' in window &&
    /Win/i.test(navigator.platform);
const isMacLike =
    typeof window !== 'undefined' &&
    'navigator' in window &&
    /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);

const textareaBaseClassName = 'flow-code-editor__native-textarea';

const cssText = /* CSS */ `
/**
 * Reset the text fill color so that placeholder is visible
 */
.${textareaBaseClassName}:empty {
  -webkit-text-fill-color: inherit !important;
}

/**
 * Hack to apply on some CSS on IE10 and IE11
 */
@media all and (-ms-high-contrast: none), (-ms-high-contrast: active) {
  /**
    * IE doesn't support '-webkit-text-fill-color'
    * So we use 'color: transparent' to make the text transparent on IE
    * Unlike other browsers, it doesn't affect caret color in IE
    */
  .${textareaBaseClassName} {
    color: transparent !important;
  }

  .${textareaBaseClassName}::selection {
    background-color: #accef7 !important;
    color: transparent !important;
  }
}
`;

/**
 * A minimal, dependency-free (aside from React) syntax-highlighted code editor: a transparent
 * `<textarea>` layered over a `<pre>` that renders markup produced by the {@code highlight} callback.
 * Supports tab-to-indent, bracket/quote auto-pairing, and its own undo/redo history stack.
 *
 * Vendored from `react-simple-code-editor` (see file header for attribution/license) so that
 * `@apitomy/flow-ui` has no CJS-only runtime dependency for consumers to work around.
 */
const CodeEditor = React.forwardRef(function CodeEditor(
    props: CodeEditorProps,
    ref: React.Ref<null | { session: { history: EditorHistory } }>
) {
    const {
        autoFocus,
        disabled,
        form,
        highlight,
        ignoreTabKey = false,
        insertSpaces = true,
        maxLength,
        minLength,
        name,
        onBlur,
        onClick,
        onFocus,
        onKeyDown,
        onKeyUp,
        onValueChange,
        padding = 0,
        placeholder,
        preClassName,
        readOnly,
        required,
        style,
        tabSize = 2,
        textareaClassName,
        textareaId,
        value,
        ...rest
    } = props;

    const historyRef = React.useRef<EditorHistory>({
        stack: [],
        offset: -1,
    });
    const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
    const [capture, setCapture] = React.useState(true);
    const contentStyle = {
        paddingTop: typeof padding === 'object' ? padding.top : padding,
        paddingRight: typeof padding === 'object' ? padding.right : padding,
        paddingBottom: typeof padding === 'object' ? padding.bottom : padding,
        paddingLeft: typeof padding === 'object' ? padding.left : padding,
    };
    const highlighted = highlight(value);

    const getLines = (text: string, position: number) =>
        text.substring(0, position).split('\n');

    const recordChange = React.useCallback(
        (record: EditorRecord, overwrite: boolean = false) => {
            const { stack, offset } = historyRef.current;

            if (stack.length && offset > -1) {
                // When something updates, drop the redo operations
                historyRef.current.stack = stack.slice(0, offset + 1);

                // Limit the number of operations to 100
                const count = historyRef.current.stack.length;

                if (count > HISTORY_LIMIT) {
                    const extras = count - HISTORY_LIMIT;

                    historyRef.current.stack = stack.slice(extras, count);
                    historyRef.current.offset = Math.max(
                        historyRef.current.offset - extras,
                        0
                    );
                }
            }

            const timestamp = Date.now();

            if (overwrite) {
                const last = historyRef.current.stack[historyRef.current.offset];

                if (last && timestamp - last.timestamp < HISTORY_TIME_GAP) {
                    // A previous entry exists and was in short interval

                    // Match the last word in the line
                    const re = /[^a-z0-9]([a-z0-9]+)$/i;

                    // Get the previous line
                    const previous = getLines(last.value, last.selectionStart)
                        .pop()
                        ?.match(re);

                    // Get the current line
                    const current = getLines(record.value, record.selectionStart)
                        .pop()
                        ?.match(re);

                    if (previous?.[1] && current?.[1]?.startsWith(previous[1])) {
                        // The last word of the previous line and current line match
                        // Overwrite previous entry so that undo will remove whole word
                        historyRef.current.stack[historyRef.current.offset] = {
                            ...record,
                            timestamp,
                        };

                        return;
                    }
                }
            }

            // Add the new operation to the stack
            historyRef.current.stack.push({ ...record, timestamp });
            historyRef.current.offset++;
        },
        []
    );

    const recordCurrentState = React.useCallback(() => {
        const input = inputRef.current;

        if (!input) return;

        // Save current state of the input
        const { value, selectionStart, selectionEnd } = input;

        recordChange({
            value,
            selectionStart,
            selectionEnd,
        });
    }, [recordChange]);

    const updateInput = (record: EditorRecord) => {
        const input = inputRef.current;

        if (!input) return;

        // Update values and selection state
        input.value = record.value;
        input.selectionStart = record.selectionStart;
        input.selectionEnd = record.selectionEnd;

        onValueChange?.(record.value);
    };

    const applyEdits = (record: EditorRecord) => {
        // Save last selection state
        const input = inputRef.current;
        const last = historyRef.current.stack[historyRef.current.offset];

        if (last && input) {
            historyRef.current.stack[historyRef.current.offset] = {
                ...last,
                selectionStart: input.selectionStart,
                selectionEnd: input.selectionEnd,
            };
        }

        // Save the changes
        recordChange(record);
        updateInput(record);
    };

    const undoEdit = () => {
        const { stack, offset } = historyRef.current;

        // Get the previous edit
        const record = stack[offset - 1];

        if (record) {
            // Apply the changes and update the offset
            updateInput(record);
            historyRef.current.offset = Math.max(offset - 1, 0);
        }
    };

    const redoEdit = () => {
        const { stack, offset } = historyRef.current;

        // Get the next edit
        const record = stack[offset + 1];

        if (record) {
            // Apply the changes and update the offset
            updateInput(record);
            historyRef.current.offset = Math.min(offset + 1, stack.length - 1);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (onKeyDown) {
            onKeyDown(e);

            if (e.defaultPrevented) {
                return;
            }
        }

        if (e.key === 'Escape') {
            e.currentTarget.blur();
        }

        const { value, selectionStart, selectionEnd } = e.currentTarget;

        const tabCharacter = (insertSpaces ? ' ' : '\t').repeat(tabSize);

        if (e.key === 'Tab' && !ignoreTabKey && capture) {
            // Prevent focus change
            e.preventDefault();

            if (e.shiftKey) {
                // Unindent selected lines
                const linesBeforeCaret = getLines(value, selectionStart);
                const startLine = linesBeforeCaret.length - 1;
                const endLine = getLines(value, selectionEnd).length - 1;
                const nextValue = value
                    .split('\n')
                    .map((line, i) => {
                        if (
                            i >= startLine &&
                            i <= endLine &&
                            line.startsWith(tabCharacter)
                        ) {
                            return line.substring(tabCharacter.length);
                        }

                        return line;
                    })
                    .join('\n');

                if (value !== nextValue) {
                    const startLineText = linesBeforeCaret[startLine];

                    applyEdits({
                        value: nextValue,
                        // Move the start cursor if first line in selection was modified
                        // It was modified only if it started with a tab
                        selectionStart: startLineText?.startsWith(tabCharacter)
                            ? selectionStart - tabCharacter.length
                            : selectionStart,
                        // Move the end cursor by total number of characters removed
                        selectionEnd: selectionEnd - (value.length - nextValue.length),
                    });
                }
            } else if (selectionStart !== selectionEnd) {
                // Indent selected lines
                const linesBeforeCaret = getLines(value, selectionStart);
                const startLine = linesBeforeCaret.length - 1;
                const endLine = getLines(value, selectionEnd).length - 1;
                const startLineText = linesBeforeCaret[startLine];

                applyEdits({
                    value: value
                        .split('\n')
                        .map((line, i) => {
                            if (i >= startLine && i <= endLine) {
                                return tabCharacter + line;
                            }

                            return line;
                        })
                        .join('\n'),
                    // Move the start cursor by number of characters added in first line of selection
                    // Don't move it if it there was no text before cursor
                    selectionStart:
                        startLineText && /\S/.test(startLineText)
                            ? selectionStart + tabCharacter.length
                            : selectionStart,
                    // Move the end cursor by total number of characters added
                    selectionEnd:
                        selectionEnd + tabCharacter.length * (endLine - startLine + 1),
                });
            } else {
                const updatedSelection = selectionStart + tabCharacter.length;

                applyEdits({
                    // Insert tab character at caret
                    value:
                        value.substring(0, selectionStart) +
                        tabCharacter +
                        value.substring(selectionEnd),
                    // Update caret position
                    selectionStart: updatedSelection,
                    selectionEnd: updatedSelection,
                });
            }
        } else if (e.key === 'Backspace') {
            const hasSelection = selectionStart !== selectionEnd;
            const textBeforeCaret = value.substring(0, selectionStart);

            if (textBeforeCaret.endsWith(tabCharacter) && !hasSelection) {
                // Prevent default delete behaviour
                e.preventDefault();

                const updatedSelection = selectionStart - tabCharacter.length;

                applyEdits({
                    // Remove tab character at caret
                    value:
                        value.substring(0, selectionStart - tabCharacter.length) +
                        value.substring(selectionEnd),
                    // Update caret position
                    selectionStart: updatedSelection,
                    selectionEnd: updatedSelection,
                });
            }
        } else if (e.key === 'Enter') {
            // Ignore selections
            if (selectionStart === selectionEnd) {
                // Get the current line
                const line = getLines(value, selectionStart).pop();
                const matches = line?.match(/^\s+/);

                if (matches?.[0]) {
                    e.preventDefault();

                    // Preserve indentation on inserting a new line
                    const indent = '\n' + matches[0];
                    const updatedSelection = selectionStart + indent.length;

                    applyEdits({
                        // Insert indentation character at caret
                        value:
                            value.substring(0, selectionStart) +
                            indent +
                            value.substring(selectionEnd),
                        // Update caret position
                        selectionStart: updatedSelection,
                        selectionEnd: updatedSelection,
                    });
                }
            }
        } else if (
            e.keyCode === KEYCODE_PARENS ||
            e.keyCode === KEYCODE_BRACKETS ||
            e.keyCode === KEYCODE_QUOTE ||
            e.keyCode === KEYCODE_BACK_QUOTE
        ) {
            let chars;

            if (e.keyCode === KEYCODE_PARENS && e.shiftKey) {
                chars = ['(', ')'];
            } else if (e.keyCode === KEYCODE_BRACKETS) {
                if (e.shiftKey) {
                    chars = ['{', '}'];
                } else {
                    chars = ['[', ']'];
                }
            } else if (e.keyCode === KEYCODE_QUOTE) {
                if (e.shiftKey) {
                    chars = ['"', '"'];
                } else {
                    chars = ["'", "'"];
                }
            } else if (e.keyCode === KEYCODE_BACK_QUOTE && !e.shiftKey) {
                chars = ['`', '`'];
            }

            // If text is selected, wrap them in the characters
            if (selectionStart !== selectionEnd && chars) {
                e.preventDefault();

                applyEdits({
                    value:
                        value.substring(0, selectionStart) +
                        chars[0] +
                        value.substring(selectionStart, selectionEnd) +
                        chars[1] +
                        value.substring(selectionEnd),
                    // Update caret position
                    selectionStart,
                    selectionEnd: selectionEnd + 2,
                });
            }
        } else if (
            (isMacLike
                ? // Trigger undo with Cmd+Z on Mac
                e.metaKey && e.keyCode === KEYCODE_Z
                : // Trigger undo with Ctrl+Z on other platforms
                e.ctrlKey && e.keyCode === KEYCODE_Z) &&
            !e.shiftKey &&
            !e.altKey
        ) {
            e.preventDefault();

            undoEdit();
        } else if (
            (isMacLike
                ? // Trigger redo with Cmd+Shift+Z on Mac
                e.metaKey && e.keyCode === KEYCODE_Z && e.shiftKey
                : isWindows
                    ? // Trigger redo with Ctrl+Y on Windows
                    e.ctrlKey && e.keyCode === KEYCODE_Y
                    : // Trigger redo with Ctrl+Shift+Z on other platforms
                    e.ctrlKey && e.keyCode === KEYCODE_Z && e.shiftKey) &&
            !e.altKey
        ) {
            e.preventDefault();

            redoEdit();
        } else if (
            e.keyCode === KEYCODE_M &&
            e.ctrlKey &&
            (isMacLike ? e.shiftKey : true)
        ) {
            e.preventDefault();

            // Toggle capturing tab key so users can focus away
            setCapture((prev) => !prev);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const { value, selectionStart, selectionEnd } = e.currentTarget;

        recordChange(
            {
                value,
                selectionStart,
                selectionEnd,
            },
            true
        );

        onValueChange(value);
    };

    React.useEffect(() => {
        recordCurrentState();
    }, [recordCurrentState]);

    React.useImperativeHandle(
        ref,
        () => {
            return {
                get session() {
                    return {
                        history: historyRef.current,
                    };
                },
                set session(session: { history: EditorHistory }) {
                    historyRef.current = session.history;
                },
            };
        },
        []
    );

    return (
        <div {...rest} style={{ ...styles.container, ...style }}>
            <pre
                className={preClassName}
                aria-hidden="true"
                style={{ ...styles.editor, ...styles.highlight, ...contentStyle }}
                {...(typeof highlighted === 'string'
                    ? { dangerouslySetInnerHTML: { __html: highlighted + '<br />' } }
                    : { children: highlighted })}
            />
            <textarea
                ref={(c) => { inputRef.current = c; }}
                style={{
                    ...styles.editor,
                    ...styles.textarea,
                    ...contentStyle,
                }}
                className={
                    textareaBaseClassName + (textareaClassName ? ` ${textareaClassName}` : '')
                }
                id={textareaId}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onClick={onClick}
                onKeyUp={onKeyUp}
                onFocus={onFocus}
                onBlur={onBlur}
                disabled={disabled}
                form={form}
                maxLength={maxLength}
                minLength={minLength}
                name={name}
                placeholder={placeholder}
                readOnly={readOnly}
                required={required}
                autoFocus={autoFocus}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-gramm={false}
            />
            <style dangerouslySetInnerHTML={{ __html: cssText }} />
        </div>
    );
});

const styles = {
    container: {
        position: 'relative',
        textAlign: 'left',
        boxSizing: 'border-box',
        padding: 0,
        overflow: 'hidden',
    },
    textarea: {
        position: 'absolute',
        top: 0,
        left: 0,
        height: '100%',
        width: '100%',
        resize: 'none',
        color: 'inherit',
        overflow: 'hidden',
        MozOsxFontSmoothing: 'grayscale',
        WebkitFontSmoothing: 'antialiased',
        WebkitTextFillColor: 'transparent',
    },
    highlight: {
        position: 'relative',
        pointerEvents: 'none',
    },
    editor: {
        margin: 0,
        border: 0,
        background: 'none',
        boxSizing: 'inherit',
        display: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        fontStyle: 'inherit',
        fontVariantLigatures: 'inherit',
        fontWeight: 'inherit',
        letterSpacing: 'inherit',
        lineHeight: 'inherit',
        tabSize: 'inherit',
        textIndent: 'inherit',
        textRendering: 'inherit',
        textTransform: 'inherit',
        whiteSpace: 'pre-wrap',
        wordBreak: 'keep-all',
        overflowWrap: 'break-word',
    },
} as const;

export default CodeEditor;
