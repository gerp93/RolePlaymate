import { AboutStep } from '../components/AboutStepper';
import { AboutTrack } from '../components/AboutStepper';
import { DEFAULT_EMBEDDING_MODEL } from '../../shared/embeddingModel';
import CopyableTerminalCommand from '../components/CopyableTerminalCommand';
import { AboutCallout, AboutLead, AboutList, AboutSubheading } from '../pages/aboutContent';

const EMBEDDING_PULL_COMMAND = `ollama pull ${DEFAULT_EMBEDDING_MODEL}`;
const CHAT_MODEL_EXAMPLE_COMMAND = 'ollama pull llama3.2';

/** Ollama setup steps shared by Guides → Setup and the Chat setup screen. */
export const OLLAMA_SETUP_STEPS: AboutStep[] = [
  {
    kicker: 'Overview',
    title: 'Library and chat',
    body: (
      <>
        <AboutLead>RolePlaymate has two parts that work independently:</AboutLead>
        <AboutList
          items={[
            <>
              <strong>Library</strong> — characters, personas, world books, and images stored in a local
              database. No extra software required.
            </>,
            <>
              <strong>Chat</strong> — conversations powered by a model running through{' '}
              <strong>Ollama</strong> on your computer. RolePlaymate does not include models and does not send
              data to external services.
            </>,
          ]}
        />
        <AboutSubheading>What is Ollama?</AboutSubheading>
        <AboutLead>
          Ollama is a free app that runs large language models on your own computer. You download the models you
          want (separately from RolePlaymate), and Ollama serves them locally over{' '}
          <code>http://localhost:11434</code>.
        </AboutLead>
        <AboutList
          items={[
            <>RolePlaymate sends chat requests to Ollama on your machine — nothing goes to the cloud unless you point Ollama at a remote server yourself.</>,
            <>Models can be large (several GB) and use your CPU or GPU while a reply is generating.</>,
            <>If Ollama is not installed or not running, Chat cannot generate replies — the Library still works.</>,
          ]}
        />
      </>
    ),
    extraLinks: [{ href: 'https://ollama.com', label: 'Ollama', external: true }],
  },
  {
    kicker: 'Step 1',
    title: 'Install Ollama',
    body: (
      <>
        <AboutLead>
          Download Ollama for your operating system and complete its installation guide. When the service is
          running, a terminal command such as <code>ollama --version</code> should succeed, or the Ollama icon
          should appear in the system tray on Windows.
        </AboutLead>
      </>
    ),
    extraLinks: [
      { href: 'https://ollama.com/download', label: 'Download Ollama', external: true },
      {
        href: 'https://github.com/ollama/ollama/blob/main/README.md',
        label: 'Ollama documentation',
        external: true,
      },
    ],
  },
  {
    kicker: 'Step 2',
    title: 'Pull a model',
    body: (
      <>
        <AboutLead>Models are installed with Ollama, not inside RolePlaymate.</AboutLead>
        <AboutList
          items={[
            <>
              Open a terminal and run <code>ollama pull &lt;model-name&gt;</code> — replace{' '}
              <code>&lt;model-name&gt;</code> with a model from Ollama&apos;s library.
            </>,
            <>Browse Ollama&apos;s model library for names, sizes, and hardware requirements.</>,
            <>Return to RolePlaymate&apos;s Chat page — installed models appear in the model dropdown.</>,
          ]}
        />
        <AboutLead>Example:</AboutLead>
        <CopyableTerminalCommand command={CHAT_MODEL_EXAMPLE_COMMAND} />
        <AboutCallout>
          An empty model list usually means Ollama is not running or not reachable at the configured server
          address.
        </AboutCallout>
      </>
    ),
    extraLinks: [{ href: 'https://ollama.com/library', label: 'Model library', external: true }],
    pageLink: { to: '/chat', label: 'Open Chat' },
  },
  {
    kicker: 'Connection',
    title: 'Ollama server address',
    body: (
      <>
        <AboutLead>
          The default address is <code>http://localhost:11434</code>. RolePlaymate checks this on each chat
          request.
        </AboutLead>
        <AboutList
          items={[
            <>Once Ollama is running, return to Chat — this page detects the server automatically.</>,
            <>
              For Ollama on another machine or port, set <strong>Settings → Chat Dependencies</strong>. Changes apply
              immediately.
            </>,
          ]}
        />
      </>
    ),
    pageLink: { to: '/settings?tab=servers', label: 'Settings' },
  },
  {
    kicker: 'Memories',
    title: 'Embedding model (optional)',
    body: (
      <>
        <AboutLead>
          <strong>Memories</strong> are short notes about key events in <strong>this conversation</strong> only —
          not library lore, and not shared across chats. After each turn, the chat extracts them from the
          transcript so later turns can recall what happened without resending the whole history.
        </AboutLead>
        <AboutList
          items={[
            <>
              <strong>Pinned</strong> — you choose which extracted entries to pin in the chat Memories panel.
              Pinned memories are always included in later turns; no embedding model required.
            </>,
            <>
              <strong>Unpinned</strong> — the rest stay in the list and are brought back only when they match
              what you are talking about.
            </>,
          ]}
        />
        <AboutLead>
          Unpinned memories are matched by meaning through a separate Ollama model,{' '}
          <code>{DEFAULT_EMBEDDING_MODEL}</code>. Use this command in a terminal to add the model to your Ollama
          server. Chat still works without it, but unpinned memories may not surface as the conversation grows
          — the model is more likely to forget earlier events.
        </AboutLead>
        <CopyableTerminalCommand command={EMBEDDING_PULL_COMMAND} />
      </>
    ),
    extraLinks: [
      {
        href: `https://ollama.com/library/${DEFAULT_EMBEDDING_MODEL}`,
        label: 'Model page',
        external: true,
      },
    ],
  },
];

export const OLLAMA_SETUP_TRACK: AboutTrack = {
  id: 'ollama-setup',
  title: 'Set up Ollama',
  subtitle: 'Install Ollama, pull models, and connect RolePlaymate',
  icon: '⚙',
  level: 'Start here',
  blurb: 'Install Ollama, pull a chat model, and optionally an embedding model for memories.',
  steps: OLLAMA_SETUP_STEPS,
};

/** Index of the "Embedding model (optional)" step within OLLAMA_SETUP_STEPS -- also its index
 * within the 'ollama-setup' About track (aboutGuides.tsx), since OLLAMA_SETUP_TRACK.steps is
 * OLLAMA_SETUP_STEPS itself. */
export const OLLAMA_MEMORIES_STEP_INDEX = OLLAMA_SETUP_STEPS.length - 1;
