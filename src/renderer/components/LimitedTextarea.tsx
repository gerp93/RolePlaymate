import { forwardRef, useLayoutEffect, useRef } from 'react';
import CharCount from './CharCount';
import CopyFieldButton from './CopyFieldButton';

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'maxLength'> {
  limit: number;
  showCount?: boolean;
  compactCount?: boolean;
  fieldClassName?: string;
  /** Grow with the text so the full value is visible; scroll only after maxRows. */
  autoGrow?: boolean;
  maxRows?: number;
  /** Adds a Copy button in the corner of the field. */
  copyable?: boolean;
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
    copyable = false,
    ...rest
  },
  ref
) {
  const len = typeof value === 'string' ? value.length : 0;
  const fieldClass = ['limited-field', copyable ? 'limited-field-copyable' : '', fieldClassName]
    .filter(Boolean)
    .join(' ');
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
    const border =
      Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    const maxHeight = lineHeight * maxRows + padding + border;
    // scrollHeight leaves the border out; the box is border-box, so add it back
    // or the last line is clipped.
    const contentHeight = el.scrollHeight + border;
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
      {copyable && <CopyFieldButton text={typeof value === 'string' ? value : ''} multiline />}
      {showCount && <CharCount current={len} limit={limit} compact={compactCount} />}
    </div>
  );
});

export default LimitedTextarea;
