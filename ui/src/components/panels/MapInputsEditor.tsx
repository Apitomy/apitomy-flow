import { useState } from 'react';
import type { JsonObject } from '../../types/workflow.ts';
import { duplicateKeys, nextPairId, inputValueText } from '../../utils/mapInputs.ts';
import { createMapDraft, editMapDraft, syncMapDraft, type MapDraftPair } from '../../utils/mapInputDraft.ts';

/**
 * Shared action/human input editor. Owns row identities and unsaved duplicate/empty-key drafts;
 * the parent owns serialized JSON and explicitly resets drafts on selection/history/import changes.
 * Untouched literals retain their JSON types; editing a value creates an expression string.
 */
export function MapInputsEditor({ map, onChange, draftIdentity, keyPlaceholder, valuePlaceholder }: {
    map: JsonObject | null | undefined;
    onChange: (map: JsonObject) => void;
    draftIdentity: string;
    keyPlaceholder: string;
    valuePlaceholder: string;
}) {
    const [draft, setDraft] = useState(() => createMapDraft(map, draftIdentity));
    const synced = syncMapDraft(draft, map, draftIdentity);
    if (synced !== draft) setDraft(synced);
    const pairs = synced.pairs;
    const dupes = duplicateKeys(pairs);

    const commit = (next: MapDraftPair[]) => {
        const edited = editMapDraft(synced, next);
        setDraft(edited);
        onChange(edited.map);
    };

    return (
        <div className="properties-panel__inputs-list">
            {pairs.map((pair, i) => (
                <div key={pair.id} className="properties-panel__input-item">
                    <div className="properties-panel__input-row">
                        <input type="text" className={dupes.has(pair.key) ? 'properties-panel__input-invalid' : undefined}
                            value={pair.key} placeholder={keyPlaceholder}
                            onChange={(e) => commit(pairs.map((p, j) => j === i ? { ...p, key: e.target.value } : p))} />
                        <button className="properties-panel__match-remove" title="Remove input"
                            onClick={() => commit(pairs.filter((_, j) => j !== i))}>&times;</button>
                    </div>
                    <input type="text" value={inputValueText(pair.value)} placeholder={valuePlaceholder}
                        onChange={(e) => commit(pairs.map((p, j) => j === i ? { ...p, value: e.target.value } : p))} />
                    {dupes.has(pair.key) && <div className="properties-panel__input-warning">
                        Duplicate key "{pair.key}" — only the last entry will be saved.
                    </div>}
                    {pair.key === '' && <div className="properties-panel__input-warning">
                        Key is empty — enter a name so this entry is saved.
                    </div>}
                </div>
            ))}
            <button className="properties-panel__match-add"
                onClick={() => commit([...pairs, { id: nextPairId(), key: '', value: '' }])}>+ Add input</button>
        </div>
    );
}
