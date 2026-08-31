import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import CopyableTerminalCommand from '../components/CopyableTerminalCommand';

const CHAT_MODEL_EXAMPLE_COMMAND = 'ollama pull llama3.2';

export interface AboutFaqItem {
  id: string;
  question: string;
  answer: ReactNode;
}

export const ABOUT_FAQ: AboutFaqItem[] = [
  {
    id: 'ollama-required',
    question: 'Do I need Ollama to use RolePlaymate?',
    answer: (
      <>
        No for the library — characters, personas, world books, and images work without it. Yes for chat:
        replies are generated through Ollama on your machine.
      </>
    ),
  },
  {
    id: 'empty-models',
    question: 'Why is my model list empty?',
    answer: (
      <>
        Ollama is probably not running, not reachable at the configured address, or has no models pulled
        yet. Confirm the service is up, check{' '}
        <Link to="/settings?tab=servers">Settings → Chat Dependencies</Link>, then run{' '}
        <code>ollama pull &lt;model-name&gt;</code> in a terminal (replace with a model from Ollama&apos;s
        library).
        <CopyableTerminalCommand command={CHAT_MODEL_EXAMPLE_COMMAND} />
      </>
    ),
  },
  {
    id: 'change-scenario',
    question: 'Can I change character or scenario mid-chat?',
    answer: (
      <>
        No. After your first message, <strong>character</strong> and <strong>scenario</strong> are fixed for
        that conversation. You can still change model, persona, portraits, and sampler sliders.
      </>
    ),
  },
  {
    id: 'lore-missing',
    question: "Why didn't my lore entry appear?",
    answer: (
      <>
        Keywords must appear in the scan window (recent messages plus the one being sent). The entry may also
        be over the token budget, or attached only to your persona when the character is replying. Check the{' '}
        <strong>Debug</strong> panel in chat for the exact match list and scan window.
      </>
    ),
  },
  {
    id: 'world-vs-personal',
    question: 'What is the difference between world and personal history lore?',
    answer: (
      <>
        <strong>World</strong> entries are shared setting facts anyone in the scene can know.{' '}
        <strong>Personal history</strong> entries belong to one character or persona and are framed as private
        memory only they have.
      </>
    ),
  },
  {
    id: 'versioning',
    question: 'How does version history work?',
    answer: (
      <>
        Each save creates a new version instead of overwriting. Chat always uses the <strong>latest</strong>{' '}
        version. To restore older text, copy it from history and save as a new version — that becomes the
        latest.
      </>
    ),
  },
  {
    id: 'model-speed',
    question: 'What do Tier and On this PC mean on Model Tuning?',
    answer: (
      <>
        <strong>Tier</strong> (Good / Better / Best) is a relative guess at writing capability from
        parameter count, quantization, and context window.{' '}
        <strong>On this PC</strong> (Fast / OK / Slow) is a separate heuristic: how quickly that model
        is expected to generate on <em>this</em> computer&apos;s GPU, RAM, and CPU. A large model can
        be Best and Slow at the same time. The page lists detected hardware at the top so you can see
        what the speed guess is based on.
      </>
    ),
  },
  {
    id: 'data-location',
    question: 'Where is my data stored?',
    answer: (
      <>
        Everything lives in one SQLite database file. The default path is in your app data folder. You can
        relocate it under <Link to="/settings?tab=data">Settings → Data</Link>. Optional chat
        retention rules on that same tab can delete old conversations and their
        spoken audio; with no rules, chats are kept forever. Automatic cleanup
        is per rule and off unless you turn it on. Each rule has a library items
        filter; leave it empty to delete every chat that matches the age and
        message filters, or add characters (and those characters&apos;
        scenarios), personas, or world books to narrow it. Match any selected
        item, or require every type you added.
      </>
    ),
  },
  {
    id: 'macros',
    question: 'What are {{char}} and {{user}}?',
    answer: (
      <>
        Placeholders in field text. <code>{'{{char}}'}</code> becomes the character&apos;s name;{' '}
        <code>{'{{user}}'}</code> becomes your persona&apos;s name, or &quot;User&quot; when none is selected.
        They are replaced before text reaches the model.
      </>
    ),
  },
  {
    id: 'memories',
    question: 'Why are memories missing from a reply?',
    answer: (
      <>
        Unpinned memories are selected by semantic similarity when embedding is available. If Ollama has no
        embedding model, only <strong>pinned</strong> memories are included. Pin important facts you always
        want in context.
      </>
    ),
  },
  {
    id: 'internet',
    question: 'Does RolePlaymate send data to the internet?',
    answer: (
      <>
        Not by itself. Chat requests go only to the Ollama server address you configure — typically{' '}
        <code>localhost</code>. Spoken replies go only to the Chatterbox address in Settings, also typically{' '}
        <code>localhost</code>. If either server is on another machine or a hosted endpoint, traffic follows
        that route instead.
      </>
    ),
  },
  {
    id: 'spoken-replies',
    question: 'How do spoken replies work?',
    answer: (
      <>
        Optionally, through a local Chatterbox TTS server — the same idea as Ollama, not a voice model inside
        this app. Assign a voice on the character page, or a narrator voice under{' '}
        <Link to="/settings?tab=servers">Settings → Chat Dependencies</Link> (used when the character has none, or when
        Chat Settings is set to narrator / split italics). Import custom voices (WAV or MP3, not MP4)
        from that same Settings card — each clip needs a voice name. Preview a sample line next to
        the voice picker on a character, a persona, or in Settings. Character and
        persona speech can each be Off, Auto, or Manual. Chat Settings also chooses
        whether a new line interrupts the one that&apos;s playing or waits in a queue — they never
        overlap. Queue mode adds Skip dialogue next to Directions (enabled while something is
        playing). Controls live on each message
        (play/pause, generate, a spinner while Chatterbox is working). Once a line has been spoken,
        the WAV is kept with that message so play does not call Chatterbox again. Chat still works if
        Chatterbox isn&apos;t running; replies just stay silent.
      </>
    ),
  },
];
