/**
 * Which conversation was last open in the Chat tab during this app session. Unlike
 * lastConversationId in localStorage, this resets on every launch — the start screen
 * only shows until the user opens a chat at least once since starting the app.
 */
let activeConversationId: string | null = null;

export function getSessionActiveConversationId(): string | null {
  return activeConversationId;
}

export function setSessionActiveConversationId(conversationId: string): void {
  activeConversationId = conversationId;
}

export function clearSessionActiveConversationId(): void {
  activeConversationId = null;
}
