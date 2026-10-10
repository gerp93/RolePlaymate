import { Link, useLocation } from 'react-router-dom';
import { useAutomation } from '../hooks/useAutomation';
import { useSpeedTestRunning } from '../hooks/useSpeedTestRunning';
import { automationPercent } from './chat/AutomationProgress';

/**
 * A bar across the bottom of every page while an automated run or a speed test is going, so progress
 * is visible wherever you are, with a link to where it can be watched. It is a flex item under the
 * page (not an overlay), so the page above simply gets a little shorter; it is absent when nothing
 * is running.
 *
 * Deliberately says nothing about whose chat it is: an automated run of a hidden character would
 * otherwise show its names while the hidden-items PIN is locked.
 */
export default function RunProgressFooter() {
  const { pathname, search } = useLocation();
  const automation = useAutomation(null, () => {});
  const speedTest = useSpeedTestRunning();

  let label: string;
  let detail: string;
  let percent: number;
  let to: string;

  if (speedTest.progress) {
    const { benchmark, model, completedTurns } = speedTest.progress;
    const total = benchmark.models.length * benchmark.turns;
    const done = Math.min(total, benchmark.finishedModels * benchmark.turns + completedTurns);
    percent = automationPercent(done, total);
    label = 'Speed test';
    detail = `model ${Math.min(benchmark.finishedModels + 1, benchmark.models.length)} of ${benchmark.models.length}${
      model ? ` (${model})` : ''
    } · turn ${Math.min(completedTurns + 1, benchmark.turns)} of ${benchmark.turns}`;
    to = '/model-tuning?tab=speed';
  } else if (automation.active) {
    const run = automation.active;
    percent = automationPercent(run.completedTurns, run.requestedTurns);
    label = 'Automated run';
    detail = `turn ${Math.min(run.completedTurns + 1, run.requestedTurns)} of ${run.requestedTurns}`;
    to = run.conversationId ? `/chat/${run.conversationId}` : '/chat';
  } else {
    return null;
  }

  // Already looking at it: no link to itself.
  const here = to.includes('?') ? pathname + search === to : pathname === to;

  return (
    <footer className="run-footer" role="status" aria-live="polite">
      <strong className="run-footer-label">{label}</strong>
      <span className="run-footer-detail">{detail}</span>
      <div
        className="run-footer-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${label} progress`}
      >
        <div className="run-footer-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="run-footer-percent">{percent}%</span>
      {!here && (
        <Link className="run-footer-link" to={to}>
          View
        </Link>
      )}
    </footer>
  );
}
