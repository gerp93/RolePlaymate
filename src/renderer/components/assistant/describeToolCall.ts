import type { AssistantToolCall } from '../../../shared/types/assistant';

const VERBS: Record<string, string> = {
  list_library: 'Listing the library',
  read_item: 'Reading',
  search_library: 'Searching for',
  find_similar: 'Checking for overlaps',
  propose_new_version: 'Drafting a new version of',
  propose_create: 'Drafting a new',
  update_notes: 'Updating working notes',
};

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A short human line for a tool call chip ("Reading character Mira"), from the call's arguments. */
export function describeToolCall(call: AssistantToolCall): string {
  const a = call.arguments;
  const verb = VERBS[call.name] ?? call.name;
  switch (call.name) {
    case 'read_item':
      return `${verb} ${str(a.kind)} ${str(a.name)}`.trim();
    case 'search_library':
      return `${verb} "${str(a.query)}"`;
    case 'find_similar':
      return str(a.name) ? `${verb}: ${str(a.name)}` : `${verb}: ${str(a.kind) || 'all'}`;
    case 'propose_new_version':
      return `${verb} ${str(a.name)} (${str(a.field)})`;
    case 'propose_create':
      return `${verb} ${str(a.entity)}: ${str(a.name)}`;
    case 'list_library':
      return str(a.kind) && str(a.kind) !== 'all' ? `${verb} (${str(a.kind)})` : verb;
    default:
      return verb;
  }
}
