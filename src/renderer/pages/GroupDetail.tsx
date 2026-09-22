import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { GroupWithMembers, MIN_GROUP_CHARACTERS } from '../../shared/types/group';
import ScenariosPanel from '../components/ScenariosPanel';
import GroupRosterPicker from '../components/GroupRosterPicker';
import LockedPlaceholder from '../components/LockedPlaceholder';
import LimitedInput from '../components/LimitedInput';
import LimitedTextarea from '../components/LimitedTextarea';
import { useSecurity } from '../context/SecurityContext';
import { FIELD_LIMITS } from '../../shared/fieldLimits';

export default function GroupDetail() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { hiddenUnlocked } = useSecurity();
  const [group, setGroup] = useState<GroupWithMembers | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);

  useEffect(() => {
    if (groupId) void load(groupId);
  }, [groupId, hiddenUnlocked]);

  async function load(id: string) {
    const [g, characterList] = await Promise.all([
      window.electronAPI.groups.getById(id),
      window.electronAPI.characters.getAll(),
    ]);
    if (!g) {
      navigate('/groups');
      return;
    }
    setGroup(g);
    setCharacters(characterList);
    setNameDraft(g.name);
    setDescriptionDraft(g.description ?? '');
    setInstructionsDraft(g.instructions ?? '');
  }

  async function save(patch: { name?: string; description?: string; instructions?: string }) {
    if (!groupId) return;
    await window.electronAPI.groups.update(groupId, patch);
    await load(groupId);
  }

  async function handleRosterChange(characterIds: string[]) {
    if (!groupId) return;
    setRosterError(null);
    // Below the minimum a group can't be saved as a roster, so surface that here instead of
    // letting the main process reject it -- the picker still shows the unsaved selection.
    if (characterIds.length < MIN_GROUP_CHARACTERS) {
      setRosterError(`A group needs at least ${MIN_GROUP_CHARACTERS} characters. Add another before removing this one.`);
      return;
    }
    setRosterBusy(true);
    try {
      setGroup(await window.electronAPI.groups.setMembers(groupId, characterIds));
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : 'Could not update the roster.');
    } finally {
      setRosterBusy(false);
    }
  }

  if (!group) return <div className="text-muted">Loading…</div>;
  if (group.isHidden && !hiddenUnlocked) return <LockedPlaceholder label="This group" />;

  const pickable = characters.filter(
    (c) => hiddenUnlocked || !c.isHidden || group.members.some((m) => m.characterId === c.id)
  );

  return (
    <div className="character-detail-page">
      <div className="character-detail-fields">
        <div className="page-header">
          <LimitedInput
            value={nameDraft}
            limit={FIELD_LIMITS.name}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              const trimmed = nameDraft.trim();
              if (trimmed && trimmed !== group.name) void save({ name: trimmed });
              else setNameDraft(group.name);
            }}
            style={{ fontSize: 22, fontWeight: 700, border: 'none', background: 'transparent', padding: '4px 0' }}
          />
          <LimitedInput
            value={descriptionDraft}
            limit={FIELD_LIMITS.short}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onBlur={() => {
              if (descriptionDraft !== (group.description ?? '')) void save({ description: descriptionDraft });
            }}
            placeholder="Short description or tagline..."
            className="text-muted"
            style={{ fontSize: 14, border: 'none', background: 'transparent', padding: '2px 0 4px' }}
          />
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Characters</h2>
          <p className="text-muted">
            Who is in this group. Changing the roster changes every chat held in it -- past lines keep
            their speaker.
          </p>
          <GroupRosterPicker
            characters={pickable}
            value={group.members.map((m) => m.characterId)}
            onChange={(ids) => void handleRosterChange(ids)}
            disabled={rosterBusy}
          />
          {rosterError && <p className="field-error">{rosterError}</p>}
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Group instructions</h2>
          <p className="text-muted">
            Extra rules for the whole scene, shown to every character in this group -- for example
            how they should take turns, or the tone of the group as a whole.
          </p>
          <LimitedTextarea
            value={instructionsDraft}
            limit={FIELD_LIMITS.proseContent}
            rows={5}
            onChange={(e) => setInstructionsDraft(e.target.value)}
            onBlur={() => {
              if (instructionsDraft !== (group.instructions ?? '')) void save({ instructions: instructionsDraft });
            }}
            placeholder="e.g. Keep replies short. Let the others react before anyone speaks twice."
          />
        </div>

        <ScenariosPanel groupId={group.id} />
      </div>
    </div>
  );
}
