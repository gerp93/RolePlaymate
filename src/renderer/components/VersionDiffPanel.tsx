import { useState } from 'react';
import { CharacterFieldVersion } from '../../shared/types/fieldVersion';
import { diffVersionContent } from '../../shared/utils/versionDiff';

interface Props {
  versions: CharacterFieldVersion[];
  defaultFromId: string;
  defaultToId: string;
}

export default function VersionDiffPanel({ versions, defaultFromId, defaultToId }: Props) {
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
