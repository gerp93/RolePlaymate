/** Full-size view of one image, opened by clicking a thumbnail/avatar elsewhere in the app.
 * Backdrop click or the image's own click (stopped from bubbling) both close it. */
export default function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <img src={url} alt="" className="lightbox-image" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
