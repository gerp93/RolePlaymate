import { forwardRef } from 'react';
import CharCount from './CharCount';
import CopyFieldButton from './CopyFieldButton';

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'maxLength'> {
  limit: number;
  showCount?: boolean;
  compactCount?: boolean;
  fieldClassName?: string;
  /** Adds a Copy button inside the field. Opt-in: most inputs are small and don't need one. */
  copyable?: boolean;
}

const LimitedInput = forwardRef<HTMLInputElement, Props>(function LimitedInput(
  { limit, showCount = true, compactCount = false, fieldClassName, copyable = false, value, className, ...rest },
  ref
) {
  const len = typeof value === 'string' ? value.length : 0;
  const fieldClass = ['limited-field', copyable ? 'limited-field-copyable' : '', fieldClassName]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={fieldClass}>
      <input ref={ref} className={className} maxLength={limit} value={value} spellCheck {...rest} />
      {copyable && <CopyFieldButton text={typeof value === 'string' ? value : ''} />}
      {showCount && <CharCount current={len} limit={limit} compact={compactCount} />}
    </div>
  );
});

export default LimitedInput;
