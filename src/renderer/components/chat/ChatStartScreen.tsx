import type { ReactNode } from 'react';
import { Character } from '../../../shared/types/character';
import { UserPersona } from '../../../shared/types/userPersona';
import { Scenario } from '../../../shared/types/scenario';
import {
  buildCharacterPickerOptions,
  buildPersonaPickerOptions,
  buildScenarioPickerOptions,
} from '../../utils/chatPickerOptions';
import { StartPickerOption } from './StartScreenPicker';
import { toImageUrl } from '../../utils/imageUrl';
import { ImageCrop, ImageCropLocation, ImageCropOwner } from '../../../shared/types/imageCrop';
import CroppableImage from '../CroppableImage';
import StartScreenPicker from './StartScreenPicker';

/** What one of the three main start-screen bubbles needs to render a real portrait -- the
 * underlying image's id (for the crop editor) alongside its already-resolved display url. */
export interface StartPortrait {
  id: string;
  url: string;
}
/** SVG viewBox coords — keep in sync with bubble positions/sizes in Chat.css. */
const CHAR_X = 18;
const CHAR_Y = 16;
const SCENARIO_X = 5;
const SCENARIO_Y = 58;
const BUBBLE_R = 11;
const SCENARIO_BUBBLE_R = BUBBLE_R * 0.75;
/** 8 o'clock on the portrait — SVG angle from +x, y-down (150°). */
const CHAR_SCENARIO_EXIT_ANGLE = (5 * Math.PI) / 6;

function characterToScenarioBranch() {
  const x1 = CHAR_X + BUBBLE_R * Math.cos(CHAR_SCENARIO_EXIT_ANGLE);
  const y1 = CHAR_Y + BUBBLE_R * Math.sin(CHAR_SCENARIO_EXIT_ANGLE);
  const dx = SCENARIO_X - x1;
  const dy = SCENARIO_Y - y1;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) {
    return { x1, y1, x2: SCENARIO_X, y2: SCENARIO_Y };
  }
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    x1,
    y1,
    x2: SCENARIO_X - ux * SCENARIO_BUBBLE_R,
    y2: SCENARIO_Y - uy * SCENARIO_BUBBLE_R,
  };
}

interface Props {
  characters: Character[];
  personas: UserPersona[];
  scenarios: Scenario[];
  modelPickerOptions: StartPickerOption[];
  modelsReady: boolean;
  characterId: string;
  personaId: string;
  scenarioId: string;
  model: string;
  characterPortrait: StartPortrait | null;
  personaPortrait: StartPortrait | null;
  scenarioPortrait: StartPortrait | null;
  characterCoverUrls: Record<string, string | null>;
  personaCoverUrls: Record<string, string | null>;
  scenarioCoverUrls: Record<string, string | null>;
  /** Every crop known for any image that could appear here -- shared with Chat.tsx's margin
   * portraits rather than fetched separately, since it's the same underlying galleries. */
  crops: Record<string, Partial<Record<ImageCropLocation, ImageCrop>>>;
  onCropSaved: () => void;
  onCharacterChange: (id: string) => void;
  onPersonaChange: (id: string) => void;
  onScenarioChange: (id: string) => void;
  onModelChange: (name: string) => void;
  onStart: () => void;
}

function ScenarioBubble({
  portrait,
  name,
  unselected,
  crop,
  onCropSaved,
}: {
  portrait: StartPortrait | null;
  name: string;
  unselected: boolean;
  crop?: ImageCrop | null;
  onCropSaved: () => void;
}) {
  return (
    <div className={`chat-start-portrait${unselected ? ' chat-start-portrait-unselected' : ''}`}>
      {portrait ? (
        <CroppableImage
          src={portrait.url}
          alt={name}
          imageId={portrait.id}
          imageOwner="scenario"
          location="chatStart"
          crop={crop}
          onCropSaved={onCropSaved}
        />
      ) : (
        <span className="chat-start-portrait-glyph" aria-hidden>
          ◈
        </span>
      )}
    </div>
  );
}

function ModelBubble() {
  return (
    <div className="chat-start-portrait">
      <span className="chat-start-portrait-glyph" aria-hidden>
        ✦
      </span>
    </div>
  );
}

