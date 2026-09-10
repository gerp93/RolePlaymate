import { useState } from 'react';
import { ImageCrop, ImageCropLocation, ImageCropOwner } from '../../shared/types/imageCrop';
import { cropStyle } from '../utils/imageCrop';
import ImageCropEditor from './ImageCropEditor';

interface Props {
  src: string;
  alt: string;
  imageId: string;
  imageOwner: ImageCropOwner;
  location: ImageCropLocation;
  crop?: ImageCrop | null;
  className?: string;
  onClick?: () => void;
  /** Called after a save/reset commits -- typically the caller's `refresh` from useImageCrops,
   * so every instance of this image on the page picks up the change. */
  onCropSaved?: () => void;
}

/** Drop-in replacement for a bare `<img>` at every real portrait display site: applies the
 * stored crop (or the plain centered default) and surfaces a small "adjust" button that opens
 * the shared ImageCropEditor scoped to this exact (image, location) pair. The nearest
 * positioned ancestor (the caller's own container -- card tile, detail panel, etc.) anchors the
 * button; callers that don't already wrap the image in a positioned box need one. */
export default function CroppableImage({
  src,
  alt,
  imageId,
  imageOwner,
  location,
  crop,
  className,
  onClick,
  onCropSaved,
}: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <img className={className} style={cropStyle(crop)} src={src} alt={alt} onClick={onClick} />
      <button
        type="button"
        className="croppable-image-adjust-btn"
        title="Adjust crop for this spot"
        aria-label="Adjust crop for this spot"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setEditing(true);
        }}
      >
        ⤢
      </button>
      {editing && (
        <ImageCropEditor
          imageSrc={src}
          location={location}
          initialCrop={crop ?? null}
          onClose={() => setEditing(false)}
          onSave={async (zoom, offsetX, offsetY) => {
            await window.electronAPI.imageCrops.set({ imageId, imageOwner, location, zoom, offsetX, offsetY });
            onCropSaved?.();
          }}
          onReset={async () => {
            await window.electronAPI.imageCrops.reset(imageId, location);
            onCropSaved?.();
          }}
        />
      )}
    </>
  );
}
