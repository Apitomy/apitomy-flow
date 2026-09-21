import { useEffect, useReducer, useState } from 'react';
import type { Workflow } from '../types/workflow.ts';
import { createEditorState, editorReducer } from './editorState.ts';
import { createDocumentPublisher } from './editorNotifications.ts';

/** Owns reducer state and publishes only committed document revisions, once under StrictMode replay. */
export function useEditorState(workflow: Workflow, onChange: (workflow: Workflow) => void) {
    const [state, dispatch] = useReducer(editorReducer, workflow, createEditorState);
    const metadata = JSON.stringify([workflow.id, workflow.name, workflow.description, workflow.version]);
    const [previousMetadata, setPreviousMetadata] = useState(metadata);
    // Preserve the existing mount-initialized graph API and live host metadata. Adjust before commit
    // so children and onChange never observe a graph paired with half-updated metadata.
    if (metadata !== previousMetadata) {
        setPreviousMetadata(metadata);
        dispatch({ type: 'metadata', metadata: workflow });
    }
    const [publish] = useState(createDocumentPublisher);
    useEffect(() => {
        publish(state, onChange);
    }, [state, onChange, publish]);
    return { state, dispatch };
}
