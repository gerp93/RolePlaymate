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
        yet. Confirm the service is up, check <Link to="/settings">Settings → Ollama Server</Link>, then run{' '}
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
    id: 'data-location',
    question: 'Where is my data stored?',
    answer: (
      <>
        Everything lives in one SQLite database file. The default path is in your app data folder. You can
        relocate it under <Link to="/settings">Settings → Database Location</Link>.
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
        <code>localhost</code>. If that server is on another machine or a hosted endpoint, traffic follows
        that route instead.
      </>
    ),
  },
];
