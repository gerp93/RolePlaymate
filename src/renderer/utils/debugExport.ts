import { ChatDebugInfo } from '../../shared/types/chat';

/** Full plain-text export for one turn -- formatted prompt plus the response it produced. */
export function buildDebugTurnExport(
  debug: ChatDebugInfo,
  options?: { turnNumber?: number; createdAt?: string }
): string {
  const lines: string[] = [];
  if (options?.turnNumber != null && options.createdAt) {
    lines.push(`===== Turn ${options.turnNumber} — ${options.createdAt} =====`, '');
  }
  lines.push(
    debug.fullPrompt || debug.systemPrompt,
    '',
    '--- Response ---',
    debug.cleanedResponse || debug.rawResponse || '(none)'
  );
  return lines.join('\n');
}
