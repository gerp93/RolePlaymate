import { useCallback, useEffect, useState } from 'react';
import { ImageCrop, ImageCropLocation } from '../../shared/types/imageCrop';

type CropsByImage = Record<string, Partial<Record<ImageCropLocation, ImageCrop>>>;

/** Bulk-fetches every stored crop (all locations) for a set of image ids in one IPC round
 * trip, keyed for `crops[imageId]?.[location]` lookups. `refresh` is handed to
 * `CroppableImage.onCropSaved` so a save/reset in the editor updates every instance of that
 * image on the page without a full page reload. */
export function useImageCrops(imageIds: string[]) {
  const key = imageIds.join(',');
  const [crops, setCrops] = useState<CropsByImage>({});

  const refresh = useCallback(() => {
    if (imageIds.length === 0) {
      setCrops({});
      return;
    }
    void window.electronAPI.imageCrops.getForImages(imageIds).then((list) => {
      const map: CropsByImage = {};
      for (const crop of list) {
        (map[crop.imageId] ??= {})[crop.location] = crop;
      }
      setCrops(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { crops, refresh };
}
