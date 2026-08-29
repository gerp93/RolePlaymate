import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';

export interface AboutStepLink {
  href: string;
  label: string;
  external?: boolean;
}

export interface AboutStep {
  title: string;
  kicker?: string;
  body: ReactNode;
  pageLink?: { to: string; label: string };
  extraLinks?: AboutStepLink[];
}

export type AboutTrackLevel = 'Start here' | 'Core' | 'Advanced';

export interface AboutTrack {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  icon: string;
  level: AboutTrackLevel;
  steps: AboutStep[];
}

interface Props {
  track: AboutTrack;
  onExit?: () => void;
  /** Hub mode shows a back-to-guides control; standalone is for embedded flows like Chat setup. */
  variant?: 'hub' | 'standalone';
  finishLabel?: string;
  onFinish?: () => void;
  finishDisabled?: boolean;
  /** When false, the last step has no primary action (e.g. Chat setup — Ollama is rechecked automatically). */
  showFinishButton?: boolean;
  /** When false, step footers omit links to /chat (Ollama must be up for Chat to work). */
  showChatPageLink?: boolean;
  /** Opens directly on this step instead of the first -- e.g. a "Learn more" link that should
   * land on the exact step it's about, not make the reader click through from the start. */
  initialStepIndex?: number;
}

export default function AboutStepper({
  track,
  onExit,
  variant = 'hub',
  finishLabel,
  onFinish,
  finishDisabled = false,
  showFinishButton = true,
  showChatPageLink = true,
  initialStepIndex = 0,
}: Props) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialStepIndex, 0), track.steps.length - 1)
  );
  const step = track.steps[index];
  const isFirst = index === 0;
  const isLast = index === track.steps.length - 1;
  const progress = ((index + 1) / track.steps.length) * 100;
  const pageLink =
    step.pageLink && (showChatPageLink || step.pageLink.to !== '/chat') ? step.pageLink : undefined;
  const showStepFooter = pageLink || (step.extraLinks && step.extraLinks.length > 0);

  return (
    <div className="about-stepper">
      <header className="about-stepper-header">
        {variant === 'hub' && onExit ? (
          <button type="button" className="btn about-hub-back" onClick={onExit}>
            ← Guides
          </button>
        ) : (
          <div className="about-stepper-header-spacer" aria-hidden />
        )}
        <div className="about-stepper-heading">
          <span className="about-track-icon" aria-hidden>
            {track.icon}
          </span>
          <div>
            <h1 className="about-stepper-title">{track.title}</h1>
            <p className="about-stepper-subtitle text-muted">{track.subtitle}</p>
          </div>
        </div>
      </header>

      <div className="about-progress-row" aria-live="polite">
        <span className="about-progress-text text-muted">
          {index + 1} / {track.steps.length}
        </span>
        <div className="about-progress-track" aria-hidden>
          <div className="about-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <nav className="about-step-dots" aria-label="Guide steps">
        {track.steps.map((s, i) => (
          <button
            key={s.title}
            type="button"
            className={`about-step-dot${i === index ? ' active' : ''}${i < index ? ' done' : ''}`}
            aria-label={`Step ${i + 1}: ${s.title}`}
            aria-current={i === index ? 'step' : undefined}
            onClick={() => setIndex(i)}
            title={s.title}
          />
        ))}
      </nav>

      <article className="card about-step-card">
        {step.kicker && <p className="about-step-kicker text-muted">{step.kicker}</p>}
        <h2 className="about-step-title">{step.title}</h2>
        <div className="about-step-body">{step.body}</div>
        {showStepFooter && (
          <footer className="about-step-links">
            {pageLink && (
              <Link to={pageLink.to} className="about-link-pill about-link-pill-primary">
                {pageLink.label}
              </Link>
            )}
            {step.extraLinks?.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="about-link-pill"
                >
                  {link.label}
                </a>
              ) : (
                <Link key={link.href} to={link.href} className="about-link-pill">
                  {link.label}
                </Link>
              )
            )}
          </footer>
        )}
      </article>

      <div
        className={[
          'about-step-nav',
          isFirst && 'about-step-nav-forward-only',
          isLast && !showFinishButton && !isFirst && 'about-step-nav-back-only',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {!isFirst && (
          <button type="button" className="btn" onClick={() => setIndex((i) => i - 1)}>
            Back
          </button>
        )}
        {isLast ? (
          showFinishButton ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={finishDisabled}
              onClick={() => (onFinish ? onFinish() : onExit?.())}
            >
              {finishLabel ?? 'Finish'}
            </button>
          ) : null
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setIndex((i) => i + 1)}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}
