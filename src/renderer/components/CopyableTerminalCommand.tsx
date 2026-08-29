import { useState } from 'react';
import './CopyableTerminalCommand.css';

interface Props {
  command: string;
  className?: string;
}

export default function CopyableTerminalCommand({ command, className }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={['copyable-terminal-command', className].filter(Boolean).join(' ')}>
      <pre className="copyable-terminal-command-pre">
        <code>{command}</code>
      </pre>
      <button
        type="button"
        className="btn copyable-terminal-command-copy"
        onClick={() => void copy()}
        aria-label={copied ? 'Copied' : 'Copy command'}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
