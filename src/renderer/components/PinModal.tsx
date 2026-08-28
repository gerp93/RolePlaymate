import { useState } from 'react';
import { useSecurity } from '../context/SecurityContext';

interface Props {
  onClose: () => void;
}

/** PIN entry for the "reveal hidden items" toggle -- the only place a PIN is entered outside
 * of Settings' change-PIN form, which has its own inline fields. */
export default function PinModal({ onClose }: Props) {
  const { unlock } = useSecurity();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  async function submit() {
    if (!pin) return;
    setChecking(true);
    const ok = await unlock(pin);
    setChecking(false);
    if (ok) {
      onClose();
    } else {
      setError(true);
      setPin('');
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-dialog" role="dialog" aria-label="Enter PIN" onClick={(e) => e.stopPropagation()}>
        <h2>Enter PIN to show hidden items</h2>
        <input
          type="password"
          autoFocus
          value={pin}
          inputMode="numeric"
          onChange={(e) => {
            setPin(e.target.value);
            if (error) setError(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="PIN"
        />
        {error && <p className="field-error">Incorrect PIN.</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" disabled={!pin || checking} onClick={() => void submit()}>
            {checking ? 'Checking…' : 'Unlock'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
