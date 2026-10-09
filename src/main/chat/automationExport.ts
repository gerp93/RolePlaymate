import { AutomationRunLog } from '../../shared/types/automation';

/**
 * The readable form of a run log: the transcript, then for every turn which memories the model
 * was given (with scores) and what was left out, then the memories stored by the end. The full
 * prompts are only in the JSON export -- repeating them here would make this unreadable.
 */
export function renderRunMarkdown(log: AutomationRunLog): string {
  const { run } = log;
  const out: string[] = [];

  out.push(`# Automated run: ${run.characterName} and ${run.personaName}`);
  out.push('');
  out.push(`- Status: **${run.status}**${run.error ? ` -- ${run.error}` : ''}`);
  out.push(`- Turns: ${run.completedTurns} of ${run.requestedTurns}`);
  out.push(`- Model: ${run.model}`);
  out.push(`- Conversation: ${run.conversationTitle}`);
  if (run.scenarioName) out.push(`- Scenario: ${run.scenarioName}`);
  out.push(`- Started: ${run.startedAt}${run.finishedAt ? `, finished ${run.finishedAt}` : ''}`);
  out.push('');
  out.push('## Settings');
  out.push('');
  out.push('```json');
  out.push(JSON.stringify(log.settings, null, 2));
  out.push('```');

  out.push('');
  out.push('## Transcript');
  for (const line of log.transcript) {
    out.push('');
    out.push(`**${line.speaker}:** ${line.content}`);
  }

  out.push('');
  out.push('## Memories, turn by turn');
  out.push('');
  out.push('For each reply: the memories injected into the prompt (score), and the ones considered but left out.');
  for (const turn of log.turns) {
    out.push('');
    out.push(`### Turn ${turn.index}`);
    out.push('');
    out.push(`Retrieval query: ${JSON.stringify(turn.debug.retrieval?.query ?? '')}`);
    const retrieval = turn.debug.retrieval;
    if (!retrieval) {
      out.push('');
      out.push('No retrieval ran (no stored memories yet).');
    } else {
      out.push('');
      out.push(`Injected (${retrieval.selected.length} of ${retrieval.totalAvailable}):`);
      if (retrieval.selected.length === 0) out.push('- none');
      for (const entry of retrieval.selected) {
        out.push(`- (${entry.score.toFixed(2)}${entry.pinned ? ', pinned' : ''}) ${entry.memory.content}`);
      }
      if (retrieval.rejected.length > 0) {
        out.push('');
        out.push('Left out:');
        for (const entry of retrieval.rejected) out.push(`- (${entry.score.toFixed(2)}) ${entry.memory.content}`);
      }
    }
    const lore = turn.debug.lore;
    if (lore && lore.selected.length > 0) {
      out.push('');
      out.push(`Lore that fired: ${lore.selected.map((entry) => entry.title).join(', ')}`);
    }
  }

  out.push('');
  out.push('## When memories were stored');
  out.push('');
  if (log.memoryEvents.length === 0) out.push('None were stored during the run.');
  for (const event of log.memoryEvents) {
    out.push(`After turn ${event.afterTurn}:`);
    for (const memory of event.memories) out.push(`- ${memory}`);
  }

  out.push('');
  out.push('## Memories at the end of the run');
  out.push('');
  if (log.memoriesAtEnd.length === 0) out.push('None.');
  for (const memory of log.memoriesAtEnd) {
    out.push(`- ${memory.source === 'manual' ? '(pinned) ' : ''}${memory.content}`);
  }
  out.push('');

  return out.join('\n');
}
