import { useEffect, useState } from 'react';
import { PromptTemplates, StopPhraseSettings, TEMPLATE_TAGS, TEMPLATE_FIELD_KEYS } from '../../shared/types/promptTemplates';
import PromptFieldEditor from '../components/PromptFieldEditor';
import LimitedTextarea from '../components/LimitedTextarea';
import { FIELD_LIMITS } from '../../shared/fieldLimits';

type TemplateField = keyof PromptTemplates;

const FIELD_META: Record<TemplateField, { label: string; when: string }> = {
  characterInstructions: { label: 'Character Rules', when: 'Always injected.' },
  personaContext: { label: 'Persona Context', when: 'Injected only when the persona has both a name and background.' },
  directions: { label: 'Per-Turn Directions', when: 'Injected when the composer’s Directions field is used.' },
  memory: { label: 'Memory Recall', when: 'Injected when retrieved memories fired this turn.' },
  worldLore: { label: 'World Lore', when: 'Injected when a world-book entry fired this turn.' },
  personalLore: { label: "Character's Personal History", when: 'Injected when one of the character’s own lore entries fired.' },
  personaLore: { label: "Persona's Personal History", when: 'Injected when one of the persona’s own lore entries fired.' },
};

/** Same six placeholders are valid in every field below, whether or not that field's default
 * text happens to use all of them -- see promptBuilder.ts's wrappedSection. */
const PLACEHOLDER_LEGEND: { token: string; meaning: string }[] = [
  { token: '{char}', meaning: "The character's name." },
  { token: '{persona}', meaning: 'The persona\'s name ("User" when none is selected).' },
  { token: '{persona_background}', meaning: "The persona's background text (empty when none/not selected)." },
  { token: '{directions}', meaning: "This turn's scene directions (empty unless the composer's Directions field was used)." },
  { token: '{memories}', meaning: 'Retrieved memories, pre-rendered as a "- " bulleted list (empty unless any fired).' },
  { token: '{lore}', meaning: "This section's own matched lore entries, pre-rendered (empty for sections with no associated lore)." },
];

/** Enough rows to show the whole thing without an initial scroll. */
function rowsFor(text: string): number {
  return Math.max(3, text.split('\n').length + 2);
}

/** A worked example of the fully-assembled system prompt, every section present at once and
 * filled in with sample values -- in reality most turns only fire a handful of these (see each
 * field's "when" note above), but seeing them all stacked, in the exact order promptBuilder.ts
 * emits them, is the fastest way to see how the pieces actually fit together before editing
 * any one of them in isolation. CHARACTER/PERSONALITY/SCENARIO/EXAMPLE DIALOGUE come from the
 * character's own fields (not editable here); everything after CHARACTER RULES is one of the
 * templates below. */
const SAMPLE_PROMPT = `[CHARACTER]
Name: Aria
A retired starship engineer turned dockmaster, running the last functioning airlock on Station 9.
[/CHARACTER]

[PERSONALITY]
Gruff but soft-hearted. Distrusts strangers until they prove useful. Talks in short, clipped sentences.
[/PERSONALITY]

[SCENARIO]
The station's power grid is failing, and Aria has just noticed {persona} standing in the reactor bay.
[/SCENARIO]

[EXAMPLE DIALOGUE]
{char}: "You lost, or you got a death wish?"
[/EXAMPLE DIALOGUE]

[CHARACTER RULES]
You are ONLY Aria. Write ONLY Aria's own dialogue, actions, and inner thoughts.
Never write, imply, or continue dialogue, actions, or thoughts for Alex or any
other character -- that is exclusively Alex's to write, not yours.
[/CHARACTER RULES]

[USER PERSONA]
The user is playing a character named "Alex". Address them as Alex.
Alex's background: A freelance salvager who grew up on a mining colony.
[/USER PERSONA]

[WORLD INFORMATION]
Established facts about the setting. Treat these as common knowledge and stay consistent with them.
- The east wing lost artificial gravity three days ago and still hasn't been repaired.
[/WORLD INFORMATION]

[Aria - PERSONAL HISTORY]
These are Aria's own memories and private history -- things Aria personally knows, NOT common knowledge.
- Aria once disabled a reactor core rather than let it fall into raider hands.
[/Aria - PERSONAL HISTORY]

[Alex - PERSONAL HISTORY]
These are Alex's own memories and private history -- things Alex personally knows, NOT common knowledge.
- Alex has been quietly investigating who sabotaged their last ship.
[/Alex - PERSONAL HISTORY]

[MEMORY]
Key memories from this conversation -- use these to maintain continuity:
- Alex mentioned they don't trust the dock authority.
[/MEMORY]

[CURRENT SCENE INSTRUCTIONS]
Aria should seem nervous about the reactor readings, but try to hide it.
[/CURRENT SCENE INSTRUCTIONS]`;

