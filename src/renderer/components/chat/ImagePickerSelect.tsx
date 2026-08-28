import { useEffect, useRef, useState } from 'react';
import { ImageMode } from '../../../shared/types/conversation';
import { toImageUrl } from '../../utils/imageUrl';

interface ImageOption {
  id: string;
  path: string;
}

interface Props {
  label: string;
  images: ImageOption[];
  mode: ImageMode;
  staticId: string | null;
  /** 'carousel' or an image id -- same contract Chat.tsx's handleCharacterImageChange/
   * handlePersonaImageChange already expect. */
  onChange: (value: string) => void;
  /** Renders as a small icon-only button meant to sit absolutely positioned over a portrait
   * image (see .chat-portrait-margin) instead of the labeled dropdown-shaped trigger used
   * everywhere else. The panel opens upward and spans the full portrait width (not just the
   * trigger button's), since the trigger lives in the image's bottom corner with nothing but
   * screen edge below it and a grid that size wouldn't otherwise fit. */
  overlay?: boolean;
}

/** A dropdown-shaped trigger that opens a grid of real image thumbnails instead of a plain
 * text `<select>` -- picking which portrait to pin needs to actually show the portraits. */
export default function ImagePickerSelect({
  label,
  images,
  mode,
  staticId,
  onChange,
  overlay,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const current = mode === 'static' && staticId ? images.find((i) => i.id === staticId) : null;

  if (overlay) {
    return (
      <div className="image-picker image-picker-overlay" ref={rootRef}>
        <button
          type="button"
          className="image-picker-overlay-trigger"
          title={`${label}: ${current ? 'Static' : 'Carousel'} (click to change)`}
          onClick={() => setOpen((o) => !o)}
        >
          {current ? (
            <img src={toImageUrl(current.path)} alt="" className="image-picker-thumb" />
          ) : (
            <span className="image-picker-thumb image-picker-thumb-random">🔄</span>
          )}
        </button>

        {open && (
          <div className="image-picker-panel image-picker-panel-overlay">
            <button
              type="button"
              className={`image-picker-option${mode === 'carousel' ? ' active' : ''}`}
              onClick={() => {
                onChange('carousel');
                setOpen(false);
              }}
            >
              <span className="image-picker-thumb image-picker-thumb-random">🔄</span>
              Carousel
            </button>
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                className={`image-picker-option${mode === 'static' && staticId === img.id ? ' active' : ''}`}
                onClick={() => {
                  onChange(img.id);
                  setOpen(false);
                }}
              >
                <img src={toImageUrl(img.path)} alt="" className="image-picker-thumb" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="image-picker" ref={rootRef}>
      <span className="image-picker-label">{label}</span>
      <button type="button" className="image-picker-trigger" onClick={() => setOpen((o) => !o)}>
        {current ? (
          <img src={toImageUrl(current.path)} alt="" className="image-picker-thumb" />
        ) : (
          <span className="image-picker-thumb image-picker-thumb-random">🔄</span>
        )}
        <span>{current ? 'Static' : 'Carousel'}</span>
      </button>

      {open && (
        <div className="image-picker-panel">
          <button
            type="button"
            className={`image-picker-option${mode === 'carousel' ? ' active' : ''}`}
            onClick={() => {
              onChange('carousel');
              setOpen(false);
            }}
          >
            <span className="image-picker-thumb image-picker-thumb-random">🔄</span>
            Carousel
          </button>
          {images.map((img) => (
            <button
              key={img.id}
              type="button"
              className={`image-picker-option${mode === 'static' && staticId === img.id ? ' active' : ''}`}
              onClick={() => {
                onChange(img.id);
                setOpen(false);
              }}
            >
              <img src={toImageUrl(img.path)} alt="" className="image-picker-thumb" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
