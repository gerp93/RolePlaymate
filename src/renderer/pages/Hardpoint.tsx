import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { HARDPOINT_API_BASE, isHardpointReachable } from '../utils/hardpoint';
import '../components/Hardpoint.css';

/**
 * Embeds Hardpoint's loopback UI when the Hardpoint app is running.
 * Service start/stop/unload live there — RolePlaymate only iframes it.
 * The embed is asked to use RolePlaymate's current theme and drop its own title bar
 * (needs a Hardpoint build with the `theme` / `bare` embed params; older ones ignore them).
 */
export default function HardpointPage() {
  const { currentTheme } = useTheme();
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setReachable(await isHardpointReachable());
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function handleOpen() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await window.electronAPI.hardpoint.open();
      if (result.status === 'error') {
        setNotice(result.message);
      } else if (!reachable) {
        setNotice('Starting Hardpoint…');
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 1_000));
          if (await isHardpointReachable()) {
            setReachable(true);
            setNotice(null);
            return;
          }
        }
        setNotice(
          'Hardpoint did not become reachable. Open the hArdpoInt repo and run npm run dev.'
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const embedParams = new URLSearchParams({ bare: '1' });
  if (currentTheme) embedParams.set('theme', currentTheme);

  return (
    <div className="hardpoint-page">
      {reachable === false && (
        <p style={{ color: 'var(--color-accent-red)', fontSize: 13, marginTop: 0 }}>
          Hardpoint is not running on {HARDPOINT_API_BASE}. Start it to manage services from this
          panel.
        </p>
      )}
      {reachable && (
        <iframe
          className="hardpoint-frame"
          title="Hardpoint"
          src={`${HARDPOINT_API_BASE}/?${embedParams.toString()}`}
          allow="local-network-access; clipboard-read; clipboard-write"
        />
      )}
      <div className="hardpoint-page-footer">
        {notice && (
          <span className="text-muted" style={{ fontSize: 13, marginRight: 'auto' }}>
            {notice}
          </span>
        )}
        <div className="hardpoint-page-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
            Refresh
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void handleOpen()}>
            {reachable ? 'Open Hardpoint window' : 'Start Hardpoint'}
          </button>
        </div>
      </div>
    </div>
  );
}
