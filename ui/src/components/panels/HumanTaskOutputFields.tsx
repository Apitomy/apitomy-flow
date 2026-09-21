import type { HumanTaskOutput, JsonValue, OutputOption } from '../../types/workflow.ts';

/** Edits select options without discarding host extension fields on existing declarations. */
export function OptionsEditor({ options, onChange }: {
    options: OutputOption[];
    onChange: (options: OutputOption[]) => void;
}) {
    return (
        <div className="properties-panel__output-field">
            <label>Options</label>
            <div className="properties-panel__options-list">
                {options.map((opt, i) => (
                    <div key={i} className="properties-panel__option-row">
                        <input type="text" value={opt.label ?? ''} placeholder="Label"
                            onChange={(e) => onChange(options.map((o, j) => j === i ? { ...o, label: e.target.value } : o))} />
                        <input type="text" value={opt.value ?? ''} placeholder="Value"
                            onChange={(e) => onChange(options.map((o, j) => j === i ? { ...o, value: e.target.value } : o))} />
                        <button className="properties-panel__match-remove" title="Remove option"
                            onClick={() => onChange(options.filter((_, j) => j !== i))}>&times;</button>
                    </div>
                ))}
                <button className="properties-panel__match-add"
                    onClick={() => onChange([...options, { label: '', value: '' }])}>+ Add option</button>
            </div>
        </div>
    );
}

/** Type-aware human-task default form; invalid object text stays editable as a string draft. */
export function DefaultValueEditor({ output, onChange }: {
    output: HumanTaskOutput;
    onChange: (value: JsonValue | undefined) => void;
}) {
    const type = output.type ?? 'string';
    if (type === 'boolean') {
        return <label className="properties-panel__input-required">
            <input type="checkbox" checked={output.defaultValue === true}
                onChange={(e) => onChange(e.target.checked ? true : undefined)} />
            Default checked
        </label>;
    }
    if (type === 'number') {
        return <input type="number" value={typeof output.defaultValue === 'number' ? output.defaultValue : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />;
    }
    if (type === 'string' && output.widget === 'select') {
        return <select value={typeof output.defaultValue === 'string' ? output.defaultValue : ''}
            onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">(none)</option>
            {(output.options ?? []).map((o, i) => (
                <option key={i} value={o.value ?? ''}>{o.label || o.value}</option>
            ))}
        </select>;
    }
    if (type === 'object') {
        const text = typeof output.defaultValue === 'string' ? output.defaultValue
            : output.defaultValue != null ? JSON.stringify(output.defaultValue) : '';
        return <textarea rows={2} value={text} placeholder='{ "key": "value" }' onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') { onChange(undefined); return; }
            try { onChange(JSON.parse(raw)); } catch { onChange(raw); }
        }} />;
    }
    return <input type="text" value={typeof output.defaultValue === 'string' ? output.defaultValue : ''}
        onChange={(e) => onChange(e.target.value || undefined)} />;
}
