/** Shown instead of a hidden item's editable content when the reveal-hidden PIN is locked --
 * used on the three detail pages (reachable directly by id/URL, bypassing the list-level
 * hidden filter) and on the personal-history panels (whose lorebook can be hidden
 * independently of its own visible owning character/persona). Never renders the real
 * name/fields/entries: those are ciphertext at this point, and rendering them into an
 * editable input risks a blur-handler writing that ciphertext back over itself. */
export default function LockedPlaceholder({ label = 'This item' }: { label?: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '32px 16px' }}>
      <p style={{ fontSize: 15, marginBottom: 4 }}>🔒 {label} is hidden</p>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        Unlock with the PIN from the topbar to view or edit it.
      </p>
    </div>
  );
}
