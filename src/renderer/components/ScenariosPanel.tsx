import { useCallback, useEffect, useState } from 'react';
import { Scenario } from '../../shared/types/scenario';
import ScenarioEditor from './ScenarioEditor';
import { useSecurity } from '../context/SecurityContext';
import LimitedInput from './LimitedInput';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import './lore/Lore.css';

/**
 * A character's 1-to-N Scenarios -- settings/situations a conversation can pick from, split
 * out from the old fixed "scenario" CharacterField so a character's permanent traits
 * (personality/dialogue) never have to be duplicated onto a new character just to give it a
 * different setting. A scenario can be hidden independently of its owning character -- see
 * ScenarioEditor.
 */
export default function ScenariosPanel({ characterId }: { characterId: string }) {
  const { hiddenUnlocked } = useSecurity();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    setScenarios(await window.electronAPI.scenarios.getByCharacter(characterId));
  }, [characterId]);

  // hiddenUnlocked: re-fetch on every lock/unlock so a scenario's ciphertext name updates
  // immediately instead of only after a manual reload -- same convention as every other
  // hideable-content panel in the app.
  useEffect(() => {
    void refresh();
  }, [refresh, hiddenUnlocked]);

  const addScenario = async () => {
    if (!newName.trim()) return;
    await window.electronAPI.scenarios.create({ characterId, name: newName.trim() });
    setNewName('');
    await refresh();
  };

  const deleteScenario = async (id: string) => {
    if (!confirm('Delete this scenario and all its versions and images? This cannot be undone.')) return;
    await window.electronAPI.scenarios.delete(id);
    await refresh();
  };

  const visibleScenarios = scenarios.filter((s) => hiddenUnlocked || !s.isHidden);

  return (
    <div className="card personal-history">
      <div className="lore-entries-header">
        <div>
          <h2>Scenarios</h2>
          <p className="text-muted">
            Settings or situations to drop this character into, each with its own opening
            greeting and image. A chat picks at most one -- leave none selected for the
            character's plain default behavior (and no opening greeting).
          </p>
        </div>
        <div className="lore-new-entry">
          <LimitedInput
            value={newName}
            limit={FIELD_LIMITS.name}
            compactCount
            placeholder="New scenario name…"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addScenario()}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!newName.trim()}
            onClick={() => void addScenario()}
          >
            Add
          </button>
        </div>
      </div>

      <ul className="lore-entry-list">
        {visibleScenarios.length === 0 && (
          <li className="text-muted">No scenarios yet -- add one above, or leave this character as-is.</li>
        )}
        {visibleScenarios.map((scenario) => (
          <ScenarioEditor
            key={`${scenario.id}-${hiddenUnlocked}`}
            scenario={scenario}
            hiddenUnlocked={hiddenUnlocked}
            onChanged={() => void refresh()}
            onDeleted={() => void deleteScenario(scenario.id)}
          />
        ))}
      </ul>
    </div>
  );
}
