import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Character } from '../../shared/types/character';
import { CharacterImage } from '../../shared/types/characterImage';
import { GroupWithMembers, MIN_GROUP_CHARACTERS } from '../../shared/types/group';
import { toImageUrl } from '../utils/imageUrl';
import { useSecurity } from '../context/SecurityContext';
import LimitedInput from '../components/LimitedInput';
import CroppableImage from '../components/CroppableImage';
import LibraryFilterBar from '../components/LibraryFilterBar';
import GroupRosterPicker from '../components/GroupRosterPicker';
import { useImageCrops } from '../hooks/useImageCrops';
import { FIELD_LIMITS } from '../../shared/fieldLimits';
import { filterAndSortLibrary, LibrarySort } from '../utils/librarySort';

function tileMinWidthFor(count: number): number {
  if (count <= 4) return 300;
  if (count <= 8) return 240;
  return 200;
}

export default function GroupList() {
  const { hiddenUnlocked } = useSecurity();
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [coverImages, setCoverImages] = useState<Record<string, CharacterImage[]>>({});
  const [newName, setNewName] = useState('');
  const [newRoster, setNewRoster] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<LibrarySort>('name-asc');
  const coverImageIds = Object.values(coverImages)
    .map((images) => images[0]?.id)
    .filter((id): id is string => !!id);
  const { crops, refresh: refreshCrops } = useImageCrops(coverImageIds);

  useEffect(() => {
    void load();
  }, [hiddenUnlocked]);

  async function load() {
    const [groupList, characterList, images] = await Promise.all([
      window.electronAPI.groups.getAll(),
      window.electronAPI.characters.getAll(),
      window.electronAPI.characterImages.getAllGroupedByCharacter(),
    ]);
    setGroups(groupList);
    setCharacters(characterList);
    setCoverImages(images);
    setLoading(false);
  }

  const characterById = new Map(characters.map((c) => [c.id, c]));
  // A locked session can neither pick nor chat with a hidden character, so a group containing one
  // is hidden along with it -- the main process refuses to generate for it either way.
  const pickable = characters.filter((c) => hiddenUnlocked || !c.isHidden);
  const isVisible = (group: GroupWithMembers) =>
    hiddenUnlocked ||
    (!group.isHidden && group.members.every((m) => !characterById.get(m.characterId)?.isHidden));

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setError('Enter a name before creating a group.');
      return;
    }
    if (newRoster.length < MIN_GROUP_CHARACTERS) {
      setError(`Pick at least ${MIN_GROUP_CHARACTERS} characters for the group.`);
      return;
    }
    setError(null);
    try {
      await window.electronAPI.groups.create({ name, characterIds: newRoster });
      setNewName('');
      setNewRoster([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the group.');
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this group, its scenarios, and every chat held in it? The characters themselves are kept. This cannot be undone.')) return;
    await window.electronAPI.groups.delete(id);
    await load();
  }

  async function handleToggleHidden(e: React.MouseEvent, id: string, hidden: boolean) {
    e.preventDefault();
    e.stopPropagation();
    await window.electronAPI.groups.setHidden(id, !hidden);
    await load();
  }

  const visible = filterAndSortLibrary(groups.filter(isVisible), search, sort, (group) => group.name);

  return (
    <div>
      <div className="page-header">
        <h1>Groups</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <p className="text-muted" style={{ marginTop: 0 }}>
          A group is a set of characters that chat together, with its own scenarios and instructions.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
          <LimitedInput
            value={newName}
            limit={FIELD_LIMITS.name}
            compactCount
            fieldClassName="limited-field-grow"
            onChange={(e) => {
              setNewName(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            placeholder="New group name"
          />
          <button className="btn btn-primary" onClick={() => void handleCreate()}>
            Create Group
          </button>
        </div>
        <GroupRosterPicker characters={pickable} value={newRoster} onChange={setNewRoster} />
        {error && <p className="field-error">{error}</p>}
      </div>

      {loading ? (
        <div className="text-muted">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="text-muted">No groups yet -- create one above.</div>
      ) : (
        <>
          <LibraryFilterBar
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            placeholder="Search groups…"
          />
          {visible.length === 0 ? (
            <div className="text-muted">No groups match "{search}".</div>
          ) : (
            <div
              className="character-grid"
              style={{ '--tile-min-width': `${tileMinWidthFor(visible.length)}px` } as React.CSSProperties}
            >
              {visible.map((group) => {
                const members = group.members
                  .map((m) => characterById.get(m.characterId))
                  .filter((c): c is Character => !!c);
                const cover = members.map((c) => coverImages[c.id]?.[0]).find((img) => !!img);
                return (
                  <Link key={group.id} to={`/groups/${group.id}`} className="card character-card">
                    <div className="character-card-portrait">
                      {cover ? (
                        <CroppableImage
                          src={toImageUrl(cover.path)}
                          alt={group.name}
                          imageId={cover.id}
                          imageOwner="character"
                          location="card"
                          crop={crops[cover.id]?.card}
                          onCropSaved={refreshCrops}
                        />
                      ) : (
                        <span>?</span>
                      )}
                    </div>
                    <div className="character-card-body">
                      <p className="character-card-name">{group.name}</p>
                      {group.isHidden && <p className="text-muted persona-warning">🔒 Hidden</p>}
                      <div className="character-card-stats">
                        <span>{members.map((c) => c.name).join(', ') || 'No characters'}</span>
                      </div>
                      {group.members.length < MIN_GROUP_CHARACTERS && (
                        <p className="field-error" style={{ margin: '4px 0 0' }}>
                          Needs at least {MIN_GROUP_CHARACTERS} characters
                        </p>
                      )}
                      <div className="character-card-actions">
                        {hiddenUnlocked && (
                          <button
                            className="btn"
                            onClick={(e) => void handleToggleHidden(e, group.id, group.isHidden)}
                          >
                            {group.isHidden ? 'Unhide' : 'Hide'}
                          </button>
                        )}
                        <button className="btn btn-danger" onClick={(e) => void handleDelete(e, group.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
