interface Props {
  completedTurns: number;
  requestedTurns: number;
  /** A second line under the bar, such as which step the run is on. */
  detail?: string;
  /** Replaces "Turn N of M" -- for progress that is not counted in turns of one run. */
  label?: string;
}

/** Percent of turns finished, 0-100. */
export function automationPercent(completedTurns: number, requestedTurns: number): number {
  if (requestedTurns <= 0) return 0;
  return Math.min(100, Math.round((completedTurns / requestedTurns) * 100));
}

/**
 * A run's progress: the turn being worked on as a fraction ("Turn 26 of 100", which is what a
 * person asks), and a bar with the percent finished. Used on the Automate tab and on the panel
 * that covers the locked composer.
 */
export default function AutomationProgress({ completedTurns, requestedTurns, detail, label }: Props) {
  const percent = automationPercent(completedTurns, requestedTurns);
  const turn = Math.min(completedTurns + 1, requestedTurns);

  return (
    <div className="automation-progress-block" role="status">
      <div className="automation-progress-head">
        <strong>{label ?? `Turn ${turn} of ${requestedTurns}`}</strong>
        <span>{percent}%</span>
      </div>
      <div
        className="automation-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Automated run progress"
      >
        <div className="automation-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      {detail && <span className="automation-progress-detail">{detail}</span>}
    </div>
  );
}
