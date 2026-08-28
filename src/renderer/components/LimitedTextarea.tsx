import { forwardRef } from 'react';
import CharCount from './CharCount';

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'maxLength'> {
  limit: number;
  showCount?: boolean;
  compactCount?: boolean;
  fieldClassName?: string;
}

const LimitedTextarea = forwardRef<HTMLTextAreaElement, Props>(function LimitedTextarea(
  { limit, showCount = true, compactCount = false, fieldClassName, value, className, ...rest },
  ref
) {
  const len = typeof value === 'string' ? value.length : 0;
  const fieldClass = ['limited-field', fieldClassName].filter(Boolean).join(' ');

  return (
    <div className={fieldClass}>
      <textarea ref={ref} className={className} maxLength={limit} value={value} {...rest} />
      {showCount && <CharCount current={len} limit={limit} compact={compactCount} />}
    </div>
  );
});

export default LimitedTextarea;
