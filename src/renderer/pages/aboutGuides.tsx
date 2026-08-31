import { AboutTrack } from '../components/AboutStepper';
import { AboutFlow, AboutFlowRow, AboutLead, AboutList } from './aboutContent';
import { OLLAMA_SETUP_TRACK } from '../guides/ollamaSetupTrack';

export { OLLAMA_SETUP_TRACK, OLLAMA_SETUP_STEPS } from '../guides/ollamaSetupTrack';

export const ABOUT_TRACKS: AboutTrack[] = [
  // Reused as-is (not spread/copied) so this guide and the "Chat isn't set up yet" screen
  // (ChatOllamaSetup) can never drift apart the way this and the old combined 'setup' track did.
  OLLAMA_SETUP_TRACK,
  {
    id: 'app-settings',
    title: 'App Settings',
    subtitle: 'General, chat dependencies, data, and security',
    icon: '🗄',
    level: 'Core',
    blurb: 'Theme and updates, Ollama and Chatterbox, database location, chat retention, and the hidden-content PIN.',
    steps: [
      {
        kicker: 'Your data',
        title: 'Database and appearance',
        body: (
          <>
            <AboutList
              items={[
                <>
                  All library and chat data is stored in one <strong>SQLite database file</strong>. The default
                  location is in your app data folder. Spoken audio lives in a <code>tts/</code> folder beside
                  that file.
                </>,
                <>
                  <strong>Settings → Data → Database Location</strong> can point at a file in
                  OneDrive, Dropbox, or any other folder.
                </>,
                <>
                  <strong>Settings → Data → Data Retention</strong> can delete old chats (and their
                  audio). Rules are saved without deleting until you click Clean up now, or enable
                  automatic cleanup on a rule (next app open and local midnight). The library items
                  filter is empty by default, so a rule deletes every chat that matches its age and
                  message filters. Add characters (and their scenarios), personas, or world books to
                  narrow it — match any selected item, or require every type you added. With no
                  rules, chats are
                  kept forever. Mark a conversation <strong>Keep</strong> in Chat Settings to exempt
                  it. Characters, personas, scenarios, and lore are never auto-deleted.
                </>,
                <>
                  <strong>Theme</strong> is under <strong>Settings → General</strong>. Chat text size is in Chat
                  Settings.{' '}
                  <strong>Show in Explorer</strong> opens the folder containing the database file.
                </>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/settings?tab=data', label: 'Settings' },
      },
      {
        kicker: 'Optional',
        title: 'Hidden content PIN',
        body: (
          <>
            <AboutLead>
              Characters, personas, world books, and scenarios can be marked hidden. While the app is locked (🔒
              in the top bar), hidden items are removed from lists and their text is encrypted.
            </AboutLead>
            <AboutList
              items={[
                <>Default PIN: <code>1234</code> until changed in Settings → Security.</>,
                <>A forgotten PIN cannot be recovered; hidden content would be permanently inaccessible.</>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/settings?tab=security', label: 'Settings' },
      },
    ],
  },
  {
    id: 'chat',
    title: 'Chat & Library',
    subtitle: 'Conversations, content types, and version history',
    icon: '💬',
    level: 'Core',
    blurb: 'How the pieces connect, how a chat runs, and how edits are versioned.',
    steps: [
      {
        kicker: 'Overview',
        title: 'How the pieces connect',
        body: (
          <>
            <AboutFlow>
              <AboutFlowRow label="Character" detail="Who the AI portrays — personality and voice" />
              <AboutFlowRow label="Scenario" detail="Setting and opening greeting for this chat" />
              <AboutFlowRow label="Persona" detail="Who you are in the story" />
              <AboutFlowRow label="World books" detail="Reference lore injected when keywords match" />
              <AboutFlowRow label="Memories" detail="Facts carried across later turns" />
              <AboutFlowRow label="Model" detail="Ollama model that generates each reply" />
            </AboutFlow>
            <AboutLead>
              At send time, RolePlaymate assembles these into a system prompt, then sends your message history
              to the model.
            </AboutLead>
          </>
        ),
      },
      {
        kicker: 'Chat',
        title: 'Starting and continuing a conversation',
        body: (
          <>
            <AboutList
              items={[
                <>
                  On the Chat start screen, select <strong>character</strong>, <strong>persona</strong>,{' '}
                  <strong>model</strong>, and optionally a <strong>scenario</strong>. Press <strong>Begin</strong>.
                </>,
                <>
                  A scenario&apos;s <strong>greeting</strong> becomes the first assistant message when present.
                </>,
                <>
                  After your first message, <strong>character</strong> and <strong>scenario</strong> are fixed
                  for that thread.
                </>,
                <>
                  During the conversation you can change <strong>model</strong>, switch <strong>persona</strong>{' '}
                  (right sidebar <strong>Settings</strong>), swap portraits, and adjust temperature and max tokens.
                </>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/chat', label: 'Open Chat' },
      },
      {
        kicker: 'Library',
        title: 'Characters',
        body: (
          <>
            <AboutLead>
              A character is the AI roleplay partner: name, portrait, and written fields that define behavior.
            </AboutLead>
            <AboutList
              items={[
                <><strong>Personality</strong> — traits, mannerisms, and background the model should stay in.</>,
                <><strong>Example dialogue</strong> — sample lines that demonstrate formatting and tone.</>,
                <>One character can be used in many separate conversations.</>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/characters', label: 'Characters' },
      },
      {
        kicker: 'Library',
        title: 'Version history',
        body: (
          <>
            <AboutLead>
              Long text fields — character personality, scenario text, lore entries, prompt templates — use
              version history instead of overwriting in place.
            </AboutLead>
            <AboutList
              items={[
                <>Each save creates a new version. Chat always reads the <strong>latest</strong> version.</>,
                <>Open a field&apos;s history to view a word-level diff between any two versions.</>,
                <>
                  To use older wording again, copy it from history and save as a <strong>new</strong> version.
                  That version becomes the latest.
                </>,
                <>Delete a version only when you no longer need it.</>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/characters', label: 'Characters' },
      },
      {
        kicker: 'Library',
        title: 'Scenarios',
        body: (
          <>
            <AboutLead>
              A scenario is a setting attached to one character — a location, time period, or alternate situation.
            </AboutLead>
            <AboutList
              items={[
                <>
                  <strong>Scenario content</strong> — descriptive text about what is happening (versioned).
                </>,
                <>
                  <strong>Greeting</strong> — opening assistant message when the chat begins (versioned
                  separately).
                </>,
                <>Selected on the start screen before Begin; cannot be changed mid-conversation.</>,
                <>Image gallery per scenario; a cover image can become the chat portrait.</>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/characters', label: 'Characters' },
      },
      {
        kicker: 'Library',
        title: 'Personas',
        body: (
          <>
            <AboutList
              items={[
                <>
                  A <strong>persona</strong> represents you: display name and optional background text.
                </>,
                <>
                  With both name and background set, the model addresses you by name and can reference your
                  backstory. Without a persona, you appear as &quot;User.&quot;
                </>,
                <>Personas can be switched mid-conversation from the right sidebar <strong>Settings</strong> tab.</>,
                <>
                  Each persona may have a <strong>personal history</strong> lorebook — private facts only that
                  persona knows.
                </>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/personas', label: 'Personas' },
      },
      {
        kicker: 'Library',
        title: 'World books',
        body: (
          <>
            <AboutLead>
              World books hold reference material about your setting. Entries are injected into the prompt only
              when their keywords appear in recent messages.
            </AboutLead>
            <AboutList
              items={[
                <>
                  <strong>World</strong> entries are shared facts anyone in the scene can know.
                </>,
                <>
                  <strong>Personal history</strong> entries belong to one character or persona and are framed as
                  private memory.
                </>,
                <>Always-on entries are included every turn; others are ranked by priority and token budget.</>,
                <>Entry text is versioned like character fields.</>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/world-books', label: 'World Books' },
      },
      {
        kicker: 'Chat',
        title: 'Memories and message tools',
        body: (
          <>
            <AboutList
              items={[
                <>
                  <strong>Memories</strong> store facts from the conversation for later turns.{' '}
                  <strong>Pinned</strong> memories are always included; others are selected by semantic
                  similarity when embedding is available.
                </>,
                <>
                  The right sidebar lists memories and a <strong>Debug</strong> panel for lore matching and
                  prompt details.
                </>,
                <>
                  <strong>Redo</strong>, <strong>edit</strong>, and <strong>delete</strong> on the latest messages
                  adjust the transcript without starting over.
                </>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/chat', label: 'Open Chat' },
      },
    ],
  },
  {
    id: 'tuning',
    title: 'Fine Tuning',
    subtitle: 'Prompt templates, models, and per-turn controls',
    icon: '◎',
    level: 'Advanced',
    blurb: 'Adjust instruction wording, model availability, and sampler defaults.',
    steps: [
      {
        kicker: 'Overview',
        title: 'The system prompt',
        body: (
          <>
            <AboutLead>
              Before each reply, RolePlaymate builds a system prompt from fixed sections:
            </AboutLead>
            <AboutList
              items={[
                <>Character identity, personality, scenario, and example dialogue</>,
                <>Template rules (character instructions, stop phrases)</>,
                <>Persona context when name and background are both set</>,
                <>Matched lore entries and retrieved memories</>,
                <>Per-turn directions from the composer when provided</>,
              ]}
            />
            <AboutLead>Your chat messages are sent on top of this assembled prompt.</AboutLead>
          </>
        ),
      },
      {
        kicker: 'Prompt Tuning',
        title: 'Instruction templates',
        body: (
          <>
            <AboutList
              items={[
                <>
                  <strong>Prompt Tuning</strong> edits the wrapper text around each section — how character
                  rules, memories, lore, and directions are introduced.
                </>,
                <>
                  Placeholders such as <code>{'{char}'}</code> and <code>{'{persona}'}</code> are replaced with
                  live values at send time.
                </>,
                <>Template fields are versioned. A sample assembled prompt on that page shows the full structure.</>,
                <>
                  <strong>Stop phrases</strong> mark where the model should end its output.
                </>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/prompt-tuning', label: 'Prompt Tuning' },
      },
      {
        kicker: 'Model Tuning',
        title: 'Models and samplers',
        body: (
          <>
            <AboutList
              items={[
                <>
                  <strong>Model Tuning</strong> lists models reported by Ollama. Toggle <strong>In Chat</strong>{' '}
                  to control which appear in the chat dropdown.
                </>,
                <>
                  <strong>Tier</strong> is writing capability relative to your other installed models.{' '}
                  <strong>On this PC</strong> is expected reply speed on this machine&apos;s CPU, RAM, and
                  GPU. The overlap — a high Tier that is still Fast or OK here — is the usual sweet spot.
                </>,
                <>
                  <strong>Temperature</strong> controls randomness (lower = more predictable).{' '}
                  <strong>Max tokens</strong> caps reply length.
                </>,
                <>Defaults are per model. Chat sliders override them for the current session until the model changes.</>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/model-tuning', label: 'Model Tuning' },
      },
      {
        kicker: 'Chat',
        title: 'Per-turn controls',
        body: (
          <>
            <AboutList
              items={[
                <>Toolbar: <strong>model</strong> selection and <strong>Send</strong>.</>,
                <>
                  Right sidebar <strong>Settings</strong>: persona, chat text size, temperature, max tokens,
                  portrait visibility, and spoken-reply options.
                </>,
                <>
                  <strong>Directions</strong> (above the composer, right side): a note included for the next
                  reply only. In Queue speech mode, <strong>Skip dialogue</strong> sits beside it and
                  advances past the clip that's playing.
                </>,
                <>
                  <strong>Suggest</strong> (inside the message box): drafts a user line. <strong>Use this</strong>{' '}
                  sends it; <strong>Edit</strong> changes it in that card first.
                </>,
                <>
                  <strong>Continue as …</strong> under the last character reply: the character takes another
                  turn without a message from you.
                </>,
                <>Portrait images affect display only; they are not sent to the model.</>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/chat', label: 'Open Chat' },
      },
      {
        kicker: 'Debug',
        title: 'Inspecting a turn',
        body: (
          <>
            <AboutList
              items={[
                <>
                  <strong>Debug</strong> (chat sidebar): lore entries that matched, entries skipped for size,
                  and the keyword scan window.
                </>,
                <>
                  <strong>View prompt</strong> (message hover): logged prompt data for that assistant turn.
                </>,
                <>
                  Common causes of missing lore: keyword not present in the scan window, entry over the token
                  budget, or entry attached only to the persona when the character is replying.
                </>,
              ]}
            />
          </>
        ),
        pageLink: { to: '/chat', label: 'Open Chat' },
      },
    ],
  },
];

export const ABOUT_TRACK_ORDER: AboutTrack['id'][] = ['ollama-setup', 'app-settings', 'chat', 'tuning'];
