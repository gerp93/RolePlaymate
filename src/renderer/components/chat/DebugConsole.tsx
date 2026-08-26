import { ReactNode, useState } from 'react';
import { ChatDebugInfo } from '../../../shared/types/chat';
import {
  Segment,
  highlightBracketTags,
  highlightRoleBlocks,
  formatStopPhrase,
  buildHistoryEntries,
} from '../../../shared/utils/debugHighlight';

/**
 * The Prompt Debug Console, ported closely from KVGenius's `_populate_debug_console`.
 *
 * The behaviour that makes it worth having: **every section always renders**. Populated ones
 * are collapsible panels with their own copy button; empty ones show as a greyed-out
 * "— (empty)" row. Being able to see at a glance what was *not* sent is most of the value,
 * so empty sections are never filtered out.
 */
export default function DebugConsole({ debug }: { debug: ChatDebugInfo | null }) {
  if (!debug) {
    return (
      <div className="debug-console">
        <div className="debug-console-header">
          <span className="debug-console-title">🔍 Prompt Debug Console</span>
        </div>
        <p className="debug-console-placeholder">
          Send a message to see the prompt debug info here.
        </p>
      </div>
    );
  }

  const personaBody = debug.personaName
    ? `Name: ${debug.personaName}\nBackground: ${debug.personaBackground || '(none)'}`
    : '';

  const historyEntries = buildHistoryEntries(debug.historyTurns);
  const turnCount = historyEntries.filter((e) => e.role === 'user').length;

  return (
    <div className="debug-console">
      <div className="debug-console-header">
        <span className="debug-console-title">🔍 Prompt Debug Console</span>
        <CopyButton value={debug.fullPrompt} label="Copy full prompt" />
      </div>

      <ul className="debug-colour-key">
        <li><span className="key-swatch seg-system" /> System</li>
        <li><span className="key-swatch seg-user" /> User</li>
        <li><span className="key-swatch seg-assistant" /> LLM</li>
        <li><span className="key-swatch seg-tag" /> Tags</li>
      </ul>

      <GroupHeading>Prompt components</GroupHeading>
      <Section title="Base System Prompt (Character)" icon="👤" body={debug.baseSystemPrompt} defaultOpen />
      <Section title="Character Instructions (always sent)" icon="📋" body={debug.characterInstructions} />
      <Section title="Persona Context" icon="🎭" body={personaBody} />

      <GroupHeading>Scene instructions</GroupHeading>
      <Section title="Instructions (this turn)" icon="🎬" body={debug.directions} defaultOpen />

      <GroupHeading>Memories</GroupHeading>
      <Section
        title={`Memories (${debug.memories.length})`}
        icon="🧠"
        body={debug.memories.map((m) => `- ${m}`).join('\n')}
      />

      <GroupHeading>Conversation history ({turnCount} turns)</GroupHeading>
      {historyEntries.length > 0 ? (
        <Panel title={`Prior Chat Messages (${turnCount} turns)`} icon="💬" body={renderHistoryText(historyEntries)}>
          <pre className="debug-body">
            {historyEntries.map((entry, index) => (
              <div key={index}>
                {entry.role === 'user' && <span className="seg-tag">{`── Turn ${entry.turn} ──\n`}</span>}
                <span className={entry.role === 'user' ? 'seg-user' : 'seg-assistant'}>
                  {`  ${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}\n`}
                </span>
              </div>
            ))}
          </pre>
        </Panel>
      ) : (
        <EmptySection title="Prior Chat Messages (0 turns)" icon="💬" />
      )}

      <GroupHeading>Assembled &amp; sent</GroupHeading>
      <Section title="Assembled System Prompt" icon="📋" body={debug.systemPrompt} />
      <Section title="User Message" icon="💬" body={debug.userMessage} />
      <div className="debug-stats">
        <span>📊 History: {debug.historyLength} turns</span>
        <span className="debug-stats-divider">│</span>
        <span className={debug.memories.length ? '' : 'text-muted'}>🧠 Memories: {debug.memories.length}</span>
        <span className="debug-stats-divider">│</span>
        <span>
          🔢 Tokens: {debug.inputTokens ?? '?'} in → {debug.outputTokens ?? '?'} out
        </span>
      </div>

      <GroupHeading>Generation pipeline</GroupHeading>
      {debug.fullPrompt ? (
        <Panel title="Full Formatted Prompt" icon="📜" body={debug.fullPrompt}>
          <SegmentedBody segments={highlightRoleBlocks(debug.fullPrompt)} />
        </Panel>
      ) : (
        <EmptySection title="Full Formatted Prompt" icon="📜" />
      )}
      <Section title="Raw Response (pre-cleanup)" icon="🟢" body={debug.rawResponse} />
      {debug.stopPhrases.length > 0 ? (
        <Panel
          title="Stop Phrases Applied"
          icon="🛑"
          body={debug.stopPhrases.map(formatStopPhrase).join('\n')}
        >
          <pre className="debug-body">
            {debug.stopPhrases.map((phrase, index) => (
              <div key={index} className="seg-tag">{`  ${formatStopPhrase(phrase)}`}</div>
            ))}
          </pre>
        </Panel>
      ) : (
        <EmptySection title="Stop Phrases Applied" icon="🛑" />
      )}
      <Section title="Cleaned Response" icon="✅" body={debug.cleanedResponse} defaultOpen />
      {debug.error && <Section title="Error" icon="❌" body={debug.error} defaultOpen />}
    </div>
  );
}

function renderHistoryText(entries: ReturnType<typeof buildHistoryEntries>): string {
  return entries
    .map((e) => `${e.role === 'user' ? `── Turn ${e.turn} ──\n` : ''}  ${e.role}: ${e.content}`)
    .join('\n');
}

function GroupHeading({ children }: { children: ReactNode }) {
  // Uppercasing via CSS, not String(children) -- children is a node array when it contains
  // an interpolation, and Array.toString would splice commas into the heading.
  return <div className="debug-group-heading">▸ {children}</div>;
}

/** A populated section, or the greyed placeholder when its input was blank. */
function Section({
  title,
  icon,
  body,
  defaultOpen = false,
}: {
  title: string;
  icon: string;
  body: string;
  defaultOpen?: boolean;
}) {
  if (!body?.trim()) return <EmptySection title={title} icon={icon} />;
  return (
    <Panel title={title} icon={icon} body={body} defaultOpen={defaultOpen}>
      <SegmentedBody segments={highlightBracketTags(body)} />
    </Panel>
  );
}

/** `<details>` rather than hand-rolled collapse state: keyboard-accessible for free. */
function Panel({
  title,
  icon,
  body,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: string;
  body: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="debug-section" open={defaultOpen}>
      <summary>
        <span className="debug-section-icon">{icon}</span>
        <span className="debug-section-title">{title}</span>
        <CopyButton value={body} label={`Copy ${title}`} />
      </summary>
      {children}
    </details>
  );
}

function EmptySection({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="debug-section debug-section-empty">
      <span className="debug-section-icon">{icon}</span>
      <span className="debug-section-title">{title}</span>
      <span className="debug-section-empty-label">— (empty)</span>
    </div>
  );
}

function SegmentedBody({ segments }: { segments: Segment[] }) {
  return (
    <pre className="debug-body">
      {segments.map((segment, index) => (
        <span key={index} className={`seg-${segment.kind}`}>
          {segment.text}
        </span>
      ))}
    </pre>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="debug-copy-btn"
      title={label}
      aria-label={label}
      onClick={(event) => {
        // Inside a <summary>, a click would otherwise toggle the panel.
        event.preventDefault();
        event.stopPropagation();
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}
