import { useCallback, useEffect, useState } from 'react';
import { Scenario, ScenarioVersion, ScenarioImage } from '../../shared/types/scenario';
import VersionSwitcher from './VersionSwitcher';
import LockedPlaceholder from './LockedPlaceholder';
import { toImageUrl } from '../utils/imageUrl';
import LimitedInput from './LimitedInput';
import LimitedTextarea from './LimitedTextarea';
import { FIELD_LIMITS } from '../../shared/fieldLimits';

interface Props {
  scenario: Scenario;
  hiddenUnlocked: boolean;
  onChanged: () => void;
  onDeleted: () => void;
}

/**
 * One of a character's Scenarios: name, versioned text (same version-switcher/compare UI as
 * FieldEditor), its own image gallery, and an independent Hide/Unhide -- a scenario can be
 * hidden even while its owning character isn't. Collapsible like LoreEntryEditor, since a
 * character's scenario list can grow long and most aren't being edited at once.
 */
export default function ScenarioEditor({ scenario, hiddenUnlocked, onChanged, onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description ?? '');
  const [versions, setVersions] = useState<ScenarioVersion[]>([]);
  const [viewedVersionId, setViewedVersionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [greetingVersions, setGreetingVersions] = useState<ScenarioVersion[]>([]);
  const [viewedGreetingVersionId, setViewedGreetingVersionId] = useState<string | null>(null);
  const [greetingDraft, setGreetingDraft] = useState('');
  const [images, setImages] = useState<ScenarioImage[]>([]);
  const [imageIndex, setImageIndex] = useState(0);
  const [imageBusy, setImageBusy] = useState(false);

  const loadVersions = useCallback(
    async (keepVersionId?: string) => {
      const loaded = await window.electronAPI.scenarioVersions.getByScenario(scenario.id);
      setVersions(loaded);
      const next = (keepVersionId && loaded.find((v) => v.id === keepVersionId)) || loaded.find((v) => v.isActive);
      setViewedVersionId(next?.id ?? null);
      setDraft(next?.content ?? '');
    },
    [scenario.id]
  );

  const loadGreetingVersions = useCallback(
    async (keepVersionId?: string) => {
      const loaded = await window.electronAPI.scenarioGreetingVersions.getByScenario(scenario.id);
      setGreetingVersions(loaded);
      const next = (keepVersionId && loaded.find((v) => v.id === keepVersionId)) || loaded.find((v) => v.isActive);
      setViewedGreetingVersionId(next?.id ?? null);
      setGreetingDraft(next?.content ?? '');
    },
    [scenario.id]
  );

  const loadImages = useCallback(
    async (preferImageId?: string) => {
      const loaded = await window.electronAPI.scenarioImages.getByScenario(scenario.id);
      setImages(loaded);
      const preferredIndex = preferImageId ? loaded.findIndex((img) => img.id === preferImageId) : -1;
      setImageIndex(preferredIndex >= 0 ? preferredIndex : 0);
    },
    [scenario.id]
  );

  useEffect(() => {
    if (open) {
      void loadVersions();
      void loadGreetingVersions();
      void loadImages();
    }
  }, [open, loadVersions, loadGreetingVersions, loadImages]);

  // Re-sync when the scenario row itself changes underneath (e.g. renamed elsewhere).
  useEffect(() => {
    setName(scenario.name);
    setDescription(scenario.description ?? '');
  }, [scenario]);

  const saveName = async () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== scenario.name) {
      await window.electronAPI.scenarios.update(scenario.id, { name: trimmed });
      onChanged();
    }
  };

  const saveDescription = async () => {
    if (description !== (scenario.description ?? '')) {
      await window.electronAPI.scenarios.update(scenario.id, { description });
      onChanged();
    }
  };

  const saveText = async () => {
    if (!viewedVersionId) return;
    await window.electronAPI.scenarioVersions.updateContent(viewedVersionId, draft);
    await loadVersions(viewedVersionId);
  };

  const saveAsNewVersion = async () => {
    const created = await window.electronAPI.scenarioVersions.create(scenario.id, draft);
    await loadVersions(created.id);
  };

  const saveGreeting = async () => {
    if (!viewedGreetingVersionId) return;
    await window.electronAPI.scenarioGreetingVersions.updateContent(viewedGreetingVersionId, greetingDraft);
    await loadGreetingVersions(viewedGreetingVersionId);
  };

  const saveGreetingAsNewVersion = async () => {
    const created = await window.electronAPI.scenarioGreetingVersions.create(scenario.id, greetingDraft);
    await loadGreetingVersions(created.id);
  };

  const toggleHidden = async () => {
    await window.electronAPI.scenarios.setHidden(scenario.id, !scenario.isHidden);
    onChanged();
  };

  const handleAddImage = async () => {
    setImageBusy(true);
    try {
      const added = await window.electronAPI.scenarioImages.add(scenario.id);
      if (added.length > 0) await loadImages(added[0].id);
    } finally {
      setImageBusy(false);
    }
  };

  const handleRemoveCurrentImage = async () => {
    const current = images[imageIndex];
    if (!current) return;
    if (!confirm('Remove this image? This cannot be undone.')) return;
    await window.electronAPI.scenarioImages.remove(current.id);
    await loadImages();
  };

  const handleSetCover = async () => {
    const current = images[imageIndex];
    if (!current) return;
    await window.electronAPI.scenarioImages.setCover(current.id);
    await loadImages(current.id);
  };

  if (scenario.isHidden && !hiddenUnlocked) {
    return (
      <li className="lore-entry">
        <LockedPlaceholder label="This scenario" />
      </li>
    );
  }

  const latestVersion = versions.length
    ? versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a))
    : null;
  const isEditable = !!latestVersion && viewedVersionId === latestVersion.id;
  const latestGreetingVersion = greetingVersions.length
    ? greetingVersions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a))
    : null;
  const isGreetingEditable = !!latestGreetingVersion && viewedGreetingVersionId === latestGreetingVersion.id;
  const currentImage = images[imageIndex];

  return (
    <li className="lore-entry">
      <div className="lore-entry-head">
        <button type="button" className="lore-entry-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} {scenario.name}
        </button>
        <span className="lore-entry-badges">
          {scenario.isHidden && <span className="lore-badge">🔒 hidden</span>}
          {images.length > 0 && <span className="lore-badge">{images.length} image{images.length === 1 ? '' : 's'}</span>}
        </span>
        <button type="button" className="btn btn-danger lore-entry-delete" onClick={onDeleted}>
          Delete
        </button>
      </div>

      {open && (
        <div className="lore-entry-body">
          <div className="field">
            <label htmlFor={`scenario-name-${scenario.id}`}>Name</label>
            <LimitedInput
              id={`scenario-name-${scenario.id}`}
              limit={FIELD_LIMITS.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
            />
          </div>

          <div className="field">
            <label htmlFor={`scenario-description-${scenario.id}`}>
              Short description{' '}
              <span className="text-muted">— shown in pickers only, not sent to the model</span>
            </label>
            <LimitedInput
              id={`scenario-description-${scenario.id}`}
              limit={FIELD_LIMITS.short}
              value={description}
              placeholder="One-line summary for lists and the chat start screen…"
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => void saveDescription()}
            />
          </div>

          <div className="field">
            <label>
              Image{' '}
              <span className="text-muted">
                — becomes the default shown for a chat using this scenario
              </span>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="scenario-image-thumb">
                {currentImage ? <img src={toImageUrl(currentImage.path)} alt={scenario.name} /> : <span>?</span>}
              </div>
              {images.length > 1 && (
                <>
                  <button className="btn" onClick={() => setImageIndex((i) => (i - 1 + images.length) % images.length)}>
                    ‹
                  </button>
                  <button className="btn" onClick={() => setImageIndex((i) => (i + 1) % images.length)}>
                    ›
                  </button>
                  {imageIndex !== 0 && (
                    <button className="btn" onClick={() => void handleSetCover()} title="Use this image as the default">
                      Set as Cover
                    </button>
                  )}
                </>
              )}
              <button className="btn" disabled={imageBusy} onClick={() => void handleAddImage()}>
                {imageBusy ? 'Adding…' : 'Add Image…'}
              </button>
              {currentImage && (
                <button className="btn btn-danger" onClick={() => void handleRemoveCurrentImage()}>
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor={`scenario-content-${scenario.id}`}>
              Text{' '}
              {viewedVersionId && (
                <span className="text-muted">{!isEditable ? '— read-only, only the latest version is editable' : ''}</span>
              )}
            </label>
            <VersionSwitcher
              versions={versions}
              viewedVersionId={viewedVersionId}
              onSelectViewed={(id) => {
                const version = versions.find((v) => v.id === id);
                setViewedVersionId(id);
                setDraft(version?.content ?? '');
              }}
            />
            <LimitedTextarea
              id={`scenario-content-${scenario.id}`}
              className="content-textarea"
              limit={FIELD_LIMITS.proseContent}
              rows={5}
              value={draft}
              onChange={(e) => isEditable && setDraft(e.target.value)}
              onBlur={() => void saveText()}
              readOnly={!isEditable}
              placeholder="The setting or situation for this scenario..."
              spellCheck
            />
          </div>

          <div className="lore-entry-actions">
            <button type="button" className="btn" onClick={() => void saveAsNewVersion()}>
              Save as New Version
            </button>
            {viewedVersionId && versions.length > 1 && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  await window.electronAPI.scenarioVersions.delete(viewedVersionId);
                  await loadVersions();
                }}
              >
                Delete Version
              </button>
            )}
          </div>

          <div className="field">
            <label htmlFor={`scenario-greeting-${scenario.id}`}>
              Greeting{' '}
              <span className="text-muted">
                — the character's opening message when a chat starts with this scenario selected
                {viewedGreetingVersionId && !isGreetingEditable ? ' (read-only, only the latest version is editable)' : ''}
              </span>
            </label>
            <VersionSwitcher
              versions={greetingVersions}
              viewedVersionId={viewedGreetingVersionId}
              onSelectViewed={(id) => {
                const version = greetingVersions.find((v) => v.id === id);
                setViewedGreetingVersionId(id);
                setGreetingDraft(version?.content ?? '');
              }}
            />
            <LimitedTextarea
              id={`scenario-greeting-${scenario.id}`}
              className="content-textarea"
              limit={FIELD_LIMITS.greeting}
              rows={4}
              value={greetingDraft}
              onChange={(e) => isGreetingEditable && setGreetingDraft(e.target.value)}
              onBlur={() => void saveGreeting()}
              readOnly={!isGreetingEditable}
              placeholder="What the character says to open the chat in this scenario..."
              spellCheck
            />
          </div>

          <div className="lore-entry-actions">
            <button type="button" className="btn" onClick={() => void saveGreetingAsNewVersion()}>
              Save as New Version
            </button>
            {viewedGreetingVersionId && greetingVersions.length > 1 && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  await window.electronAPI.scenarioGreetingVersions.delete(viewedGreetingVersionId);
                  await loadGreetingVersions();
                }}
              >
                Delete Version
              </button>
            )}
            {hiddenUnlocked && (
              <button type="button" className="btn" onClick={() => void toggleHidden()}>
                {scenario.isHidden ? 'Unhide' : 'Hide'}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
