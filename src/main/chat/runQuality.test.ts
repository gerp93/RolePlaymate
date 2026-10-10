import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AutomationRunLog } from '../../shared/types/automation';
import { renderQualityReport } from './runQuality';

const PROMPT_WITH_PLACEHOLDER =
  '[CHARACTER]\nName: Mara\n[/CHARACTER]\n\n[EXAMPLE DIALOGUE]\ntest dialouge\n[/EXAMPLE DIALOGUE]\n\n[CHARACTER RULES]\nbe Mara\n[/CHARACTER RULES]';

interface Retrieval {
  selected: string[];
  total: number;
}

function makeLog(opts: { lines: Array<[string, string]>; retrievals?: Retrieval[]; prompt?: string; memories?: string[][] }): AutomationRunLog {
  const turns = (opts.retrievals ?? []).map((r, i) => ({
    index: i + 1,
    debug: {
      systemPrompt: i === 0 ? (opts.prompt ?? PROMPT_WITH_PLACEHOLDER) : undefined,
      retrieval: {
        query: '',
        selected: r.selected.map((content) => ({ memory: { id: content, content, source: 'auto' }, score: 0.6, pinned: false })),
        rejected: [],
        totalAvailable: r.total,
        budgetTokensUsed: 0,
        budgetTokensMax: 400,
      },
    },
  }));
  return {
    formatVersion: 1,
    run: { characterName: 'Mara', personaName: 'Tom' },
    settings: {},
    transcript: opts.lines.map(([speaker, content], seq) => ({ seq, role: speaker === 'Mara' ? 'assistant' : 'user', speaker, content })),
    turns,
    memoryEvents: (opts.memories ?? []).map((memories, i) => ({ afterTurn: i + 1, memories })),
    memoriesAtEnd: [],
  } as unknown as AutomationRunLog;
}

// A run that circles: Mara says the same stock phrase, the talk stops moving, and the opening topic vanishes.
const lines: Array<[string, string]> = [];
for (let i = 0; i < 24; i += 1) {
  lines.push([
    'Tom',
    i < 4
      ? `*I lean on the ledger table.* "The forged ledger from the harbour office proves everything, Mara${i}."`
      : `*I keep watch by the window.* "Stay alert, nothing has changed${i % 2}."`,
  ]);
  lines.push([
    'Mara',
    i < 4
      ? `*I study the forged ledger.* "The harbour office stamp is wrong."`
      : `*My heart pounding in my chest, I whisper.* "I know, we wait here${i % 2}."`,
  ]);
}

test('the report names the stock phrase, the stall, the dropped topic, and the placeholder example dialogue', () => {
  const log = makeLog({
    lines,
    retrievals: Array.from({ length: 24 }, (_, i) => ({ selected: ['Mara is nervous about the dark.', `Fact ${i}.`], total: 10 + i })),
    memories: [['The ledger was forged.'], ['Tom saw the stamp.']],
  });
  const text = renderQualityReport(log).join('\n');
  assert.match(text, /## Run quality report/);
  assert.match(text, /heart pounding in my chest/);
  assert.match(text, /The scene went in circles/);
  assert.match(text, /ledger|harbour|forged/); // words from the first 15% that never come back
  assert.match(text, /looks like a placeholder/);
  assert.match(text, /Injected into 24 of 24 turns: Mara is nervous about the dark\./);
  assert.match(text, /feeling/); // that memory is a mood, not a fact
});

test('a short run is not measured', () => {
  const text = renderQualityReport(makeLog({ lines: lines.slice(0, 4) })).join('\n');
  assert.match(text, /Too short to measure/);
});

test('real example dialogue and varied talk are reported as fine', () => {
  const varied: Array<[string, string]> = [
    ['Tom', 'The cathedral bells stopped ringing an hour early, which nobody mentions.'],
    ['Mara', 'Because the bell-ringer was paid off. His wages doubled in March, according to this payroll sheet.'],
    ['Tom', 'Paid by whom? There is a stamp from the grain exchange in the corner.'],
    ['Mara', 'Then follow the grain. Orchard deliveries should match the stamped weights, and these never do.'],
    ['Tom', 'A foundry across the canal burned last winter. Insurance paid out remarkably fast.'],
    ['Mara', 'Faster than the inspector arrived, I would guess. Wait, this carbon copy bears another signature.'],
    ['Tom', 'Whose? The tannery foreman, or somebody from the observatory board?'],
    ['Mara', 'Neither. The lighthouse keeper, who supposedly cannot write at all.'],
    ['Tom', 'Then someone forged him. Quarry records might show who borrowed his seal.'],
    ['Mara', 'The ferry ledger lists a passenger without a name on the night of the fire.'],
    ['Tom', 'Check the market gate logs; unnamed travellers always pay in coin.'],
    ['Mara', 'Coin minted before the strike. Our nameless traveller hoards old money.'],
  ];
  const prompt =
    '[EXAMPLE DIALOGUE]\nMara: "Paper never lies, only people do. Look at the weave of this sheet."\nTom: "And the ink?"\nMara: "Iron gall, mixed within the week."\n[/EXAMPLE DIALOGUE]';
  const text = renderQualityReport(makeLog({ lines: varied, retrievals: [{ selected: ['The ferry stopped running.'], total: 3 }], prompt })).join('\n');
  assert.match(text, /The scene kept bringing in new material/);
  assert.match(text, /Example dialogue present/);
  assert.doesNotMatch(text, /placeholder/);
});
