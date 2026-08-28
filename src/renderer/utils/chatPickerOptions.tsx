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
 * plain `<select>` -- e.g. Chat.tsx's More panel persona switcher and its model picker. One
 * definition each keeps both surfaces showing identical option content instead of drifting.
 */

export function buildCharacterPickerOptions(
  characters: Character[],
  coverUrls: Record<string, string | null>
): StartPickerOption[] {
  return characters.map((c) => ({
    value: c.id,
    label: c.name,
    subtext: c.description,
    imageUrl: coverUrls[c.id] ?? null,
    fallbackGlyph: c.name.charAt(0).toUpperCase() || '?',
  }));
}

export function buildPersonaPickerOptions(
  personas: UserPersona[],
  coverUrls: Record<string, string | null>
): StartPickerOption[] {
  return personas.map((p) => ({
    value: p.id,
    label: p.name,
    subtext: p.description,
    imageUrl: coverUrls[p.id] ?? null,
    fallbackGlyph: p.name.charAt(0).toUpperCase() || '◎',
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
