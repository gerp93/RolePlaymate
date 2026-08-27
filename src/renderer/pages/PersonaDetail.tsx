import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserPersona } from '../../shared/types/userPersona';
import PersonaHistoryPanel from '../components/lore/PersonaHistoryPanel';
import { toImageUrl } from '../utils/imageUrl';

export default function PersonaDetail() {
  const { personaId } = useParams<{ personaId: string }>();
  const navigate = useNavigate();
  const [persona, setPersona] = useState<UserPersona | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [backgroundDraft, setBackgroundDraft] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    if (personaId) void load(personaId);
  }, [personaId]);

  async function load(id: string) {
    const all = await window.electronAPI.personas.getAll();
    const found = all.find((p) => p.id === id) ?? null;
    if (!found) {
      navigate('/personas');
      return;
    }
    setPersona(found);
    setNameDraft(found.name);
    setDescriptionDraft(found.description ?? '');
    setBackgroundDraft(found.background ?? '');
  }

  async function handleNameBlur() {
    if (!personaId || !persona) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== persona.name) {
      await window.electronAPI.personas.update(personaId, { name: trimmed });
      await load(personaId);
    }
  }

  async function handleDescriptionBlur() {
    if (!personaId || !persona) return;
    if (descriptionDraft !== (persona.description ?? '')) {
      await window.electronAPI.personas.update(personaId, { description: descriptionDraft });
      await load(personaId);
    }
  }

  async function handleBackgroundBlur() {
    if (!personaId || !persona) return;
    if (backgroundDraft !== (persona.background ?? '')) {
      await window.electronAPI.personas.update(personaId, { background: backgroundDraft });
      await load(personaId);
    }
  }

  async function handleChooseAvatar() {
    if (!personaId) return;
    setAvatarBusy(true);
    try {
      const path = await window.electronAPI.personas.chooseAvatar();
      if (path) {
        await window.electronAPI.personas.update(personaId, { avatar: path });
        await load(personaId);
      }
    } finally {
      setAvatarBusy(false);
    }
  }

  if (!persona) return <div className="text-muted">Loading…</div>;

  return (
    <div className="character-detail-page">
      <div className="character-detail-fields">
        <div className="page-header">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleNameBlur}
            style={{
              fontSize: 22,
              fontWeight: 700,
              border: 'none',
              background: 'transparent',
              padding: '4px 0',
              width: '100%',
            }}
          />
          <input
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder="A short note for your own reference..."
            className="text-muted"
            style={{
              fontSize: 14,
              border: 'none',
              background: 'transparent',
              padding: '2px 0 4px',
              width: '100%',
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="persona-background">
            Background <span className="text-muted">— sent to the model</span>
          </label>
          <textarea
            id="persona-background"
            rows={6}
            value={backgroundDraft}
            onChange={(e) => setBackgroundDraft(e.target.value)}
            onBlur={handleBackgroundBlur}
            placeholder="Without a background, the persona only supplies a name."
          />
          {!backgroundDraft.trim() && (
            <p className="text-muted persona-warning">
              No background — this persona won&apos;t add a persona section to the prompt.
            </p>
          )}
        </div>

        <PersonaHistoryPanel personaId={persona.id} />
      </div>

      <div className="character-detail-portrait-panel">
        <div className="character-detail-portrait-large">
          {persona.avatar ? <img src={toImageUrl(persona.avatar)} alt={persona.name} /> : <span>?</span>}
        </div>
        <button className="btn" disabled={avatarBusy} onClick={() => void handleChooseAvatar()}>
          {avatarBusy ? 'Choosing…' : persona.avatar ? 'Change Image…' : 'Add Image…'}
        </button>
      </div>
    </div>
  );
}