function PortraitFrame({
  portrait,
  alt,
  fallback,
  imageOwner,
  crop,
  onCropSaved,
}: {
  portrait: StartPortrait | null;
  alt: string;
  fallback: string;
  imageOwner: ImageCropOwner;
  crop?: ImageCrop | null;
  onCropSaved: () => void;
}) {
  return (
    <div className="chat-start-portrait">
      {portrait ? (
        <CroppableImage
          src={portrait.url}
          alt={alt}
          imageId={portrait.id}
          imageOwner={imageOwner}
          location="chatStart"
          crop={crop}
          onCropSaved={onCropSaved}
        />
      ) : (
        <span className="chat-start-portrait-fallback">{fallback}</span>
      )}
    </div>
  );
}

function StartNode({
  placement,
  unselected,
  role,
  children,
  panel,
  hint,
}: {
  placement: 'character' | 'persona' | 'scenario' | 'model';
  unselected?: boolean;
  role: string;
  children: ReactNode;
  panel: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <>
      <div
        className={`chat-start-bubble chat-start-bubble-${placement}${unselected ? ' chat-start-bubble-unselected' : ''}`}
      >
        {children}
      </div>
      <div className={`chat-start-panel chat-start-panel-${placement}`}>
        <span className="chat-start-node-role">{role}</span>
        {panel}
        {hint}
      </div>
    </>
  );
}

/**
 * Pre-conversation "title screen": character and persona link across the top; the trunk
 * drops from that midpoint to the model. Scenarios branch off the character as a dead end.
 */
