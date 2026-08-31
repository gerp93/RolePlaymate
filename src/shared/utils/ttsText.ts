/**
 * Strips common roleplay/markdown markup so Chatterbox reads the line instead of the
 * asterisks. Split-italics planning lives in ttsSegments.ts and runs before this.
 * Empty after stripping means there is nothing worth sending (the caller skips speech).
 */
export function textForSpeech(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/[*_~`]+/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
