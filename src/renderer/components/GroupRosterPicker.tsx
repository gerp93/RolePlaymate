import { Character } from '../../shared/types/character';
import { MAX_GROUP_CHARACTERS, MIN_GROUP_CHARACTERS } from '../../shared/types/group';
import './GroupRosterPicker.css';

interface Props {
  /** Every character that can be picked -- the caller has already filtered out hidden ones while
   * the app is locked. */
  characters: Character[];
  /** Selected character ids, in roster order (the first speaks a scenario's greeting). */
  value: string[];
  onChange: (characterIds: string[]) => void;
  disabled?: boolean;
}

/**
 * Chooses a group's roster: toggle characters on and off, then reorder the chosen ones. Selection
 * order is roster order, so the ordered list below is what actually gets saved.
 */
export default function GroupRosterPicker({ characters, value, onChange, disabled }: Props) {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const atCap = value.length >= MAX_GROUP_CHARACTERS;

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else if (!atCap) onChange([...value, id]);
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="group-roster-picker">
      <div className="group-roster-choices" role="group" aria-label="Characters">
        {characters.map((character) => {
          const selected = value.includes(character.id);
          return (
            <button
              key={character.id}
              type="button"
              className={`btn group-roster-choice${selected ? ' btn-primary' : ''}`}
              aria-pressed={selected}
              disabled={disabled || (!selected && atCap)}
              onClick={() => toggle(character.id)}
            >
              {character.name}
            </button>
          );
        })}
        {characters.length === 0 && <span className="text-muted">No characters yet -- create some first.</span>}
      </div>

      <p className="text-muted group-roster-count">
        {value.length} of {MIN_GROUP_CHARACTERS}–{MAX_GROUP_CHARACTERS} characters
        {value.length < MIN_GROUP_CHARACTERS && ` -- pick at least ${MIN_GROUP_CHARACTERS}`}
        {atCap && ' -- that is the most a group can hold'}
      </p>

      {value.length > 0 && (
        <ol className="group-roster-order">
          {value.map((id, index) => (
            <li key={id}>
              <span className="group-roster-name">
                {byId.get(id)?.name ?? 'Unavailable character'}
                {index === 0 && <span className="text-muted"> · speaks the greeting</span>}
              </span>
              <span className="group-roster-move">
                <button
                  type="button"
                  className="btn"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${byId.get(id)?.name ?? 'character'} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={disabled || index === value.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${byId.get(id)?.name ?? 'character'} down`}
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
