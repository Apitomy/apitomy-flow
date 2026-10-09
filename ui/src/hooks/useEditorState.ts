import { useEffect, useReducer, useState } from 'react';
import type { Workflow } from '../types/workflow.ts';
import type { ChangeMeta, ProposalOutcome } from '../changeset/types.ts';
import { createEditorState, editorReducer } from './editorState.ts';
import {
    createDocumentPublisher, createProposalPublisher, createSelectionPublisher, type EditorSelection,
} from './editorNotifications.ts';

/** Host callbacks beyond `onChange`. */
export interface EditorListeners {
    onProposalResolved?: (id: string, outcome: ProposalOutcome) => void;
    onSelectionChange?: (selection: EditorSelection) => void;
}

/** Owns reducer state and publishes only committed document revisions, once under StrictMode replay. */
export function useEditorState(workflow: Workflow, onChange: (workflow: Workflow, meta: ChangeMeta) => void,
    listeners: EditorListeners = {}) {
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
    const [publishProposals] = useState(createProposalPublisher);
    const [publishSelection] = useState(createSelectionPublisher);
    const { onProposalResolved, onSelectionChange } = listeners;
    useEffect(() => {
        publishProposals(state, onProposalResolved);
    }, [state, onProposalResolved, publishProposals]);
    useEffect(() => {
        publishSelection(state, onSelectionChange);
    }, [state, onSelectionChange, publishSelection]);
    return { state, dispatch };
}
