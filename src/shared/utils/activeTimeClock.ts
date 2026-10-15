/** How long without a mouse move, key press, click or scroll before the chat timer pauses. */
export const CHAT_IDLE_MS = 2 * 60 * 1000;

/** One tick never adds more than this, so a laptop waking from sleep (or a stalled timer) cannot
 * credit the whole gap as time spent. */
const MAX_STEP_MS = 2000;

/**
 * Counts time spent actively in a chat: it runs while there has been input within `idleMs` and the
 * window is visible, and pauses otherwise. Pure -- the caller supplies the clock -- so the rules
 * can be tested without a browser.
 *
 * The idle window itself counts (the last `idleMs` after your final input is time you were
 * reading or thinking); it only stops adding after that, and resumes on the next input.
 */
export class ActiveTimeClock {
  private lastTick: number;
  private lastActivity: number;

  constructor(now: number, private readonly idleMs: number = CHAT_IDLE_MS) {
    this.lastTick = now;
    this.lastActivity = now;
  }

  /** Mouse, keyboard or scroll input happened. */
  noteActivity(now: number): void {
    this.lastActivity = now;
  }

  /** Whether the timer is currently counting (input within the idle window). */
  isActive(now: number): boolean {
    return now - this.lastActivity < this.idleMs;
  }

  /** Milliseconds to add to the total since the previous tick. Call on a short interval. */
  tick(now: number, visible: boolean): number {
    const delta = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    if (!visible || !this.isActive(now)) return 0;
    return Math.min(delta, MAX_STEP_MS);
  }
}
