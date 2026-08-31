/**
 * Turns an absolute portrait or spoken-audio file path into the `rpimage://` URL the main
 * process serves it from. See the protocol.handle registration in main.ts for why this exists
 * instead of a plain `file://` src.
 */
export function toImageUrl(absolutePath: string): string {
  return `rpimage://${encodeURIComponent(absolutePath)}`;
}
