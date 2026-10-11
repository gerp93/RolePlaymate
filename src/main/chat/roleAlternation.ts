import type { OllamaChatMessage } from './ollamaClient';

/** Stands in for the user's turn when a conversation opens with the character speaking (the scenario's greeting). */
export const OPENING_PLACEHOLDER = '[The conversation begins.]';

/**
 * Makes a request satisfy a strict chat template: after the system message, the first message must be
 * from the user and the roles must alternate user, assistant, user, assistant...
 *
 * Some models (Mistral-family templates, e.g. magnum:22b) enforce this in their template and Ollama
 * answers HTTP 400 otherwise. Conversations here break it in two ways: a scenario's greeting is the
 * first message and it is the character's, and anything that puts two lines from one side back to back
 * (a directions-only line, a guest's line). So:
 *
 *  - an opening assistant message gets a short placeholder user message in front of it;
 *  - consecutive messages from the same side are joined into one, in order, blank line between.
 *
 * Only used for a model that has refused the plain request -- every other model is sent exactly what it
 * always was. The stored conversation is never touched.
 */
export function alternateRoles(messages: OllamaChatMessage[]): OllamaChatMessage[] {
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  const out: OllamaChatMessage[] = [];
  if (system.length > 0) out.push({ role: 'system', content: system.map((m) => m.content).join('\n\n') });

  let last: OllamaChatMessage | null = null;
  for (const message of rest) {
    if (last === null && message.role === 'assistant') {
      last = { role: 'user', content: OPENING_PLACEHOLDER };
      out.push(last);
    }
    if (last !== null && last.role === message.role) {
      // `last` is the object already in `out`, so this extends it in place.
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      last = { role: message.role, content: message.content };
      out.push(last);
    }
  }
  return out;
}

/** Whether Ollama refused a request because the model's template needs alternating roles. */
export function isAlternationError(message: string): boolean {
  return /conversation roles must alternate/i.test(message);
}
