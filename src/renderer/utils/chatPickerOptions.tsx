import { Character } from '../../shared/types/character';
import { UserPersona } from '../../shared/types/userPersona';
import { Scenario } from '../../shared/types/scenario';
import { OllamaModelInfo } from '../../shared/types/ollama';
import { StartPickerOption } from '../components/chat/StartScreenPicker';
import {
  assignModelTiers,
  displayModelName,
  MODEL_CAPABILITY_ICONS,
  MODEL_CAPABILITY_LABELS,
  MODEL_TIER_COLORS,
  modelPickerExtraCapabilities,
  modelPickerSubtext,
} from './modelPresentation';

/**
 * Shared between the pre-conversation start screen (ChatStartScreen) and any mid-conversation
 * control that wants the same rich, portrait-and-subtext {@link StartScreenPicker} instead of a
 * plain `<select>` -- e.g. Chat Settings' persona switcher and the composer's model picker. One
 * definition each keeps both surfaces showing identical option content instead of drifting.
 */

/** Small pill row naming which World Books a character/persona taps into -- shown only for
 * whichever one is currently selected (see worldBookNames below), so a library with many
 * shared books never turns the picker's dropdown list noisy. */
const MAX_VISIBLE_WORLD_BOOK_BADGES = 2;

/** Capped to a single line -- the start screen's panels are absolutely positioned, so a
 * pill row that wraps grows downward into the scenario bubble. Overflow collapses into a
 * "+N" pill, with the full list on hover. */
function worldBookBadges(names: string[]) {
  if (names.length === 0) return undefined;
  const visible = names.slice(0, MAX_VISIBLE_WORLD_BOOK_BADGES);
  const hiddenCount = names.length - visible.length;
  return (
    <span className="start-picker-worldbook-badges" title={names.join(', ')}>
      {visible.map((name) => (
        <span key={name} className="start-picker-worldbook-badge">
          {name}
        </span>
      ))}
      {hiddenCount > 0 && (
        <span className="start-picker-worldbook-badge start-picker-worldbook-badge-more">+{hiddenCount}</span>
      )}
    </span>
  );
}

export function buildCharacterPickerOptions(
  characters: Character[],
  coverUrls: Record<string, string | null>,
  /** World Book names, keyed by character id -- only ever populated for the currently
   * selected character (see ChatStartScreen), so this stays a single cheap fetch rather than
   * one per character in the list. */
  worldBookNames: Record<string, string[]> = {}
): StartPickerOption[] {
  return characters.map((c) => ({
    value: c.id,
    label: c.name,
    subtext: c.description,
    imageUrl: coverUrls[c.id] ?? null,
    fallbackGlyph: c.name.charAt(0).toUpperCase() || '?',
    badges: worldBookBadges(worldBookNames[c.id] ?? []),
  }));
}

export function buildPersonaPickerOptions(
  personas: UserPersona[],
  coverUrls: Record<string, string | null>,
  worldBookNames: Record<string, string[]> = {}
): StartPickerOption[] {
  return personas.map((p) => ({
    value: p.id,
    label: p.name,
    subtext: p.description,
    imageUrl: coverUrls[p.id] ?? null,
    fallbackGlyph: p.name.charAt(0).toUpperCase() || '◎',
    badges: worldBookBadges(worldBookNames[p.id] ?? []),
  }));
}

export function buildScenarioPickerOptions(
  scenarios: Scenario[],
  coverUrls: Record<string, string | null>
): StartPickerOption[] {
  return scenarios.map((s) => ({
    value: s.id,
    label: s.name,
    subtext: s.description,
    imageUrl: coverUrls[s.id] ?? null,
    fallbackGlyph: '◈',
  }));
}

function modelCapabilityBadges(info: OllamaModelInfo) {
  const extra = modelPickerExtraCapabilities(info);
  if (extra.length === 0) {
    return <span className="text-muted">Text only</span>;
  }
  return (
    <>
      {extra.map((cap) => (
        <span key={cap} title={MODEL_CAPABILITY_LABELS[cap] ?? cap}>
          {MODEL_CAPABILITY_ICONS[cap] ?? cap}
        </span>
      ))}
    </>
  );
}

export function buildModelPickerOptions(
  modelOptions: OllamaModelInfo[],
  /** Rank tiers against every installed model so labels match the Model Tuning table. */
  tierRankModels?: OllamaModelInfo[]
): StartPickerOption[] {
  const modelTiers = assignModelTiers(tierRankModels ?? modelOptions);
  return modelOptions.map((m) => {
    const tier = modelTiers[m.name];
    return {
      value: m.name,
      label: displayModelName(m),
      detail: m.name,
      subtext: modelPickerSubtext(m),
      imageUrl: null,
      fallbackGlyph: '✦',
      tier: tier ? { label: tier, color: MODEL_TIER_COLORS[tier] } : undefined,
      badges: modelCapabilityBadges(m),
    };
  });
}
