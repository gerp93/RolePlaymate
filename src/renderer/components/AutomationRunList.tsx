import { useState } from 'react';
import { AutomationExportFormat, AutomationRunSummary } from '../../shared/types/automation';
import { durationBetween } from '../../shared/utils/formatDuration';

const STATUS_LABEL: Record<AutomationRunSummary['status'], string> = {
  running: 'Running',
  completed: 'Completed',
  stopped: 'Stopped',
  skipped: 'Skipped',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

interface Props {
  runs: AutomationRunSummary[];
  /** Name the conversation each run was in -- for the all-runs list, where it is not obvious. */
  showConversation?: boolean;
  /** Called after a run is deleted, so the owner can refetch. */
  onChanged: () => void | Promise<void>;
  emptyText: string;
}

/** One list of automated runs with Export / Delete -- used by the chat's Automate tab (this
 * conversation's runs) and the Settings page's Automated Runs tab (all of them). */
export default function AutomationRunList({ runs, showConversation = false, onChanged, emptyText }: Props) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleExport = async (runId: string, format: AutomationExportFormat) => {
    setNotice(null);
    try {
      const result = await window.electronAPI.automation.export(runId, format);
      if (result.saved) setNotice(`Saved to ${result.path}`);
    } catch (exportError) {
      setNotice(`Export failed: ${(exportError as Error).message}`);
    }
  };

  const handleDelete = async (runId: string) => {
    setConfirmDeleteId(null);
    try {
      await window.electronAPI.automation.delete(runId);
      await onChanged();
    } catch (deleteError) {
      setNotice(`Delete failed: ${(deleteError as Error).message}`);
    }
  };

  return (
    <>
      {runs.length === 0 && <p className="automation-help">{emptyText}</p>}
      <ul className="automation-runs">
        {runs.map((run) => (
          <li key={run.id} className="automation-run">
            <div className="automation-run-head">
              <span className={`automation-status automation-status-${run.status}`}>{STATUS_LABEL[run.status]}</span>
              <span className="automation-run-title">
                {run.characterName} &amp; {run.personaName}
              </span>
            </div>
            {showConversation && <div className="automation-run-meta">Chat: {run.conversationTitle}</div>}
            <div className="automation-run-meta">
              {run.completedTurns}/{run.requestedTurns} turns · {run.model} · {formatWhen(run.startedAt)}
              {durationBetween(run.startedAt, run.finishedAt) ? ` · took ${durationBetween(run.startedAt, run.finishedAt)}` : ''}
            </div>
            {run.error && <div className="automation-run-error">{run.error}</div>}
            {run.status !== 'running' && (
              <div className="automation-run-actions">
                <button type="button" className="btn" onClick={() => void handleExport(run.id, 'json')}>
                  Export JSON
                </button>
                <button type="button" className="btn" onClick={() => void handleExport(run.id, 'md')}>
                  Export Markdown
                </button>
                {confirmDeleteId === run.id ? (
                  <>
                    <button type="button" className="btn btn-danger" onClick={() => void handleDelete(run.id)}>
                      Delete log
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirmDeleteId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn" onClick={() => setConfirmDeleteId(run.id)}>
                    Delete
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {notice && <p className="automation-help">{notice}</p>}
      <p className="automation-help">
        Deleting a log does not delete the conversation it was run in. Exported files are plain text, even when
        app encryption is on.
      </p>
    </>
  );
}
