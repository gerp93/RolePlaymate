import { useState } from 'react';
import { diffVersionContent } from '../../shared/utils/versionDiff';

/** The only shape VersionDiffPanel actually needs -- works for both CharacterFieldVersion and
 * PromptFieldVersion (or any future versioned-content record) without a shared base type. */
export interface VersionLike {
  id: string;
  versionNumber: number;
  isActive: boolean;
  content: string;
}

interface Props<V extends VersionLike> {
  versions: V[];
  defaultFromId: string;
  defaultToId: string;
}

export default function VersionDiffPanel<V extends VersionLike>({ versions, defaultFromId, defaultToId }: Props<V>) {
  const [fromId, setFromId] = useState(defaultFromId);
  const [toId, setToId] = useState(defaultToId);

  const sorted = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);
  const from = sorted.find((v) => v.id === fromId) ?? sorted[0];
  const to = sorted.find((v) => v.id === toId) ?? sorted[sorted.length - 1];
  const diff = diffVersionContent(from.content, to.content);
  const isEmpty = !from.content && !to.content;

  return (
    <div className="version-diff-panel">
      <div className="version-diff-controls">
        <span className="text-muted">Comparing</span>
        <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
          {sorted.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.versionNumber}
            </option>
          ))}
        </select>
        <span className="text-muted">→</span>
        <select value={toId} onChange={(e) => setToId(e.target.value)}>
          {sorted.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.versionNumber}
              {v.isActive ? ' (latest)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="version-diff-body">
        {isEmpty ? (
          <p className="text-muted" style={{ margin: 0 }}>
            Both versions are empty.
          </p>
        ) : (
          diff.map((part, i) => (
            <span key={i} className={part.type !== 'unchanged' ? `version-diff-${part.type}` : undefined}>
              {part.text}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
