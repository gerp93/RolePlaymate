import { useEffect, useState } from 'react';

type Mode = 'idle' | 'enable' | 'change' | 'disable';
type Message = { kind: 'error' | 'success'; text: string };

const MIN_LENGTH = 4;
const MAX_LENGTH = 128;
const RECOMMENDED_LENGTH = 12;

/**
 * Turn whole-app encryption on or off and change its password. This is a card of its own,
 * separate from the Hidden Items PIN below it: the PIN is only a privacy screen, this actually
 * encrypts the database and the portrait/audio files on disk.
 */
export default function EncryptionPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmNext, setConfirmNext] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    void window.electronAPI.encryption.getStatus().then((s) => setEnabled(s.enabled));
  }, []);

  function reset(nextMode: Mode) {
    setMode(nextMode);
    setCurrent('');
    setNext('');
    setConfirmNext('');
    setAcknowledged(false);
    setMessage(null);
  }

  async function submit() {
    setMessage(null);
    const needsNew = mode === 'enable' || mode === 'change';
    if (needsNew) {
      if (next.length < MIN_LENGTH || next.length > MAX_LENGTH) {
        setMessage({ kind: 'error', text: `Password must be ${MIN_LENGTH}-${MAX_LENGTH} characters.` });
        return;
      }
      if (next !== confirmNext) {
        setMessage({ kind: 'error', text: 'Password and confirmation do not match.' });
        return;
      }
    }
    if (mode === 'enable' && !acknowledged) {
      setMessage({ kind: 'error', text: 'Please confirm you understand the password cannot be recovered.' });
      return;
    }

    setBusy(true);
    const api = window.electronAPI.encryption;
    const result =
      mode === 'enable'
        ? await api.enable(next)
        : mode === 'change'
          ? await api.changePassword(current, next)
          : await api.disable(current);
    setBusy(false);

    if (!result.ok) {
      setMessage({ kind: 'error', text: result.error });
      return;
    }
    setEnabled(result.enabled);
    const done =
      mode === 'enable'
        ? 'Encryption is on. You will be asked for this password every time the app starts.'
        : mode === 'change'
          ? 'Password changed.'
          : 'Encryption is off.';
    reset('idle');
    setMessage({ kind: 'success', text: done });
  }

  const busyLabel =
    mode === 'enable' ? 'Encrypting…' : mode === 'disable' ? 'Decrypting…' : 'Working…';
  const submitLabel =
    mode === 'enable' ? 'Turn on encryption' : mode === 'change' ? 'Change password' : 'Turn off encryption';
  const canSubmit =
    !busy &&
    (mode === 'enable'
      ? !!next && !!confirmNext
      : mode === 'change'
        ? !!current && !!next && !!confirmNext
        : !!current);

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>App encryption</h2>
      <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
        Off by default. When on, your whole library — the database, portraits, and saved audio — is
        encrypted on disk, and RolePlaymate asks for a password each time it starts. Anyone who
        copies the files gets nothing readable.
      </p>

      {enabled === null && <p className="text-muted" style={{ fontSize: 13 }}>Checking…</p>}

      {enabled !== null && (
        <p style={{ fontSize: 13, marginBottom: 12 }}>
          Status:{' '}
          <strong style={{ color: enabled ? 'var(--color-accent-green)' : undefined }}>
            {enabled ? 'On' : 'Off'}
          </strong>
        </p>
      )}

      {mode === 'idle' && enabled !== null && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!enabled && (
            <button className="btn" onClick={() => reset('enable')}>
              Set up encryption…
            </button>
          )}
          {enabled && (
            <>
              <button className="btn" onClick={() => reset('change')}>
                Change password…
              </button>
              <button className="btn" onClick={() => reset('disable')}>
                Turn off encryption…
              </button>
            </>
          )}
        </div>
      )}

      {mode !== 'idle' && (
        <div>
          {mode === 'enable' && (
            <p style={{ color: 'var(--color-accent-red)', fontSize: 13, marginTop: 0 }}>
              ⚠️ There is no way to recover a forgotten password — not by us, not by anyone. If you
              lose it, your library is gone for good. Longer is safer ({RECOMMENDED_LENGTH}+
              characters recommended).
            </p>
          )}
          {(mode === 'change' || mode === 'disable') && (
            <div className="field">
              <label>Current password</label>
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                style={{ maxWidth: 260 }}
                autoComplete="off"
              />
            </div>
          )}
          {(mode === 'enable' || mode === 'change') && (
            <>
              <div className="field">
                <label>{mode === 'change' ? 'New password' : 'Password'}</label>
                <input
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  style={{ maxWidth: 260 }}
                  autoComplete="off"
                />
                {next.length > 0 && next.length < RECOMMENDED_LENGTH && (
                  <p className="text-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
                    Short passwords are easier to guess. {RECOMMENDED_LENGTH}+ characters is much safer.
                  </p>
                )}
              </div>
              <div className="field">
                <label>Confirm password</label>
                <input
                  type="password"
                  value={confirmNext}
                  onChange={(e) => setConfirmNext(e.target.value)}
                  style={{ maxWidth: 260 }}
                  autoComplete="off"
                />
              </div>
            </>
          )}
          {mode === 'enable' && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              I understand this password cannot be recovered.
            </label>
          )}
          {mode === 'disable' && (
            <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
              Your library will be decrypted and stored as ordinary files again.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
              {busy ? busyLabel : submitLabel}
            </button>
            <button className="btn" disabled={busy} onClick={() => reset('idle')}>
              Cancel
            </button>
          </div>
          {busy && (
            <p className="text-muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              This can take a little while for a large library. Please don't close the app.
            </p>
          )}
        </div>
      )}

      {message && (
        <p
          style={{
            fontSize: 13,
            marginTop: 8,
            marginBottom: 0,
            color: message.kind === 'error' ? 'var(--color-accent-red)' : 'var(--color-accent-green)',
          }}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
