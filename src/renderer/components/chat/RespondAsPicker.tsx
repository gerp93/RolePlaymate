import { useState } from 'react';
import { Character } from '../../../shared/types/character';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';

interface Props {
  /** The conversation's own character -- the default, and not offered again as a guest. */
  leadName: string;
  guests: Character[];
  /** '' means the conversation's own character replies as usual. */
  value: string;
  onChange: (characterId: string) => void;
  /** Creates a real library character and resolves to it; the picker then selects it. */
  onCreate: (name: string, description: string) => Promise<Character>;
  disabled?: boolean;
}

const NEW_OPTION = '__new__';

/**
 * "Respond as...": the next reply (a sent message or a Continue) comes from a different library
 * character instead of the conversation's own, then the choice resets -- see Chat.tsx. Quick
 * character covers someone who walks into the scene out of nowhere and isn't in the library yet.
 */
export default function RespondAsPicker({ leadName, guests, value, onChange, onCreate, disabled }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeForm = () => {
    setCreating(false);
    setName('');
    setDescription('');
    setError(null);
  };

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const character = await onCreate(name.trim(), description.trim());
      onChange(character.id);
      closeForm();
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-respond-as">
      <label className="chat-respond-as-field">
        <span className="chat-respond-as-label">Respond as</span>
        <select
          className={value ? 'chat-respond-as-active' : undefined}
          value={creating ? NEW_OPTION : value}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value === NEW_OPTION) {
              setCreating(true);
              return;
            }
            closeForm();
            onChange(e.target.value);
          }}
        >
          <option value="">{leadName}</option>
          {guests.map((guest) => (
            <option key={guest.id} value={guest.id}>
              {guest.name}
            </option>
          ))}
          <option value={NEW_OPTION}>＋ Quick character…</option>
        </select>
      </label>

      {creating && (
        <div className="chat-respond-as-new">
          <input
            type="text"
            autoFocus
            placeholder="Name"
            maxLength={FIELD_LIMITS.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="text"
            className="chat-respond-as-description"
            placeholder="Who are they? One line — it's all the others see of them"
            maxLength={FIELD_LIMITS.short}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void create();
              }
            }}
          />
          <button type="button" className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void create()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={closeForm}>
            Cancel
          </button>
          {error && <span className="chat-respond-as-error">{error}</span>}
        </div>
      )}
    </div>
  );
}
