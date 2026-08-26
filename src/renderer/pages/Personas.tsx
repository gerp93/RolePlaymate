import { useCallback, useEffect, useState } from 'react';
import { UserPersona } from '../../shared/types/userPersona';
import '../components/chat/Chat.css';

const BLANK = { name: '', description: '', background: '' };

/**
 * Personas are who *you* play, as opposed to Characters, who the AI plays. Kept as a separate
 * page rather than folded into the library so the library keeps meaning "AI characters".
 *
 * Background matters more than it looks: the persona block only reaches the system prompt
 * when a persona has BOTH a name and a background, so a persona without one contributes
 * nothing to the model beyond naming {{user}}.
 */
export default function Personas() {
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(BLANK);

  const refresh = useCallback(async () => {
    setPersonas(await window.electronAPI.personas.getAll());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startEdit = (persona: UserPersona) => {
    setEditingId(persona.id);
    setDraft({
      name: persona.name,
      description: persona.description ?? '',
      background: persona.background ?? '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(BLANK);
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    if (editingId) {
      await window.electronAPI.personas.update(editingId, draft);
    } else {
      await window.electronAPI.personas.create(draft);
    }
    cancelEdit();
    await refresh();
  };

  const remove = async (id: string) => {
    await window.electronAPI.personas.delete(id);
    if (editingId === id) cancelEdit();
    await refresh();
  };

  return (
    <div className="personas-page">
      <div className="page-header">
        <h1>Personas</h1>
      </div>

      <div className="card persona-editor">
        <h2>{editingId ? 'Edit persona' : 'New persona'}</h2>
        <div className="field">
          <label htmlFor="persona-name">Name</label>
          <input
            id="persona-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Who you play as"
          />
        </div>
        <div className="field">
          <label htmlFor="persona-description">Description</label>
          <input
            id="persona-description"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="A short note for your own reference"
          />
        </div>
        <div className="field">
          <label htmlFor="persona-background">
            Background <span className="text-muted">— sent to the model</span>
          </label>
          <textarea
            id="persona-background"
            rows={4}
            value={draft.background}
            onChange={(e) => setDraft({ ...draft, background: e.target.value })}
            placeholder="Without a background, the persona only supplies a name."
          />
        </div>
        <div className="persona-editor-actions">
          <button type="button" className="btn btn-primary" disabled={!draft.name.trim()} onClick={() => void save()}>
            {editingId ? 'Save' : 'Create'}
          </button>
          {editingId && (
            <button type="button" className="btn" onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <ul className="persona-list">
        {personas.length === 0 && <li className="text-muted">No personas yet.</li>}
        {personas.map((persona) => (
          <li key={persona.id} className="card">
            <div>
              <div className="persona-name">{persona.name}</div>
              {persona.description && <div className="text-muted">{persona.description}</div>}
              {!persona.background?.trim() && (
                <div className="text-muted persona-warning">
                  No background — this persona won&apos;t add a persona section to the prompt.
                </div>
              )}
            </div>
            <div className="persona-actions">
              <button type="button" className="btn" onClick={() => startEdit(persona)}>
                Edit
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void remove(persona.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
