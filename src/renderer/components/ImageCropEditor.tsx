import { useRef, useState } from 'react';
import { ImageCrop, ImageCropLocation, DEFAULT_IMAGE_CROP } from '../../shared/types/imageCrop';
import { cropStyle } from '../utils/imageCrop';

const LOCATION_LABELS: Record<ImageCropLocation, string> = {
  card: 'list tile',
  detail: 'detail-page portrait',
  chatAvatar: 'chat message avatar',
  chatStart: 'chat start-screen bubble',
  chatMargin: 'chat side portrait',
  scenarioThumb: 'scenario thumbnail',
};

/** Aspect ratio + border-radius of the real container at each location, so the preview box is
 * shaped like what the user is actually cropping for -- pulled from each location's real CSS
 * class (see the integration table in the image-crop plan). */
const LOCATION_PREVIEW_STYLE: Record<ImageCropLocation, { aspectRatio: string; borderRadius: string }> = {
  card: { aspectRatio: '4 / 3', borderRadius: 'var(--radius)' },
  detail: { aspectRatio: '3 / 4', borderRadius: 'var(--radius)' },
  chatAvatar: { aspectRatio: '1 / 1', borderRadius: '10px' },
  chatStart: { aspectRatio: '1 / 1', borderRadius: '50%' },
  chatMargin: { aspectRatio: '3 / 4', borderRadius: 'var(--radius)' },
  scenarioThumb: { aspectRatio: '1 / 1', borderRadius: 'var(--radius)' },
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

interface Props {
  imageSrc: string;
  location: ImageCropLocation;
  initialCrop: ImageCrop | null;
  onSave: (zoom: number, offsetX: number, offsetY: number) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
}

/** The one shared crop/zoom editor, opened from wherever a portrait image is currently shown
 * (see CroppableImage). Drag the preview to pan, scroll or the slider to zoom -- both just
 * drive the same offsetX/offsetY/zoom state that `cropStyle` renders with, so the preview is
 * exactly what every display site will show once saved. */
export default function ImageCropEditor({ imageSrc, location, initialCrop, onSave, onReset, onClose }: Props) {
  const [zoom, setZoom] = useState(initialCrop?.zoom ?? DEFAULT_IMAGE_CROP.zoom);
  const [offsetX, setOffsetX] = useState(initialCrop?.offsetX ?? DEFAULT_IMAGE_CROP.offsetX);
  const [offsetY, setOffsetY] = useState(initialCrop?.offsetY ?? DEFAULT_IMAGE_CROP.offsetY);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(
    null
  );

  const previewShape = LOCATION_PREVIEW_STYLE[location];
  const isDefault = zoom === DEFAULT_IMAGE_CROP.zoom && offsetX === DEFAULT_IMAGE_CROP.offsetX && offsetY === DEFAULT_IMAGE_CROP.offsetY;
  const hasStoredCrop = !!initialCrop;

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, startOffsetX: offsetX, startOffsetY: offsetY };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    const box = previewRef.current;
    if (!drag || !box) return;
    const rect = box.getBoundingClientRect();
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setOffsetX(clamp(drag.startOffsetX - (dx / rect.width) * 100, 0, 100));
    setOffsetY(clamp(drag.startOffsetY - (dy / rect.height) * 100, 0, 100));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragState.current = null;
    if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    setZoom((z) => clamp(z - Math.sign(e.deltaY) * 0.1, ZOOM_MIN, ZOOM_MAX));
  }

  async function handleSave() {
    setBusy(true);
    try {
      await onSave(zoom, offsetX, offsetY);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    try {
      await onReset();
      setZoom(DEFAULT_IMAGE_CROP.zoom);
      setOffsetX(DEFAULT_IMAGE_CROP.offsetX);
      setOffsetY(DEFAULT_IMAGE_CROP.offsetY);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-dialog crop-editor-dialog"
        role="dialog"
        aria-label={`Adjust crop for ${LOCATION_LABELS[location]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Adjust crop — {LOCATION_LABELS[location]}</h2>
        <p className="text-muted crop-editor-hint">Drag to pan, scroll to zoom.</p>

        <div
          ref={previewRef}
          className="crop-editor-preview"
          style={{ aspectRatio: previewShape.aspectRatio, borderRadius: previewShape.borderRadius }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        >
          <img src={imageSrc} alt="" style={cropStyle({ zoom, offsetX, offsetY })} draggable={false} />
        </div>

        <div className="crop-editor-zoom-row">
          <span className="text-muted">Zoom</span>
          <input
            type="range"
            min={ZOOM_MIN * 100}
            max={ZOOM_MAX * 100}
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
          />
          <span className="text-muted crop-editor-zoom-value">{Math.round(zoom * 100)}%</span>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-primary" disabled={busy || isDefault} onClick={() => void handleSave()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || (!hasStoredCrop && isDefault)}
            onClick={() => void handleReset()}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
