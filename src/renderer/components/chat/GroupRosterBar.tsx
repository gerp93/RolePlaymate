import './GroupRosterBar.css';

export interface RosterBarMember {
  id: string;
  name: string;
  /** Cover image url, or null for the initial-letter fallback. */
  avatarUrl: string | null;
}

interface Props {
  groupName: string;
  members: RosterBarMember[];
  /** Who replies next -- highlighted. Sending a message or "Continue" is answered by them. */
  selectedId: string;
  onSelect: (characterId: string) => void;
  /** Locked while a reply is streaming, so the chip can't disagree with who is speaking. */
  disabled?: boolean;
}

/**
 * A group chat's cast, shown above the transcript. The highlighted member is who speaks next
 * (it advances round-robin after every reply); click another to hand them the next turn.
 */
export default function GroupRosterBar({ groupName, members, selectedId, onSelect, disabled }: Props) {
  return (
    <div className="chat-roster-bar" role="group" aria-label={`${groupName} -- who speaks next`}>
      <span className="chat-roster-bar-title" title={groupName}>
        {groupName}
      </span>
      <div className="chat-roster-bar-members">
        {members.map((member) => {
          const selected = member.id === selectedId;
          return (
            <button
              key={member.id}
              type="button"
              className={`chat-roster-chip${selected ? ' chat-roster-chip-selected' : ''}`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(member.id)}
              title={selected ? `${member.name} speaks next` : `Let ${member.name} speak next`}
            >
              {member.avatarUrl ? (
                <img className="chat-roster-chip-avatar" src={member.avatarUrl} alt="" />
              ) : (
                <span className="chat-roster-chip-avatar chat-roster-chip-avatar-fallback" aria-hidden>
                  {member.name.charAt(0).toUpperCase() || '?'}
                </span>
              )}
              <span className="chat-roster-chip-name">{member.name}</span>
            </button>
          );
        })}
      </div>
      <span className="chat-roster-bar-hint text-muted">speaks next</span>
    </div>
  );
}
