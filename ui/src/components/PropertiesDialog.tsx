import { useId, type ReactNode } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, ModalVariant } from '@patternfly/react-core';
import type { FlowTheme } from './WorkflowEditor.tsx';
import './PropertiesDialog.css';

/** Props for {@link PropertiesDialog}. */
export interface PropertiesDialogProps {
  /** Dialog title, e.g. "Action: Plan Mitigation". */
  title: string;
  theme: FlowTheme;
  onClose: () => void;
  /** The embedded properties editor. */
  children: ReactNode;
}

/**
 * Modal host for the node/edge properties editor, used when `WorkflowEditor` shows properties in a dialog.
 * Edits inside are live (exactly as in the side panel); the dialog only offers Close.
 */
export function PropertiesDialog({ title, theme, onClose, children }: PropertiesDialogProps) {
  const titleId = useId();
  return (
    <Modal variant={ModalVariant.medium} isOpen onClose={onClose} aria-labelledby={titleId}
      className="flow-properties-dialog">
      <ModalHeader title={title} labelId={titleId} />
      <ModalBody>
        {/* The modal is portaled outside the editor, so it carries the editor's theme scope itself. */}
        <div data-flow-theme={theme} className="flow-properties-dialog__body">{children}</div>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
  );
}
