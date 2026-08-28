import { isAtLimit, isNearLimit } from '../../shared/fieldLimits';

interface Props {
  current: number;
  limit: number;
  /** Hide until within 10% of the limit — keeps compact toolbars clean. */
  compact?: boolean;
}

export default function CharCount({ current, limit, compact = false }: Props) {
  const near = isNearLimit(current, limit);
  const at = isAtLimit(current, limit);
  if (compact && !near) return null;

  const className = ['char-count', at ? 'char-count-at-limit' : near ? 'char-count-near-limit' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <span className={className} aria-live="polite">
      {current.toLocaleString()} / {limit.toLocaleString()}
    </span>
  );
}
