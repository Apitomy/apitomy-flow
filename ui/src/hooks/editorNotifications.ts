import type { Workflow } from '../types/workflow.ts';
import type { ChangeMeta } from '../changeset/types.ts';
import type { EditorState } from './editorState.ts';

/** Creates a per-mount publisher for committed revisions; safe to invoke again during effect replay. */
export function createDocumentPublisher(): (state: EditorState, onChange: (document: Workflow, meta: ChangeMeta) => void) => void {
    let emittedRevision = 0;
    return (state, onChange) => {
        if (emittedRevision === state.revision) return;
        emittedRevision = state.revision;
        onChange(structuredClone(state.document), { contentRevision: state.contentRevision, origin: state.origin });
    };
}