export default function ChatStartScreen({
  characters,
  personas,
  scenarios,
  modelPickerOptions,
  modelsReady,
  characterId,
  personaId,
  scenarioId,
  model,
  characterPortrait,
  personaPortrait,
  scenarioPortrait,
  characterCoverUrls,
  personaCoverUrls,
  scenarioCoverUrls,
  crops,
  onCropSaved,
  onCharacterChange,
  onPersonaChange,
  onScenarioChange,
  onModelChange,
  onStart,
}: Props) {
  const character = characters.find((c) => c.id === characterId) ?? null;
  const selectedPersona = personas.find((p) => p.id === personaId) ?? null;
  const selectedScenario = scenarios.find((s) => s.id === scenarioId) ?? null;
  const ready = Boolean(characterId && personaId && model && modelsReady);
  const hasScenarioSlot = Boolean(characterId && scenarios.length > 0);
  const modelY = 80;
  const partyReady = Boolean(characterId && personaId);
  const bridgeActive = partyReady;
  const trunkActive = partyReady;
  const scenarioBranchActive = Boolean(scenarioId);
  const scenarioBranch = characterToScenarioBranch();
  const trunkClass = (active: boolean) =>
    `chat-start-line chat-start-line-trunk${active ? ' chat-start-line-active' : ''}`;
  const branchClass = (active: boolean) =>
    `chat-start-line chat-start-line-branch${active ? ' chat-start-line-active' : ''}`;

  const characterOptions = buildCharacterPickerOptions(characters, characterCoverUrls);
  const personaOptions = buildPersonaPickerOptions(personas, personaCoverUrls);
  const scenarioOptions = buildScenarioPickerOptions(scenarios, scenarioCoverUrls);

  return (
    <div className={`chat-start-screen${ready ? ' chat-start-screen-ready' : ''}`}>
      <header className="chat-start-header">
        <p className="chat-start-eyebrow">New chat</p>
        <h1 className="chat-start-title">Set the stage</h1>
        <p className="chat-start-subtitle text-muted">
          Who you play, who you meet, where it happens — then pick a voice.
        </p>
      </header>

      <div className={`chat-start-stage${hasScenarioSlot ? ' chat-start-stage-has-scenario' : ''}`}>
        <div
          className={`chat-start-constellation${hasScenarioSlot ? ' chat-start-constellation-has-scenario' : ''}`}
        >
        <svg className="chat-start-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <marker
              id="chat-start-arrow"
              markerWidth="4"
              markerHeight="4"
              refX="3"
              refY="2"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L4,2 L0,4 Z" fill="var(--color-accent-green)" opacity="0.9" />
            </marker>
          </defs>
          <line
            className={`chat-start-line chat-start-line-bridge${bridgeActive ? ' chat-start-line-active' : ''}`}
            x1="18"
            y1="16"
            x2="82"
            y2="16"
          />
          <line
            className={trunkClass(trunkActive)}
            x1="50"
            y1="16"
            x2="50"
            y2={modelY}
            markerEnd={trunkActive ? 'url(#chat-start-arrow)' : undefined}
          />
          {hasScenarioSlot && (
            <line
              className={branchClass(scenarioBranchActive)}
              x1={scenarioBranch.x1}
              y1={scenarioBranch.y1}
              x2={scenarioBranch.x2}
              y2={scenarioBranch.y2}
            />
          )}
          {!hasScenarioSlot && (
            <circle
              className={`chat-start-hub-ring${characterId || personaId ? ' chat-start-hub-ring-active' : ''}`}
              cx="50"
              cy="50"
              r="2.5"
            />
          )}
        </svg>

        <StartNode
          placement="character"
          role="Character"
          panel={
            <StartScreenPicker
              value={characterId}
              onChange={onCharacterChange}
              options={characterOptions}
              placeholder="Select…"
              ariaLabel="Character"
            />
          }
        >
          <PortraitFrame
            portrait={characterPortrait}
            alt={character?.name ?? 'Character'}
            fallback={character?.name?.charAt(0).toUpperCase() ?? '?'}
            imageOwner="character"
            crop={characterPortrait ? crops[characterPortrait.id]?.chatStart : undefined}
            onCropSaved={onCropSaved}
          />
        </StartNode>

        <StartNode
          placement="persona"
          role="Persona"
          unselected={!personaId}
          panel={
            <StartScreenPicker
              value={personaId}
              onChange={onPersonaChange}
              options={personaOptions}
              placeholder="Select…"
              ariaLabel="Persona"
            />
          }
        >
          <PortraitFrame
            portrait={personaPortrait}
            alt={selectedPersona?.name ?? 'Persona'}
            fallback={selectedPersona?.name?.charAt(0).toUpperCase() ?? '◎'}
            imageOwner="persona"
            crop={personaPortrait ? crops[personaPortrait.id]?.chatStart : undefined}
            onCropSaved={onCropSaved}
          />
        </StartNode>

        {hasScenarioSlot ? (
          <StartNode
            placement="scenario"
            role="Scenario"
            unselected={!scenarioId}
            panel={
              <StartScreenPicker
                className="start-screen-picker-scenario"
                value={scenarioId}
                onChange={onScenarioChange}
                options={scenarioOptions}
                placeholder="None"
                allowEmpty
                emptyLabel="None"
                ariaLabel="Scenario"
              />
            }
          >
            <ScenarioBubble
              portrait={scenarioPortrait}
              name={selectedScenario?.name ?? 'Scenario'}
              unselected={!scenarioId}
              crop={scenarioPortrait ? crops[scenarioPortrait.id]?.chatStart : undefined}
              onCropSaved={onCropSaved}
            />
          </StartNode>
        ) : (
          <div className="chat-start-merge-dot" aria-hidden />
        )}

        <StartNode
          placement="model"
          role="Model"
          panel={
            <StartScreenPicker
              className="start-screen-picker-model"
              value={model}
              onChange={onModelChange}
              options={modelPickerOptions}
              placeholder={
                !modelsReady ? '—' : !partyReady ? 'Pick character & persona' : 'Select model…'
              }
              disabled={!modelsReady || !partyReady}
              ariaLabel="Model"
            />
          }
        >
          <ModelBubble />
        </StartNode>
        </div>
      </div>

      <div className="chat-start-actions">
        <button
          type="button"
          className="btn btn-primary chat-start-btn"
          disabled={!ready}
          onClick={onStart}
        >
          {ready ? (
            <>
              <span className="chat-start-btn-icon" aria-hidden>
                ▶
              </span>
              Begin
            </>
          ) : (
            'Choose character, persona & model'
          )}
        </button>
      </div>
    </div>
  );
}

/** Cover portrait for the start screen — first gallery image or null. */
export function startScreenPortraitUrl(images: { path: string; position: number }[]): string | null {
  if (images.length === 0) return null;
  const cover = images.find((i) => i.position === 0) ?? images[0];
  return toImageUrl(cover.path);
}

/** Same cover-image resolution as startScreenPortraitUrl, but for the three main bubbles
 * (character/persona/scenario), which also need the image's id to open its crop editor. */
export function startScreenPortraitImage(
  images: { id: string; path: string; position: number }[]
): StartPortrait | null {
  if (images.length === 0) return null;
  const cover = images.find((i) => i.position === 0) ?? images[0];
  return { id: cover.id, url: toImageUrl(cover.path) };
}
