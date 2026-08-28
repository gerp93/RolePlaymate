import React, { createContext, useCallback, useContext, useState } from 'react';

interface SecurityContextType {
  /** In-memory only -- resets to false on every launch/reload, so the app always opens with
   * hidden items hidden. There is no "stay unlocked" persistence. */
  hiddenUnlocked: boolean;
  unlock: (pin: string) => Promise<boolean>;
  /** Async now: the main process holds the actual decryption key (not just a renderer-side
   * flag), so locking has to tell it to drop that key too. */
  lock: () => Promise<void>;
}

const SecurityContext = createContext<SecurityContextType | undefined>(undefined);

export function SecurityProvider({ children }: { children: React.ReactNode }) {
  const [hiddenUnlocked, setHiddenUnlocked] = useState(false);

  const unlock = useCallback(async (pin: string) => {
    const ok = await window.electronAPI.security.unlock(pin);
    if (ok) setHiddenUnlocked(true);
    return ok;
  }, []);

  const lock = useCallback(async () => {
    await window.electronAPI.security.lock();
    setHiddenUnlocked(false);
  }, []);

  return (
    <SecurityContext.Provider value={{ hiddenUnlocked, unlock, lock }}>
      {children}
    </SecurityContext.Provider>
  );
}

export function useSecurity() {
  const context = useContext(SecurityContext);
  if (!context) {
    throw new Error('useSecurity must be used within SecurityProvider');
  }
  return context;
}
