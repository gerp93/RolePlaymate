/**
 * Retry/relocate logic for opening the database, kept free of Electron so it's testable with
 * plain fakes -- the same split as `chatSession.ts` wiring pure retrieval/extraction logic to
 * real IO.
 *
 * The case this exists for: the database lives at a user-chosen path (`dbLocation.setDbPath`)
 * on a drive or network share that isn't currently connected. `initDatabase` throws, and
 * without this the app used to just fail once and quit -- there was no way to mount the drive
 * and try again short of relaunching. This loops instead: the user can go connect the drive
 * outside the app and hit Retry, or point the app at a different location, without restarting.
 */
export interface DbRecoveryHooks<T> {
  /** The path to try. Re-read each attempt, so it reflects a location picked in a prior loop. */
  getPath: () => string;
  open: (path: string) => T;
  /** Show the failure and get the user's choice. */
  promptUser: (path: string, error: unknown) => 'retry' | 'choose' | 'quit';
  /** Lets the user pick a new location; null means they cancelled the picker. */
  pickNewPath: () => string | null;
  /** Persists the chosen path so the next `getPath()` reflects it. */
  adoptPath: (path: string) => void;
  /** Called once, only when the user chooses to give up. */
  onGiveUp: (error: unknown) => void;
}

export function openWithRecovery<T>(hooks: DbRecoveryHooks<T>): T {
  for (;;) {
    const path = hooks.getPath();
    try {
      return hooks.open(path);
    } catch (error) {
      const choice = hooks.promptUser(path, error);

      if (choice === 'retry') continue;

      if (choice === 'choose') {
        const picked = hooks.pickNewPath();
        if (picked) hooks.adoptPath(picked);
        continue;
      }

      hooks.onGiveUp(error);
      throw error;
    }
  }
}
