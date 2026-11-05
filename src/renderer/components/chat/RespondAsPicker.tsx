import { useState } from 'react';
import { Character } from '../../../shared/types/character';
import { FIELD_LIMITS } from '../../../shared/fieldLimits';

interface Props {
  /** The conversation's own character -- the default, and not offered again as a guest. */
  leadName: string;
  /** Guests shown as checkboxes: the ones who have spoken here plus the ones pinned by hand. */
  pinned: Character[];
  /** Pinned guests that can be taken back off the row (the ones who have already spoken stay). */
  removableIds: ReadonlySet<string>;
  /** Everyone else, offered in the "Add..." dropdown. */
  others: Character[];
  /** '' means the conversation's own character replies as usual. */
  value: string;
  onChange: (characterId: string) => void;
  onPin: (characterId: string) => void;
  onUnpin: (characterId: string) => void;
  /** Creates a real library character and resolves to it; the picker then pins and selects it. */
  onCreate: (name: string, description: string) => Promise<Character>;
  disabled?: boolean;
}

const NEW_OPTION = '__new__';

/**
 * "Respond as...": the next reply (a sent message or a Continue) comes from a different library
 * character instead of the conversation's own, then the choice resets -- see Chat.tsx. Guests
 * used in this conversation stay on the row as checkboxes (one at a time, since a reply has one
 * speaker); the dropdown adds others. Quick character covers someone who walks into the scene
 * out of nowhere and isn't in the library yet.
 */
export default function RespondAsPicker({
  leadName,
  pinned,
  removableIds,
  others,
  value,
  onChange,
  onPin,
  onUnpin,
  onCreate,
  disabled,
}: Props) {
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
      onPin(character.id);
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
      <span className="chat-respond-as-label">Respond as</span>
      {pinned.length === 0 && <span className="chat-respond-as-lead text-muted">{leadName}</span>}
      {pinned.map((guest) => (
        <span key={guest.id} className="chat-respond-as-chip-wrap">
          <label className={`chat-respond-as-chip${value === guest.id ? ' chat-respond-as-chip-on' : ''}`}>
            <input
              type="checkbox"
              checked={value === guest.id}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? guest.id : '')}
            />
            {guest.name}
          </label>
          {removableIds.has(guest.id) && (
            <button
              type="button"
              className="chat-respond-as-unpin"
              disabled={disabled}
              onClick={() => {
                if (value === guest.id) onChange('');
                onUnpin(guest.id);
              }}
              title={`Take ${guest.name} off this row`}
              aria-label={`Unpin ${guest.name}`}
            >
              ✕
            </button>
          )}
        </span>
      ))}

      <select
        className="chat-respond-as-add"
        value={creating ? NEW_OPTION : ''}
        disabled={disabled}
        aria-label="Add a character to respond as"
        onChange={(e) => {
          const picked = e.target.value;
          if (picked === NEW_OPTION) {
            setCreating(true);
            return;
          }
          closeForm();
          if (picked) {
            onPin(picked);
            onChange(picked);
          }
        }}
      >
        <option value="">＋ Add…</option>
        {others.map((guest) => (
          <option key={guest.id} value={guest.id}>
            {guest.name}
          </option>
        ))}
        <option value={NEW_OPTION}>＋ Quick character…</option>
      </select>

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
