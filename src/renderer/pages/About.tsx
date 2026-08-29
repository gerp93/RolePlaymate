import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import AboutStepper from '../components/AboutStepper';
import AboutFaq from '../components/AboutFaq';
import { useOllamaConnection } from '../hooks/useOllamaConnection';
import { ABOUT_TRACKS, ABOUT_TRACK_ORDER } from './aboutGuides';
import './About.css';

const TRACKS_BY_ID = Object.fromEntries(ABOUT_TRACKS.map((t) => [t.id, t]));

/** Set when navigating here via a "Learn more" link that should land on a specific guide step
 * (e.g. Chat's embedding-model notice) instead of the guides hub. */
interface AboutNavState {
  trackId?: string;
  stepIndex?: number;
}

export default function About() {
  const location = useLocation();
  const navState = (location.state ?? null) as AboutNavState | null;
  const [activeTrackId, setActiveTrackId] = useState<string | null>(navState?.trackId ?? null);
  const activeTrack = activeTrackId ? TRACKS_BY_ID[activeTrackId] : null;
  const { state: ollamaState } = useOllamaConnection();

  if (activeTrack) {
    return (
      <div className="about-page about-page-stepper">
        <AboutStepper
          track={activeTrack}
          onExit={() => setActiveTrackId(null)}
          showChatPageLink={ollamaState.status === 'ready'}
          initialStepIndex={navState?.stepIndex}
        />
      </div>
    );
  }

  return (
    <div className="about-page">
      <div className="about-hub">
        <div className="about-hub-main">
          <header className="about-hero card">
            <h1 className="about-hero-title">Guides</h1>
            <p className="about-hero-text text-muted">
              RolePlaymate stores characters and lore locally, then runs chat through Ollama on your machine.
              Choose a guide below — each walks through one topic step by step.
            </p>
            <div className="about-hero-flow" aria-hidden>
              <span className="about-hero-chip">Character</span>
              <span className="about-hero-arrow">+</span>
              <span className="about-hero-chip">Scenario</span>
              <span className="about-hero-arrow">→</span>
              <span className="about-hero-chip about-hero-chip-accent">Chat</span>
              <span className="about-hero-arrow">←</span>
              <span className="about-hero-chip">Persona</span>
            </div>
          </header>

          <div className="about-tracks">
            {ABOUT_TRACK_ORDER.map((id, i) => {
              const track = TRACKS_BY_ID[id];
              if (!track) return null;
              return (
                <button
                  key={track.id}
                  type="button"
                  className={`card about-track-card${i === 0 ? ' about-track-card-first' : ''}`}
                  onClick={() => setActiveTrackId(track.id)}
                >
                  <div className="about-track-card-top">
                    <span className="about-track-icon" aria-hidden>
                      {track.icon}
                    </span>
                    <span
                      className={`about-level about-level-${track.level.replace(/\s+/g, '-').toLowerCase()}`}
                    >
                      {track.level}
                    </span>
                  </div>
                  <h2 className="about-track-card-title">{track.title}</h2>
                  <p className="about-track-card-subtitle text-muted">{track.subtitle}</p>
                  <p className="about-track-card-blurb">{track.blurb}</p>
                  <div className="about-track-card-foot">
                    <span className="about-track-card-meta text-muted">{track.steps.length} steps</span>
                    <span className="about-track-card-cta" aria-hidden>
                      →
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="about-hub-faq">
          <AboutFaq />
        </aside>
      </div>

      <footer className="about-meta card text-muted">
        <a
          className="about-meta-link"
          href="https://github.com/gerp93/RolePlaymate"
          target="_blank"
          rel="noreferrer"
        >
          GitHub repository
        </a>
        <span className="about-meta-sep" aria-hidden>
          ·
        </span>
        <span>AGPL-3.0</span>
      </footer>
    </div>
  );
}
