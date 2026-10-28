import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  /** When set, opening the picker on a wide enough screen fills the free space on that side of the
   * trigger with a big thumbnail gallery instead of the small dropdown list. Too narrow a space
   * falls back to the dropdown. */
  gallery?: 'left' | 'right';
}

/** The gallery needs at least this much free width beside the trigger, or the plain list is used. */
const MIN_GALLERY_WIDTH = 360;
const GALLERY_MARGIN = 16;

interface GalleryBox {
  left: number;
  top: number;
  width: number;
  height: number;
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
  gallery,
}: Props) {
  const [open, setOpen] = useState(false);
  const [galleryBox, setGalleryBox] = useState<GalleryBox | null>(null);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  // The gallery is portalled to <body> (the start screen's panels sit inside a transformed
  // element, which would make `position: fixed` relative to it) and sized to the free space
  // between the trigger and the edge of the chat column.
  useLayoutEffect(() => {
    if (!open || !gallery) {
      setGalleryBox(null);
      return;
    }
    const measure = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const host = triggerRef.current?.closest('.chat-main')?.getBoundingClientRect();
      if (!trigger || !host) {
        setGalleryBox(null);
        return;
      }
      const left = gallery === 'left' ? host.left + GALLERY_MARGIN : trigger.right + GALLERY_MARGIN;
      const right = gallery === 'left' ? trigger.left - GALLERY_MARGIN : host.right - GALLERY_MARGIN;
      const width = right - left;
      setGalleryBox(
        width >= MIN_GALLERY_WIDTH
          ? { left, top: host.top + GALLERY_MARGIN, width, height: host.height - 2 * GALLERY_MARGIN }
          : null
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, gallery]);

  useEffect(() => {
    if (!open) setFilter('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || galleryRef.current?.contains(target)) return;
      setOpen(false);
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
          ref={triggerRef}
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

        {open && galleryBox &&
          createPortal(
            <div
              ref={galleryRef}
              className="start-picker-gallery"
              style={galleryBox}
              role="listbox"
              aria-label={ariaLabel}
            >
              <div className="start-picker-gallery-head">
                <input
                  type="search"
                  className="start-picker-gallery-filter"
                  placeholder={`Filter ${ariaLabel.toLowerCase()}s…`}
                  aria-label={`Filter ${ariaLabel.toLowerCase()}s`}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  autoFocus
                />
                <button type="button" className="btn" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
              <div className="start-picker-gallery-grid">
                {allowEmpty && !filter.trim() && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === ''}
                    className={`start-picker-gallery-card${value === '' ? ' active' : ''}`}
                    onClick={() => {
                      onChange('');
                      setOpen(false);
                    }}
                  >
                    <span className="start-picker-gallery-art">
                      <span className="start-picker-gallery-glyph" aria-hidden>
                        —
                      </span>
                    </span>
                    <span className="start-picker-gallery-caption">
                      <span className="start-picker-gallery-name">{emptyLabel}</span>
                    </span>
                  </button>
                )}
                {options
                  .filter((o) => {
                    const q = filter.trim().toLowerCase();
                    return !q || o.label.toLowerCase().includes(q) || (o.subtext ?? '').toLowerCase().includes(q);
                  })
                  .map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={value === option.value}
                      className={`start-picker-gallery-card${value === option.value ? ' active' : ''}`}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      <span className="start-picker-gallery-art">
                        {option.imageUrl ? (
                          <img src={option.imageUrl} alt="" />
                        ) : (
                          <span className="start-picker-gallery-glyph" aria-hidden>
                            {option.fallbackGlyph ?? '?'}
                          </span>
                        )}
                      </span>
                      <span className="start-picker-gallery-caption">
                        <span className="start-picker-gallery-name">{option.label}</span>
                        {option.subtext ? (
                          <span className="start-picker-gallery-subtext">{option.subtext}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
              </div>
            </div>,
            document.body
          )}

        {open && !galleryBox && (
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

      {selected && (selected.subtext || selected.detail || selected.tier || selected.badges) ? (
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
          {selected.badges ?? null}
        </div>
      ) : null}
    </div>
  );
}