export default function PromptSettings() {
  const [stopPhrases, setStopPhrases] = useState<StopPhraseSettings | null>(null);
  const [overriddenFields, setOverriddenFields] = useState<string[]>([]);
  const [stopPhrasesDraft, setStopPhrasesDraft] = useState('');
  const [busyField, setBusyField] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  async function load() {
    const result = await window.electronAPI.promptSettings.get();
    setStopPhrases(result.stopPhrases);
    setOverriddenFields(result.overriddenFields);
    setStopPhrasesDraft(result.stopPhrases.base.join('\n'));
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveStopPhrases() {
    setBusyField('stopPhrasesBase');
    const base = stopPhrasesDraft.split('\n').filter((line) => line.trim());
    await window.electronAPI.promptSettings.updateStopPhrases({ base });
    await load();
    setBusyField(null);
  }

  async function resetStopPhrasesBase() {
    setBusyField('stopPhrasesBase');
    await window.electronAPI.promptSettings.resetField('stopPhrasesBase');
    await load();
    setBusyField(null);
  }

  async function toggleStopSetting(field: 'useCharacterNameAsStop' | 'usePersonaNameAsStop', value: boolean) {
    setBusyField(field);
    await window.electronAPI.promptSettings.updateStopPhrases({ [field]: value });
    await load();
    setBusyField(null);
  }

  async function resetAll() {
    if (!confirm('Reset every system prompt template and stop phrase back to the built-in default? Each template gets a new version with the default text -- your edits stay in its history.')) return;
    setBusyField('all');
    await window.electronAPI.promptSettings.resetAll();
    await load();
    setResetKey((k) => k + 1); // remounts every PromptFieldEditor so they reload their versions
    setBusyField(null);
  }

  if (!stopPhrases) return <div className="text-muted">Loading…</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Prompt Tuning</h1>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '3 1 0', minWidth: 0 }}>
          <p className="text-muted">
            These templates assemble the system prompt sent to the model every turn (see the
            Debug panel in Chat to view the exact result). Editing them here changes every future
            turn for every character. Each section is only injected when its content is relevant
            that turn -- editing a template doesn&apos;t change when it fires, only what it says.
            The <code>[TAG]</code>/<code>[/TAG]</code> wrapper shown above and below each box is
            fixed and not editable, so a section can never end up with a dropped or mismatched
            closing tag -- only the text between them is yours to change. Every field is
            versioned exactly like a character&apos;s fields: only the latest version is
            editable, edits autosave in place, and &quot;Save as New Version&quot; checkpoints
            deliberately. &quot;Reset to Default&quot; never deletes anything -- it creates a new
            version holding the original default text, so any edits stay in history to go back
            to.
          </p>

          {TEMPLATE_FIELD_KEYS.map((field) => (
            <PromptFieldEditor
              key={`${field}-${resetKey}`}
              fieldKey={field}
              label={FIELD_META[field].label}
              when={FIELD_META[field].when}
              tag={TEMPLATE_TAGS[field]}
            />
          ))}

          <div className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>
              Stop Phrases{' '}
              {overriddenFields.includes('stopPhrasesBase') && (
                <span className="text-muted" style={{ fontSize: 12 }}>
                  (edited)
                </span>
              )}
            </h2>
            <p className="text-muted" style={{ marginTop: -8, fontSize: 12 }}>
              Sequences that stop generation when the model produces them -- one per line. A
              leading blank line is significant (e.g. an empty first line before "User:" stops it
              from firing mid-sentence).
            </p>
            <LimitedTextarea
              rows={rowsFor(stopPhrasesDraft)}
              limit={FIELD_LIMITS.stopPhrases}
              value={stopPhrasesDraft}
              onChange={(e) => setStopPhrasesDraft(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 12 }}>
              <button
                className="btn btn-primary"
                disabled={busyField === 'stopPhrasesBase'}
                onClick={() => void saveStopPhrases()}
              >
                Save
              </button>
              <button
                className="btn"
                disabled={!overriddenFields.includes('stopPhrasesBase') || busyField === 'stopPhrasesBase'}
                onClick={() => void resetStopPhrasesBase()}
              >
                Reset to Default
              </button>
            </div>

            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={stopPhrases.useCharacterNameAsStop}
                  onChange={(e) => void toggleStopSetting('useCharacterNameAsStop', e.target.checked)}
                />{' '}
                Also stop on the character's own name (e.g. "Veridia:")
              </label>
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={stopPhrases.usePersonaNameAsStop}
                  onChange={(e) => void toggleStopSetting('usePersonaNameAsStop', e.target.checked)}
                />{' '}
                Also stop on the persona's name (catches the model writing the persona's next line)
              </label>
            </div>
          </div>

          <button className="btn btn-danger" disabled={busyField === 'all'} onClick={() => void resetAll()}>
            Reset All to Defaults
          </button>
        </div>

        <div style={{ flex: '1 1 0', minWidth: 220, position: 'sticky', top: 20 }}>
          <div className="card">
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Placeholders</h2>
            <p className="text-muted" style={{ marginTop: -8, fontSize: 12 }}>
              The same six are valid in every field, whether or not its default text happens to
              use all of them. One that's not relevant to a given turn just resolves to nothing.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {PLACEHOLDER_LEGEND.map(({ token, meaning }) => (
                  <tr key={token}>
                    <td colSpan={2} style={{ padding: '6px 0 0' }}>
                      <div style={{ fontFamily: 'monospace' }}>{token}</div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {meaning}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Example Assembled Prompt</h2>
            <p className="text-muted" style={{ marginTop: -8, fontSize: 12 }}>
              What all the parts look like stacked together, in the order they're actually sent.
              A real turn usually fires only a handful of these -- see each field's note above
              for when it does.
            </p>
            <pre
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
                // Fills down toward the bottom of the viewport (sticky sidebar, so this tracks
                // scroll) instead of the old fixed 480px, which left a chunk of the sidebar's
                // available height empty above an internal scrollbar. Still capped, not
                // unbounded, so a short window keeps its own scrollbar rather than pushing the
                // page taller.
                maxHeight: 'calc(100vh - 260px)',
                overflowY: 'auto',
              }}
            >
              {SAMPLE_PROMPT}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
