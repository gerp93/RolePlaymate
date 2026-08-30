import { forwardRef } from 'react';
import CharCount from './CharCount';

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'maxLength'> {
  limit: number;
  showCount?: boolean;
  compactCount?: boolean;
  fieldClassName?: string;
}

const LimitedInput = forwardRef<HTMLInputElement, Props>(function LimitedInput(
  { limit, showCount = true, compactCount = false, fieldClassName, value, className, ...rest },
  ref
) {
  const len = typeof value === 'string' ? value.length : 0;
  const fieldClass = ['limited-field', fieldClassName].filter(Boolean).join(' ');

  return (
    <div className={fieldClass}>
      <input ref={ref} className={className} maxLength={limit} value={value} spellCheck {...rest} />
      {showCount && <CharCount current={len} limit={limit} compact={compactCount} />}
    </div>
  );
});

export default LimitedInput;
