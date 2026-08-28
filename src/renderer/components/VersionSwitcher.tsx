import { useState } from 'react';
import VersionDiffPanel, { VersionLike } from './VersionDiffPanel';

interface Props<V extends VersionLike> {
  versions: V[];
  viewedVersionId: string | null;
  onSelectViewed: (versionId: string) => void;
}

export default function VersionSwitcher<V extends VersionLike>({ versions, viewedVersionId, onSelectViewed }: Props<V>) {
  const [compareOpen, setCompareOpen] = useState(false);
  const viewed = versions.find((v) => v.id === viewedVersionId) ?? null;

  const sorted = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);
  const viewedIndex = sorted.findIndex((v) => v.id === viewedVersionId);
  const defaultFrom = viewedIndex > 0 ? sorted[viewedIndex - 1] : sorted[0];
  const defaultTo = viewed ?? sorted[sorted.length - 1];

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {versions.map((v) => {
          const isViewed = v.id === viewedVersionId;
          return (
            <button
              key={v.id}
              className="btn"
              onClick={() => onSelectViewed(v.id)}
              style={
                isViewed
                  ? {
                      background: 'var(--color-primary-action)',
                      borderColor: 'var(--color-primary-action)',
                      color: '#fff',
                      fontWeight: 700,
                    }
                  : undefined
              }
            >
              v{v.versionNumber}
              {v.isActive ? ' ★' : ''}
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        {versions.length > 1 && (
          <button className="btn" onClick={() => setCompareOpen(!compareOpen)}>
            {compareOpen ? 'Hide Compare' : 'Compare'}
          </button>
        )}
      </div>

      {compareOpen && versions.length > 1 && (
        <VersionDiffPanel versions={versions} defaultFromId={defaultFrom.id} defaultToId={defaultTo.id} />
      )}
    </div>
  );
}
