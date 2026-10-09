import { useAutomation } from '../hooks/useAutomation';
import AutomationRunList from './AutomationRunList';

/**
 * Settings -> Automated Runs: every automated run's log, across all conversations. Runs are
 * started from a chat's Automate tab; this is where they are all kept in one place. The list
 * follows a run in progress live (see useAutomation).
 */
export default function AutomatedRunsPanel() {
  // No conversation to mirror here, so nothing to reload when a run writes to one.
  const automation = useAutomation(null, () => {});

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Automated Runs</h2>
      <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
        Logs of runs started from a chat&apos;s Automate tab, newest first. Each keeps the transcript, the exact prompts
        sent, and which memories were injected or left out on every turn. Export one as JSON (everything) or Markdown
        (readable) to share it.
      </p>
      <AutomationRunList
        runs={automation.runs}
        showConversation
        onChanged={automation.refreshRuns}
        emptyText="No automated runs yet. Open a chat, go to the Automate tab in its right sidebar, and press Start."
      />
    </div>
  );
}
