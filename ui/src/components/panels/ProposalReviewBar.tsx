import { Button } from '@patternfly/react-core';
import type { StagedProposal } from '../../changeset/types.ts';
import type { ProposalDetails } from '../../changeset/proposalOverlay.ts';

/** Props for {@link ProposalReviewBar}. */
export interface ProposalReviewBarProps {
  proposal: StagedProposal;
  counts: string;
  validation: string;
  details: ProposalDetails | null;
  onAccept: () => void;
  onReject: () => void;
}

const show = (value: unknown, missing: string) => (value === null ? missing : JSON.stringify(value, null, 2));

/** Floating review bar for the staged proposal: summary, counts, validation delta and accept/reject. */
export function ProposalReviewBar({ proposal, counts, validation, details, onAccept, onReject }: ProposalReviewBarProps) {
  return (
    <div className="flow-proposal-bar" role="region" aria-label="Proposed changes">
      <div className="flow-proposal-bar__summary">
        <strong>{proposal.changeSet.summary}</strong>
        <span className="flow-proposal-bar__author">{proposal.changeSet.author}</span>
        <span className="flow-proposal-bar__counts">{counts}</span>
        {proposal.stale
          ? <span className="flow-proposal-bar__stale" role="status">Out of date</span>
          : <span className="flow-proposal-bar__validation">{validation}</span>}
      </div>
      <div className="flow-proposal-bar__actions">
        {proposal.stale ? (
          <Button variant="secondary" size="sm" onClick={onReject}>Dismiss</Button>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={onAccept}>Accept</Button>
            <Button variant="secondary" size="sm" onClick={onReject}>Reject</Button>
          </>
        )}
      </div>
      {details && (
        <div className="flow-proposal-bar__details" role="group" aria-label={`Proposed change to ${details.id}`}>
          <div><h4>Before</h4><pre>{show(details.before, '(new)')}</pre></div>
          <div><h4>After</h4><pre>{show(details.after, '(removed)')}</pre></div>
        </div>
      )}
    </div>
  );
}
