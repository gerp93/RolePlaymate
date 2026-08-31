import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChatRetentionRule,
  ChatRetentionState,
  MAX_RETENTION_RULES,
  RETENTION_AGE_DAYS,
  RETENTION_AGE_LABELS,
  RETENTION_MESSAGE_COUNT_MAX,
  RETENTION_MESSAGE_COUNT_MIN,
  RetentionAgeDays,
  RetentionAgeFrom,
  RetentionLibraryMatch,
  RetentionMessageCountFilter,
  clampRetentionMessageCount,
  createDraftRetentionRule,
  isRetentionRuleComplete,
  retentionRuleInvolvesHidden,
  RetentionCharacterFilter,
  RetentionRuleDraft,
  summarizeRetentionRule,
} from '../../shared/retention';
import { Character } from '../../shared/types/character';
import { Lorebook } from '../../shared/types/lorebook';
import { Scenario } from '../../shared/types/scenario';
import { UserPersona } from '../../shared/types/userPersona';
import { useSecurity } from '../context/SecurityContext';

function formatLastRun(state: ChatRetentionState): string {
  if (!state.lastRunAt) return 'Cleanup has not run yet.';
  const when = new Date(state.lastRunAt);
  if (!Number.isFinite(when.getTime())) return 'Cleanup has not run yet.';
  const removed =
    state.lastDeletedCount === 1 ? '1 chat' : `${state.lastDeletedCount} chats`;
  return `Last cleanup ${when.toLocaleString()} — removed ${removed}.`;
}

function formatRunNotice(deletedCount: number): string {
  if (deletedCount === 0) return 'No chats matched the current rules.';
  return deletedCount === 1 ? 'Removed 1 chat.' : `Removed ${deletedCount} chats.`;
}

const EMPTY_RULES: ChatRetentionRule[] = [];

const UNSAVED_RULE_LEAVE =
  "This rule isn't saved because it doesn't have every field set. Leave this page and discard it?";

function formatScopeCount(count: number | undefined, failed: boolean): string {
  if (failed) return "Couldn't get the live count.";
  if (count == null) return 'Counting chats in scope…';
  if (count === 0) return 'No chats in scope now.';
  if (count === 1) return '1 chat in scope now.';
  return `${count} chats in scope now.`;
}

