import { useId, useMemo, useState } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, ModalVariant } from '@patternfly/react-core';
import { ExpandIcon } from '@patternfly/react-icons';
import { previewValue } from '../../utils/valuePreview.ts';
import { type FlowTheme } from '../WorkflowEditor.tsx';
import { JsonCodeEditor } from './JsonCodeEditor.tsx';
import './ValueDisplay.css';

interface ValueDisplayProps {
  /** The value to display. */
  value: unknown;
  /** Title for the full-value dialog, e.g. `Output: triageNotes`. */
  title: string;
  /** The theme applied to the dialog content (which renders outside the themed viewer root). */
  theme?: FlowTheme;
}

/**
 * Displays a value inline, shortened when it is too long, with a "View" button that opens a dialog
 * showing the complete value — pretty-printed and highlighted when it is JSON.
 */
export function ValueDisplay({ value, title, theme = 'light' }: ValueDisplayProps) {
  const preview = useMemo(() => previewValue(value), [value]);
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const titleId = `flow-value-dialog-${useId()}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview.full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context); the value is still selectable in the dialog.
    }
  };

  return (
    <span className="workflow-viewer__context-value flow-value-display">
      <span className="flow-value-display__text">
        {preview.short}
      </span>
      {preview.truncated && (
        <Button
          variant="plain"
          size="sm"
          className="flow-value-display__view"
          aria-label={`View full value of ${title}`}
          icon={<ExpandIcon />}
          onClick={() => setIsOpen(true)}
        />
      )}
      {isOpen && (
        <Modal
          variant={ModalVariant.medium}
          isOpen
          onClose={() => setIsOpen(false)}
          aria-labelledby={titleId}
        >
          <ModalHeader title={title} labelId={titleId} />
          <ModalBody>
            <div data-flow-theme={theme} className="flow-value-display__full">
              {preview.isJson ? (
                <JsonCodeEditor value={preview.full} readOnly minRows={4} ariaLabel={`${title} (read-only)`}
                  className="flow-value-display__json" />
              ) : (
                <pre className="flow-value-display__pre">{preview.full}</pre>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
            <Button variant="primary" onClick={() => setIsOpen(false)}>Close</Button>
          </ModalFooter>
        </Modal>
      )}
    </span>
  );
}
