import { formatClock } from '../../../shared/utils/formatDuration';
import { CHAT_IDLE_MS } from '../../../shared/utils/activeTimeClock';

interface Props {
  seconds: number | null;
  running: boolean;
}

/** Time actively spent in this chat, over the transcript. Dims and says "paused" when it isn't counting. */
export default function ChatTimer({ seconds, running }: Props) {
  if (seconds === null) return null;
  const minutes = Math.round(CHAT_IDLE_MS / 60000);
  return (
    <div
      className={`chat-timer${running ? '' : ' chat-timer-paused'}`}
      title={`Time actively spent in this chat, across every visit. Pauses after ${minutes} minutes without mouse or keyboard activity, and while the window is hidden. Hide it in the chat Settings tab.`}
    >
      <span className="chat-timer-clock">{formatClock(seconds)}</span>
      {!running && <span className="chat-timer-state">paused</span>}
    </div>
  );
}
