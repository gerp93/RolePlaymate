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
}

/** A dropdown-shaped trigger that opens a grid of real image thumbnails instead of a plain
 * text `<select>` -- picking which portrait to pin needs to actually show the portraits. */
export default function ImagePickerSelect({ label, images, mode, staticId, onChange }: Props) {
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
