export const CHAT_FONT_SIZES = [14, 16, 18, 20, 22, 24] as const;
export type ChatFontSize = (typeof CHAT_FONT_SIZES)[number];
export const DEFAULT_CHAT_FONT_SIZE: ChatFontSize = 18;

const STORAGE_KEY = 'roleplaymate-chat-font-size';

export function getStoredChatFontSize(): ChatFontSize {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if ((CHAT_FONT_SIZES as readonly number[]).includes(stored)) {
      return stored as ChatFontSize;
    }
  } catch {
    // localStorage not available
  }
  return DEFAULT_CHAT_FONT_SIZE;
}

export function saveChatFontSize(size: ChatFontSize): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // localStorage not available
  }
}