export default function RetentionRulesPanel({
  onUnsavedDraftChange,
}: {
  onUnsavedDraftChange?: (hasUnsavedDraft: boolean) => void;
} = {}) {
  const { hiddenUnlocked } = useSecurity();
  const [state, setState] = useState<ChatRetentionState | null>(null);
  const [drafts, setDrafts] = useState<RetentionRuleDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scopeByRuleId, setScopeByRuleId] = useState<Record<string, number>>({});
  const [scopeFailed, setScopeFailed] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [worldBooks, setWorldBooks] = useState<Lorebook[]>([]);
  const [scenariosByCharacter, setScenariosByCharacter] = useState<Record<string, Scenario[]>>({});
  const [scenariosUnlockToken, setScenariosUnlockToken] = useState<boolean | null>(null);
  const [entitiesReady, setEntitiesReady] = useState(false);
  const persistSeq = useRef(0);

  useEffect(() => {
    void window.electronAPI.retention.get().then(setState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEntitiesReady(false);
    void Promise.all([
      window.electronAPI.characters.getAll(),
      window.electronAPI.personas.getAll(),
      window.electronAPI.lorebooks.getWorldBooks(),
    ]).then(([nextCharacters, nextPersonas, nextBooks]) => {
      if (cancelled) return;
      setCharacters(nextCharacters);
      setPersonas(nextPersonas);
      setWorldBooks(nextBooks);
      setEntitiesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hiddenUnlocked]);

  const persist = async (nextRules: ChatRetentionRule[]): Promise<boolean> => {
    if (JSON.stringify(nextRules) === JSON.stringify(state?.rules)) return true;
    const previous = state?.rules ?? EMPTY_RULES;
    const seq = ++persistSeq.current;
    setState((prev) => (prev ? { ...prev, rules: nextRules } : prev));
    setError(null);
    try {
      await window.electronAPI.retention.setRules(nextRules);
      if (seq !== persistSeq.current) return true;
      const next = await window.electronAPI.retention.get();
      if (seq !== persistSeq.current) return true;
      setState({ ...next, rules: nextRules });
      if (nextRules.length === 0) setNotice(null);
      return true;
    } catch (err) {
      if (seq !== persistSeq.current) return false;
      setState((prev) => (prev ? { ...prev, rules: previous } : prev));
      setError(err instanceof Error ? err.message : 'Could not save retention rules.');
      return false;
    }
  };

  const rules = state?.rules ?? EMPTY_RULES;
  const scenarioOwnerKey = [...rules, ...drafts]
    .flatMap((rule) => rule.characterFilters.map((filter) => filter.characterId))
    .sort()
    .join('|');

  useEffect(() => {
    const ids = scenarioOwnerKey ? scenarioOwnerKey.split('|') : [];
    let cancelled = false;
    const fetch =
      ids.length === 0
        ? Promise.resolve([] as [string, Scenario[]][])
        : Promise.all(
            ids.map((id) =>
              window.electronAPI.scenarios
                .getByCharacter(id)
                .then((list) => [id, list] as const)
                .catch(() => [id, []] as const)
            )
          );
    void fetch.then((entries) => {
      if (cancelled) return;
      setScenariosByCharacter(Object.fromEntries(entries));
      setScenariosUnlockToken(hiddenUnlocked);
    });
    return () => {
      cancelled = true;
    };
  }, [scenarioOwnerKey, hiddenUnlocked]);

  const hiddenCharacterIds = useMemo(
    () => new Set(characters.filter((item) => item.isHidden).map((item) => item.id)),
    [characters]
  );
  const hiddenPersonaIds = useMemo(
    () => new Set(personas.filter((item) => item.isHidden).map((item) => item.id)),
    [personas]
  );
  const hiddenLorebookIds = useMemo(
    () => new Set(worldBooks.filter((item) => item.isHidden).map((item) => item.id)),
    [worldBooks]
  );
  const hiddenScenarioIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of Object.values(scenariosByCharacter)) {
      for (const scenario of list) {
        if (scenario.isHidden) ids.add(scenario.id);
      }
    }
    return ids;
  }, [scenariosByCharacter]);
  const visibleCharacters = useMemo(
    () => characters.filter((item) => hiddenUnlocked || !item.isHidden),
    [characters, hiddenUnlocked]
  );
  const visiblePersonas = useMemo(
    () => personas.filter((item) => hiddenUnlocked || !item.isHidden),
    [personas, hiddenUnlocked]
  );
  const visibleWorldBooks = useMemo(
    () => worldBooks.filter((item) => hiddenUnlocked || !item.isHidden),
    [worldBooks, hiddenUnlocked]
  );
  const visibleRules = useMemo(() => {
    if (hiddenUnlocked) return rules;
    return rules.filter(
      (rule) =>
        !retentionRuleInvolvesHidden(
          rule,
          hiddenCharacterIds,
          hiddenPersonaIds,
          hiddenLorebookIds,
          hiddenScenarioIds
        )
    );
  }, [rules, hiddenUnlocked, hiddenCharacterIds, hiddenPersonaIds, hiddenLorebookIds, hiddenScenarioIds]);
  const hiddenRuleCount = rules.length - visibleRules.length;
  const displayedRules: RetentionRuleDraft[] = [...visibleRules, ...drafts];
  const hasUnsavedDraft = drafts.length > 0;

  useEffect(() => {
    onUnsavedDraftChange?.(hasUnsavedDraft);
    return () => onUnsavedDraftChange?.(false);
  }, [hasUnsavedDraft, onUnsavedDraftChange]);

  useEffect(() => {
    if (!hasUnsavedDraft) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('mailto:')) return;
      const next = href.startsWith('#') ? href.slice(1) : href;
      const current = window.location.hash.replace(/^#/, '') || '/';
      if (next === current) return;
      if (!window.confirm(UNSAVED_RULE_LEAVE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [hasUnsavedDraft]);

  const runNow = async (ruleId?: string) => {
    if (
      !confirm(
        ruleId
          ? 'Delete chats that match this rule (and their spoken audio)? This cannot be undone. Conversations marked Keep are not deleted.'
          : hiddenRuleCount > 0 && !hiddenUnlocked
            ? 'Delete chats that match the current retention rules (and their spoken audio)? This cannot be undone. Conversations marked Keep are not deleted. Rules that involve hidden items still run.'
            : 'Delete chats that match the current retention rules (and their spoken audio)? This cannot be undone. Conversations marked Keep are not deleted.'
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.retention.runNow(ruleId);
      const next = await window.electronAPI.retention.get();
      setState(next);
      setNotice(formatRunNotice(result.deletedCount));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cleanup failed.');
    } finally {
      setBusy(false);
    }
  };

  const scopeKey = state
    ? `${JSON.stringify(state.rules)}\0${state.lastRunAt ?? ''}\0${state.lastDeletedCount}`
    : null;

  useEffect(() => {
    if (scopeKey === null) return;
    if (rules.length === 0) {
      setScopeFailed(false);
      setScopeByRuleId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    let cancelled = false;
    setScopeFailed(false);
    const timer = window.setTimeout(() => {
      void Promise.resolve()
        .then(() => window.electronAPI.retention.preview(rules))
        .then((counts) => {
          if (cancelled) return;
          setScopeFailed(false);
          setScopeByRuleId(counts);
        })
        .catch(() => {
          if (cancelled) return;
          setScopeFailed(true);
          setScopeByRuleId({});
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [scopeKey, rules]);

  const updateRule = (id: string, patch: Partial<RetentionRuleDraft>) => {
    const draft = drafts.find((item) => item.id === id);
    if (draft) {
      const nextDraft = { ...draft, ...patch };
      if (isRetentionRuleComplete(nextDraft)) {
        setDrafts((prev) => prev.filter((item) => item.id !== id));
        void persist([...rules, nextDraft]).then((ok) => {
          if (!ok) setDrafts((prev) => [...prev, nextDraft]);
        });
        return;
      }
      setDrafts((prev) => prev.map((item) => (item.id === id ? nextDraft : item)));
      return;
    }
    void persist(
      rules.map((rule) => (rule.id === id ? ({ ...rule, ...patch } as ChatRetentionRule) : rule))
    );
  };

  const removeRule = (id: string) => {
    if (drafts.some((item) => item.id === id)) {
      setDrafts((prev) => prev.filter((item) => item.id !== id));
      return;
    }
    void persist(rules.filter((item) => item.id !== id));
  };

  if (!state || !entitiesReady || scenariosUnlockToken !== hiddenUnlocked) {
    return <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>Loading…</p>;
  }

  return (
    <>
      {rules.length === 0 && drafts.length === 0 ? (
        <p style={{ fontSize: 13, marginTop: 0, fontWeight: 700 }}>
          No rules. Chats are kept forever.
        </p>
      ) : (
        <>
          {hiddenRuleCount > 0 && !hiddenUnlocked && (
            <p className="settings-retention-hidden-notice">
              Some rules aren&apos;t shown because they involve hidden characters, personas,
              scenarios, or world books. Unlock hidden content to view them.
            </p>
          )}
          {displayedRules.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
              No visible rules.
            </p>
          ) : (
            <ul className="settings-retention-list">
              {displayedRules.map((rule, index) => {
                const unsaved = !isRetentionRuleComplete(rule);
                return (
                <li
                  key={rule.id}
                  className={`settings-retention-rule${unsaved ? ' is-unsaved' : ''}`}
                >
                  <div className="settings-retention-rule-header">
                    <span className="settings-retention-rule-title">Rule {index + 1}</span>
                    <div className="settings-retention-rule-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy || unsaved}
                        onClick={() => void runNow(rule.id)}
                      >
                        Run now
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => removeRule(rule.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {unsaved ? (
                    <p className="settings-retention-unsaved-msg">
                      This rule isn&apos;t saved. Set every field before it can run.
                    </p>
                  ) : (
                    <>
                      <p className="text-muted settings-retention-rule-summary">
                        {summarizeRetentionRule(rule)}
                      </p>
                      <p
                        className="settings-retention-rule-scope"
                        title="Committed chats this rule would delete if run now. Conversations marked Keep are not counted."
                      >
                        {formatScopeCount(scopeByRuleId[rule.id], scopeFailed)}
                      </p>
                    </>
                  )}
                  <RetentionRuleFields
                    rule={rule}
                    disabled={busy}
                    onAgeDays={(ageDays) => updateRule(rule.id, { ageDays })}
                    onAgeFrom={(ageFrom) => updateRule(rule.id, { ageFrom })}
                    onMessageCount={(messageCount) => updateRule(rule.id, { messageCount })}
                  />
                  <RetentionEntityFilters
                    rule={rule}
                    disabled={busy}
                    characters={visibleCharacters}
                    personas={visiblePersonas}
                    worldBooks={visibleWorldBooks}
                    scenariosByCharacter={scenariosByCharacter}
                    hiddenUnlocked={hiddenUnlocked}
                    onCharacterFilters={(characterFilters) => updateRule(rule.id, { characterFilters })}
                    onPersonaIds={(personaIds) => updateRule(rule.id, { personaIds })}
                    onLorebookIds={(lorebookIds) => updateRule(rule.id, { lorebookIds })}
                    onLibraryMatch={(libraryMatch) => updateRule(rule.id, { libraryMatch })}
                  />
                  <label className="settings-checkbox-row">
                    <input
                      type="checkbox"
                      checked={rule.autoRun}
                      disabled={busy}
                      onChange={(e) => updateRule(rule.id, { autoRun: e.target.checked })}
                    />
                    Run automatically at local midnight and when the app opens
                  </label>
                </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <div className="settings-subsection-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn"
          disabled={busy || rules.length + drafts.length >= MAX_RETENTION_RULES}
          onClick={() => setDrafts((prev) => [...prev, createDraftRetentionRule()])}
        >
          Add rule
        </button>
        {rules.length > 0 && (
          <button type="button" className="btn" disabled={busy} onClick={() => void runNow()}>
            {busy ? 'Working…' : 'Clean up now'}
          </button>
        )}
      </div>
      {rules.length > 0 && (
        <>
          <p className="text-muted settings-subsection-notice">{formatLastRun(state)}</p>
          {notice && <p className="text-muted settings-subsection-notice">{notice}</p>}
        </>
      )}
      {error && (
        <p style={{ color: 'var(--color-accent-red)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>{error}</p>
      )}
    </>
  );
}

function RetentionRuleFields({
  rule,
  disabled,
  onAgeDays,
  onAgeFrom,
  onMessageCount,
}: {
  rule: RetentionRuleDraft;
  disabled: boolean;
  onAgeDays: (ageDays: RetentionAgeDays) => void;
  onAgeFrom: (ageFrom: RetentionAgeFrom) => void;
  onMessageCount: (messageCount: RetentionMessageCountFilter) => void;
}) {
  const [fewerThan, setFewerThan] = useState(
    rule.messageCount?.kind === 'fewerThan' && Number.isInteger(rule.messageCount.count)
      ? String(rule.messageCount.count)
      : ''
  );
  const [atLeast, setAtLeast] = useState(
    rule.messageCount?.kind === 'atLeast' && Number.isInteger(rule.messageCount.count)
      ? String(rule.messageCount.count)
      : ''
  );

  useEffect(() => {
    if (rule.messageCount?.kind === 'fewerThan' && Number.isInteger(rule.messageCount.count)) {
      setFewerThan(String(rule.messageCount.count));
    }
    if (rule.messageCount?.kind === 'atLeast' && Number.isInteger(rule.messageCount.count)) {
      setAtLeast(String(rule.messageCount.count));
    }
  }, [rule]);

  const kind = rule.messageCount?.kind ?? '';

  const changeKind = (next: RetentionMessageCountFilter['kind'] | '') => {
    if (next === '') return;
    if (next === 'any') onMessageCount({ kind: 'any' });
    else if (next === 'fewerThan') {
      const count = clampRetentionMessageCount(Number(fewerThan));
      if (fewerThan.trim() === '' || !Number.isFinite(Number(fewerThan))) {
        onMessageCount({ kind: 'fewerThan', count: Number.NaN });
      } else {
        onMessageCount({ kind: 'fewerThan', count });
      }
    } else {
      const count = clampRetentionMessageCount(Number(atLeast));
      if (atLeast.trim() === '' || !Number.isFinite(Number(atLeast))) {
        onMessageCount({ kind: 'atLeast', count: Number.NaN });
      } else {
        onMessageCount({ kind: 'atLeast', count });
      }
    }
  };

  return (
    <div className="settings-retention-fields">
      <div className="field">
        <label>Delete after</label>
        <select
          value={rule.ageDays == null ? '' : String(rule.ageDays)}
          disabled={disabled}
          onChange={(e) => onAgeDays(Number(e.target.value) as RetentionAgeDays)}
        >
          {rule.ageDays == null && <option value="">Select…</option>}
          {RETENTION_AGE_DAYS.map((days) => (
            <option key={days} value={String(days)}>
              {RETENTION_AGE_LABELS[days]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Measured from</label>
        <select
          value={rule.ageFrom ?? ''}
          disabled={disabled}
          onChange={(e) => onAgeFrom(e.target.value as RetentionAgeFrom)}
        >
          {rule.ageFrom == null && <option value="">Select…</option>}
          <option value="lastMessage">Date of last message</option>
          <option value="firstMessage">Date of first message</option>
        </select>
      </div>
      <div className="field">
        <label>Message count</label>
        <select
          value={kind}
          disabled={disabled}
          onChange={(e) => changeKind(e.target.value as RetentionMessageCountFilter['kind'] | '')}
        >
          {kind === '' && <option value="">Select…</option>}
          <option value="any">Any</option>
          <option value="fewerThan">Fewer than</option>
          <option value="atLeast">At least</option>
        </select>
      </div>
      {kind === 'fewerThan' && (
        <div className="field">
          <label>Messages</label>
          <input
            type="number"
            min={RETENTION_MESSAGE_COUNT_MIN}
            max={RETENTION_MESSAGE_COUNT_MAX}
            value={fewerThan}
            disabled={disabled}
            onChange={(e) => setFewerThan(e.target.value)}
            onBlur={() => {
              const n = Number(fewerThan);
              onMessageCount({
                kind: 'fewerThan',
                count:
                  fewerThan.trim() === '' || !Number.isFinite(n)
                    ? Number.NaN
                    : clampRetentionMessageCount(n),
              });
            }}
          />
        </div>
      )}
      {kind === 'atLeast' && (
        <div className="field">
          <label>Messages</label>
          <input
            type="number"
            min={RETENTION_MESSAGE_COUNT_MIN}
            max={RETENTION_MESSAGE_COUNT_MAX}
            value={atLeast}
            disabled={disabled}
            onChange={(e) => setAtLeast(e.target.value)}
            onBlur={() => {
              const n = Number(atLeast);
              onMessageCount({
                kind: 'atLeast',
                count:
                  atLeast.trim() === '' || !Number.isFinite(n)
                    ? Number.NaN
                    : clampRetentionMessageCount(n),
              });
            }}
          />
        </div>
      )}
    </div>
  );
}

type LibraryKind = 'character' | 'persona' | 'lorebook';
type AddDraft = {
  kind: '' | LibraryKind;
  characterId: string | null;
};

const LIBRARY_KINDS: { kind: LibraryKind; label: string }[] = [
  { kind: 'character', label: 'Character' },
  { kind: 'persona', label: 'Persona' },
  { kind: 'lorebook', label: 'World book' },
];

function sortNamed<T extends { id: string; name: string }>(items: T[]): T[] {
  return items
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function nameOf(items: { id: string; name: string }[], id: string): string {
  return items.find((item) => item.id === id)?.name ?? 'Unknown';
}

function countLabel(n: number, singular: string, plural: string): string {
  return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
}

function RetentionEntityFilters({
  rule,
  disabled,
  characters,
  personas,
  worldBooks,
  scenariosByCharacter,
  hiddenUnlocked,
  onCharacterFilters,
  onPersonaIds,
  onLorebookIds,
  onLibraryMatch,
}: {
  rule: RetentionRuleDraft;
  disabled: boolean;
  characters: Character[];
  personas: UserPersona[];
  worldBooks: Lorebook[];
  scenariosByCharacter: Record<string, Scenario[]>;
  hiddenUnlocked: boolean;
  onCharacterFilters: (filters: RetentionCharacterFilter[]) => void;
  onPersonaIds: (ids: string[]) => void;
  onLorebookIds: (ids: string[]) => void;
  onLibraryMatch: (match: RetentionLibraryMatch) => void;
}) {
  const [draft, setDraft] = useState<AddDraft | null>(null);
  const [draftScenarios, setDraftScenarios] = useState<Scenario[]>([]);
  const characterOptions = useMemo(() => sortNamed(characters), [characters]);
  const personaOptions = useMemo(() => sortNamed(personas), [personas]);
  const worldBookOptions = useMemo(() => sortNamed(worldBooks), [worldBooks]);

  const takenCharacters = new Set(rule.characterFilters.map((filter) => filter.characterId));
  const takenPersonas = new Set(rule.personaIds);
  const takenWorldBooks = new Set(rule.lorebookIds);

  const remaining = (kind: LibraryKind) => {
    const draftUses = draft?.kind === kind ? 1 : 0;
    if (kind === 'character') {
      return Math.max(0, characterOptions.length - takenCharacters.size - draftUses);
    }
    if (kind === 'persona') {
      return Math.max(0, personaOptions.length - takenPersonas.size - draftUses);
    }
    return Math.max(0, worldBookOptions.length - takenWorldBooks.size - draftUses);
  };

  const kindChoices = (current: LibraryKind | ''): LibraryKind[] =>
    LIBRARY_KINDS.map((item) => item.kind).filter(
      (kind) => kind === current || remaining(kind) > 0
    );

  const hasLibrary = characterOptions.length + personaOptions.length + worldBookOptions.length > 0;
  const canAdd =
    !disabled &&
    hasLibrary &&
    !draft &&
    remaining('character') + remaining('persona') + remaining('lorebook') > 0;

  const optionsFor = (
    options: { id: string; name: string }[],
    taken: Set<string>,
    currentId: string | null
  ) => options.filter((option) => option.id === currentId || !taken.has(option.id));

  useEffect(() => {
    if (draft?.kind !== 'character' || !draft.characterId) {
      setDraftScenarios([]);
      return;
    }
    const cached = scenariosByCharacter[draft.characterId];
    if (cached) {
      setDraftScenarios(cached);
      return;
    }
    let cancelled = false;
    void window.electronAPI.scenarios
      .getByCharacter(draft.characterId)
      .then((list) => {
        if (!cancelled) setDraftScenarios(list);
      })
      .catch(() => {
        if (!cancelled) setDraftScenarios([]);
      });
    return () => {
      cancelled = true;
    };
  }, [draft, scenariosByCharacter]);

  const characterCount = rule.characterFilters.length;
  const personaCount = rule.personaIds.length;
  const worldBookCount = rule.lorebookIds.length;
  const hasCommitted = characterCount > 0 || personaCount > 0 || worldBookCount > 0;
  const visibleDraftScenarios = sortNamed(
    draftScenarios.filter((scenario) => hiddenUnlocked || !scenario.isHidden)
  );

  const commitCharacter = (characterId: string, scenarioIds: string[]) => {
    onCharacterFilters([...rule.characterFilters, { characterId, scenarioIds }]);
    setDraft(null);
  };

  return (
    <details className="settings-retention-library-panel">
      <summary className="settings-retention-library-summary">
        <span className="settings-retention-library-title">
          Library items filter <span className="settings-retention-library-optional">(optional)</span>
        </span>
        <span className="settings-retention-library-subheader">
          <span className="settings-retention-library-pills">
            <span className="settings-retention-library-pill">
              {rule.libraryMatch === 'or' ? 'Any of these' : 'Every type'}
            </span>
            {hasCommitted ? (
              <>
                {characterCount > 0 && (
                  <span className="settings-retention-library-pill">
                    {countLabel(characterCount, 'character', 'characters')}
                  </span>
                )}
                {personaCount > 0 && (
                  <span className="settings-retention-library-pill">
                    {countLabel(personaCount, 'persona', 'personas')}
                  </span>
                )}
                {worldBookCount > 0 && (
                  <span className="settings-retention-library-pill">
                    {countLabel(worldBookCount, 'world book', 'world books')}
                  </span>
                )}
              </>
            ) : (
              <span className="settings-retention-library-subheader-text">
                None Selected
              </span>
            )}
          </span>
        </span>
      </summary>
      <p className="text-muted settings-retention-library-lead">
        With nothing selected, every chat that matches the age and message filters is deleted.
        {rule.libraryMatch === 'or'
          ? ' Any of these matches a chat that involves any selected character, persona, or world book.'
          : ' Every type matches only chats that involve at least one of each type you add.'}
        {' '}
        When you add a character, pick a scenario or all scenarios; that choice stays until you
        remove the character.
      </p>
      <div className="settings-retention-library-match" role="radiogroup" aria-label="Library match">
        <label className="settings-checkbox-row">
          <input
            type="radio"
            name={`library-match-${rule.id}`}
            checked={rule.libraryMatch === 'or'}
            disabled={disabled}
            onChange={() => onLibraryMatch('or')}
          />
          Any of these
        </label>
        <label className="settings-checkbox-row">
          <input
            type="radio"
            name={`library-match-${rule.id}`}
            checked={rule.libraryMatch !== 'or'}
            disabled={disabled}
            onChange={() => onLibraryMatch('and')}
          />
          Every type
        </label>
      </div>
      {!hasLibrary ? (
        <p className="text-muted settings-retention-entity-empty">
          No characters, personas, or world books yet.
        </p>
      ) : (
        <>
          {hasCommitted && (
            <div className="settings-retention-library-grid">
              <LibraryFilterColumn
                title="Characters"
                empty={rule.characterFilters.length === 0}
              >
                {rule.characterFilters.map((filter) => {
                  const characterName = nameOf(characters, filter.characterId);
                  const scenarioNote =
                    filter.scenarioIds.length === 0
                      ? 'all scenarios'
                      : filter.scenarioIds
                          .map((id) => nameOf(scenariosByCharacter[filter.characterId] ?? [], id))
                          .join(', ');
                  return (
                    <li key={filter.characterId} className="settings-retention-library-col-item">
                      <span className="settings-retention-library-col-name">
                        {characterName}{' '}
                        <span className="text-muted">({scenarioNote})</span>
                      </span>
                      <LibraryDismissButton
                        disabled={disabled}
                        label={`Remove ${characterName}`}
                        onClick={() =>
                          onCharacterFilters(
                            rule.characterFilters.filter(
                              (item) => item.characterId !== filter.characterId
                            )
                          )
                        }
                      />
                    </li>
                  );
                })}
              </LibraryFilterColumn>
              <LibraryFilterColumn title="Personas" empty={rule.personaIds.length === 0}>
                {rule.personaIds.map((id) => (
                  <li key={id} className="settings-retention-library-col-item">
                    <span className="settings-retention-library-col-name">
                      {nameOf(personas, id)}
                    </span>
                    <LibraryDismissButton
                      disabled={disabled}
                      label={`Remove ${nameOf(personas, id)}`}
                      onClick={() => onPersonaIds(rule.personaIds.filter((item) => item !== id))}
                    />
                  </li>
                ))}
              </LibraryFilterColumn>
              <LibraryFilterColumn title="World books" empty={rule.lorebookIds.length === 0}>
                {rule.lorebookIds.map((id) => (
                  <li key={id} className="settings-retention-library-col-item">
                    <span className="settings-retention-library-col-name">
                      {nameOf(worldBooks, id)}
                    </span>
                    <LibraryDismissButton
                      disabled={disabled}
                      label={`Remove ${nameOf(worldBooks, id)}`}
                      onClick={() =>
                        onLorebookIds(rule.lorebookIds.filter((item) => item !== id))
                      }
                    />
                  </li>
                ))}
              </LibraryFilterColumn>
            </div>
          )}
          {draft && (
            <div className="settings-retention-entity-row">
              <select
                className="settings-retention-entity-kind"
                value={draft.kind}
                disabled={disabled}
                onChange={(e) => {
                  const kind = e.target.value as LibraryKind | '';
                  setDraft({ kind, characterId: null });
                }}
              >
                {draft.kind === '' && <option value="">Select…</option>}
                {kindChoices(draft.kind).map((choice) => (
                  <option key={choice} value={choice}>
                    {LIBRARY_KINDS.find((item) => item.kind === choice)?.label ?? choice}
                  </option>
                ))}
              </select>
              {draft.kind === 'persona' && (
                <select
                  className="settings-retention-entity-name"
                  value=""
                  disabled={disabled}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    onPersonaIds([...rule.personaIds, id]);
                    setDraft(null);
                  }}
                >
                  <option value="">Select…</option>
                  {optionsFor(personaOptions, takenPersonas, null).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              )}
              {draft.kind === 'lorebook' && (
                <select
                  className="settings-retention-entity-name"
                  value=""
                  disabled={disabled}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    onLorebookIds([...rule.lorebookIds, id]);
                    setDraft(null);
                  }}
                >
                  <option value="">Select…</option>
                  {optionsFor(worldBookOptions, takenWorldBooks, null).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              )}
              {draft.kind === 'character' && (
                <>
                  <select
                    className="settings-retention-entity-name"
                    value={draft.characterId ?? ''}
                    disabled={disabled}
                    onChange={(e) => {
                      const characterId = e.target.value;
                      setDraft({ kind: 'character', characterId: characterId || null });
                    }}
                  >
                    <option value="">Select…</option>
                    {optionsFor(characterOptions, takenCharacters, draft.characterId).map(
                      (option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      )
                    )}
                  </select>
                  {draft.characterId && (
                    <select
                      className="settings-retention-entity-name"
                      value=""
                      disabled={disabled}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!value) return;
                        commitCharacter(draft.characterId as string, value === 'all' ? [] : [value]);
                      }}
                    >
                      <option value="">Select scenario…</option>
                      <option value="all">All scenarios</option>
                      {visibleDraftScenarios.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              <LibraryDismissButton
                disabled={disabled}
                label="Cancel adding library item"
                onClick={() => setDraft(null)}
              />
            </div>
          )}
          {!draft && (
            <button
              type="button"
              className="btn settings-retention-entity-add"
              disabled={!canAdd}
              onClick={() => setDraft({ kind: '', characterId: null })}
            >
              Add library item
            </button>
          )}
        </>
      )}
    </details>
  );
}

function LibraryFilterColumn({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <div className="settings-retention-library-col">
      <h3 className="settings-retention-library-col-title">{title}</h3>
      {empty ? (
        <p className="text-muted settings-retention-library-col-empty">None</p>
      ) : (
        <ul className="settings-retention-library-col-list">{children}</ul>
      )}
    </div>
  );
}

function LibraryDismissButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="settings-retention-library-x"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
    >
      ×
    </button>
  );
}
