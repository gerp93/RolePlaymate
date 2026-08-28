import { ReactNode, useEffect, useRef, useState } from 'react';

export interface StartPickerOption {
  value: string;
  label: string;
  subtext?: string | null;
  detail?: string | null;
  imageUrl?: string | null;
  fallbackGlyph?: string;
  badges?: ReactNode;
  tier?: { label: string; color: string };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: StartPickerOption[];
  placeholder: string;
  disabled?: boolean;
  ariaLabel: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}

function OptionText({ option, compact }: { option: StartPickerOption; compact?: boolean }) {
  return (
    <span className="start-picker-option-text">
      <span className="start-picker-label-row">
        <span className="start-picker-label">{option.label}</span>
        {option.tier ? (
          <span className="start-picker-tier" style={{ color: option.tier.color }}>
            {option.tier.label}
          </span>
        ) : null}
      </span>
      {option.detail && !compact ? <span className="start-picker-detail">{option.detail}</span> : null}
      {option.subtext ? (
        <span className="start-picker-subtext text-muted">{option.subtext}</span>
      ) : null}
      {option.badges && !compact ? <span className="start-picker-badges">{option.badges}</span> : null}
    </span>
  );
}

function OptionThumb({ option }: { option: StartPickerOption }) {
  if (option.imageUrl) {
    return <img src={option.imageUrl} alt="" className="start-picker-thumb" />;
  }
  return (
    <span className="start-picker-thumb start-picker-thumb-fallback" aria-hidden>
      {option.fallbackGlyph ?? '?'}
    </span>
  );
}

export default function StartScreenPicker({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  ariaLabel,
  allowEmpty = false,
  emptyLabel = 'None',
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={`start-screen-picker${className ? ` ${className}` : ''}`} ref={rootRef}>
      <div className="start-picker-anchor">
        <button
          type="button"
          className="start-picker-trigger"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => !disabled && setOpen((o) => !o)}
        >
          {selected ? (
            <>
              <OptionThumb option={selected} />
              <span className="start-picker-trigger-label">{selected.label}</span>
            </>
          ) : (
            <span className="start-picker-placeholder text-muted">{placeholder}</span>
          )}
          <span className="start-picker-chevron" aria-hidden>
            ▾
          </span>
        </button>

        {open && (
          <div className="start-picker-panel" role="listbox" aria-label={ariaLabel}>
            {allowEmpty && (
              <button
                type="button"
                role="option"
                aria-selected={value === ''}
                className={`start-picker-option${value === '' ? ' active' : ''}`}
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                <span className="start-picker-thumb start-picker-thumb-fallback" aria-hidden>
                  —
                </span>
                <span className="start-picker-option-text">
                  <span className="start-picker-label">{emptyLabel}</span>
                </span>
              </button>
            )}
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={value === option.value}
                className={`start-picker-option${value === option.value ? ' active' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <OptionThumb option={option} />
                <OptionText option={option} />
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (selected.subtext || selected.detail || selected.tier) ? (
        <div className="start-picker-selected-hint">
          {selected.tier ? (
            <span className="start-picker-tier" style={{ color: selected.tier.color }}>
              {selected.tier.label}
            </span>
          ) : null}
          {selected.detail ? <span className="start-picker-detail">{selected.detail}</span> : null}
          {selected.subtext ? (
            <p className="start-picker-selected-subtext text-muted">{selected.subtext}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
