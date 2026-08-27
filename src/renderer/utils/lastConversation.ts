/**
 * Remembers which conversation was open in the Chat tab, so switching to another tab and back
 * returns to it instead of resetting to the character/model picker. Deliberately not app
 * state -- Layout wraps every page and would have to live-forever to hold it, whereas
 * localStorage survives the same way regardless of which component last touched it, including
 * across an app restart.
 */
const KEY = 'roleplaymate:lastConversationId';

export function getLastConversationId(): string | null {
  return localStorage.getItem(KEY);
}

export function setLastConversationId(conversationId: string): void {
  localStorage.setItem(KEY, conversationId);
}
