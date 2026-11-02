import { useState } from 'react';
import {
  AssistantProposal,
  CreatePayload,
  NewVersionPayload,
  PROPOSAL_FIELD_LABELS,
  ProposalField,
} from '../../../shared/types/assistant';
import { diffVersionContent } from '../../../shared/utils/versionDiff';

interface Props {
  proposal: AssistantProposal;
  onResolved: (proposal: AssistantProposal) => void;
}

const STATUS_LABEL: Record<AssistantProposal['status'], string> = {
  pending: 'Waiting for you',
  applied: 'Applied',
  rejected: 'Rejected',
  failed: 'Could not apply',
};

function NewVersionBody({ payload }: { payload: NewVersionPayload }) {
  const [showDiff, setShowDiff] = useState(true);
  const diff = diffVersionContent(payload.before, payload.after);
  return (
    <>
      <div className="assistant-proposal-toggle">
        <button type="button" className="btn" onClick={() => setShowDiff((v) => !v)}>
          {showDiff ? 'Show new text only' : 'Show changes'}
        </button>
      </div>
      <div className="version-diff-body assistant-proposal-text">
        {showDiff
          ? diff.map((part, i) => (
              <span key={i} className={part.type !== 'unchanged' ? `version-diff-${part.type}` : undefined}>
                {part.text}
              </span>
            ))
          : payload.after}
      </div>
    </>
  );
}

function CreateBody({ payload }: { payload: CreatePayload }) {
  const fields = Object.entries(payload.fields).filter(([, text]) => text) as [ProposalField, string][];
  return (
    <div className="assistant-proposal-text">
      {payload.ownerName && (
        <p className="text-muted" style={{ marginTop: 0 }}>
          Belongs to {payload.ownerName}
        </p>
      )}
      {payload.description && (
        <p>
          <strong>Description:</strong> {payload.description}
        </p>
      )}
      {fields.map(([field, text]) => (
        <div key={field}>
          <strong>{PROPOSAL_FIELD_LABELS[field]}</strong>
          <div className="assistant-proposal-field">{text}</div>
        </div>
      ))}
      {fields.length === 0 && !payload.description && <p className="text-muted">Name only -- no text yet.</p>}
    </div>
  );
}

/**
 * One change the assistant suggests. Nothing here has touched the library: Apply is the only thing
 * that writes, and it adds a new version (or a new item), so the text it replaces stays in history.
 */
export default function ProposalCard({ proposal, onResolved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const title =
    proposal.action === 'newVersion'
      ? `${(proposal.payload as NewVersionPayload).entityName} -- ${PROPOSAL_FIELD_LABELS[(proposal.payload as NewVersionPayload).field]}`
      : `New ${proposal.entity}: ${(proposal.payload as CreatePayload).name}`;

  const resolve = async (action: 'apply' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      if (action === 'apply') {
        const result = await window.electronAPI.assistant.applyProposal(proposal.id);
        setApplied(result.proposal.status === 'applied' ? result.message : null);
        onResolved(result.proposal);
      } else {
        onResolved(await window.electronAPI.assistant.rejectProposal(proposal.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const open = proposal.status === 'pending' || proposal.status === 'failed';

  return (
    <div className={`assistant-proposal assistant-proposal-${proposal.status}`}>
      <div className="assistant-proposal-header">
        <div>
          <div className="assistant-proposal-title">{title}</div>
          <div className="text-muted assistant-proposal-summary">{proposal.summary}</div>
        </div>
        <span className="assistant-proposal-status">{STATUS_LABEL[proposal.status]}</span>
      </div>

      {proposal.action === 'newVersion' ? (
        <NewVersionBody payload={proposal.payload as NewVersionPayload} />
      ) : (
        <CreateBody payload={proposal.payload as CreatePayload} />
      )}

      {proposal.status === 'failed' && proposal.error && <p className="field-error">{proposal.error}</p>}
      {error && <p className="field-error">{error}</p>}
      {applied && <p className="text-muted assistant-proposal-note">{applied}</p>}

      {open && (
        <div className="assistant-proposal-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void resolve('apply')}>
            {proposal.action === 'create' ? 'Create' : 'Apply as new version'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void resolve('reject')}>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
