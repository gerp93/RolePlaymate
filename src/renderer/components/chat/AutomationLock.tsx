import { ReactNode } from 'react';

interface Props {
  locked: boolean;
  /** Shown over the content while locked. */
  message: ReactNode;
  children: ReactNode;
}

/**
 * Covers its children with an opaque panel while an automated run is going. The children stay
 * mounted -- hidden, not removed -- so a half-typed message or an open settings control comes back
 * exactly as it was, and `visibility: hidden` takes them out of the tab order as well.
 */
export default function AutomationLock({ locked, message, children }: Props) {
  return (
    <div className="automation-lock">
      <div className={locked ? 'automation-lock-content automation-lock-content-hidden' : 'automation-lock-content'}>
        {children}
      </div>
      {locked && (
        <div className="automation-lock-overlay" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
