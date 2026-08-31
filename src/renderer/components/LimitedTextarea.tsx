import { forwardRef, useLayoutEffect, useRef } from 'react';
import CharCount from './CharCount';

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'maxLength'> {
  limit: number;
  showCount?: boolean;
  compactCount?: boolean;
  fieldClassName?: string;
  /** Grow with the text so the full value is visible; scroll only after maxRows. */
  autoGrow?: boolean;
  maxRows?: number;
}

const LimitedTextarea = forwardRef<HTMLTextAreaElement, Props>(function LimitedTextarea(
  {
    limit,
    showCount = true,
    compactCount = false,
    fieldClassName,
    value,
    className,
    autoGrow = false,
    maxRows = 12,
    ...rest
  },
  ref
) {
  const len = typeof value === 'string' ? value.length : 0;
  const fieldClass = ['limited-field', fieldClassName].filter(Boolean).join(' ');
  const innerRef = useRef<HTMLTextAreaElement | null>(
    null
  ) as React.MutableRefObject<HTMLTextAreaElement | null>;

  useLayoutEffect(() => {
    if (!autoGrow) return;
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.overflowY = 'hidden';
    const style = getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || 21;
    const padding =
      Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const maxHeight = lineHeight * maxRows + padding;
    const contentHeight = el.scrollHeight;
    if (contentHeight > maxHeight) {
      el.style.height = `${maxHeight}px`;
      el.style.overflowY = 'auto';
    } else {
      el.style.height = `${contentHeight}px`;
    }
  }, [autoGrow, maxRows, value]);

  return (
    <div className={fieldClass}>
      <textarea
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
        }}
        className={className}
        maxLength={limit}
        value={value}
        spellCheck
        {...rest}
      />
      {showCount && <CharCount current={len} limit={limit} compact={compactCount} />}
    </div>
  );
});

export default LimitedTextarea;
