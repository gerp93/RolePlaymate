export interface StyleReminderInput {
  charName: string;
  personaName: string;
  concise: boolean;
  pov: 'first' | 'third' | null;
  /** The other characters in a group conversation; empty or absent for a one-character chat. */
  otherCharacters?: string[];
}

/**
 * Reply guidance appended to the END of the prompt (the last user turn), not placed in the
 * system prompt. A local 12B model imitates the recent transcript far more than a rule thousands
 * of tokens above it, so long third-person history beat a system-prompt "write in first person"
 * every time. It is code-built rather than a stored prompt template for the same reason redo
 * needs it: templates are versioned in the database (existing installs never pick up changed
 * defaults), and it is rebuilt on every generation, including redo, so flipping a Chat Settings
 * toggle and redoing actually shows the difference.
 */
export function buildStyleReminder({
  charName,
  personaName,
  concise,
  pov,
  otherCharacters = [],
}: StyleReminderInput): string {
  const lines = [
    `Formatting: put ${charName}'s actions, thoughts, and narration in single asterisks, like *this*. Put every line ${charName} says aloud in double quotes wrapped in double asterisks, like **"this"**. Always close every asterisk pair.`,
  ];

  // In a group the history labels every line "Name: text", and a model will copy that habit or
  // carry on for the next speaker unless told otherwise right where it's about to write.
  if (otherCharacters.length > 0) {
    lines.push(
      `Group scene: reply only as ${charName}. Do not write lines, actions, or thoughts for ${otherCharacters.join(', ')}, or for ${personaName}, and do not begin the reply with a "${charName}:" label.`
    );
  }

  if (concise) {
    lines.push(
      `Length: keep this reply SHORT -- 2 to 4 sentences (about 50 words) in one paragraph: one brief action or thought, then a line or two of dialogue. Earlier replies in this chat ran far too long; do not match their length. Ask at most one question, and only if it fits.`
    );
  }

  // Telling the model how to BEGIN is what makes this stick: once the first words are in the
  // right person it carries on, but it copies the third-person openings already in the history
  // otherwise. No example sentences -- a concrete one gets copied word for word.
  if (pov === 'first') {
    lines.push(
      `Point of view: FIRST person. Write ${charName}'s actions, thoughts, and narration as "I" / "my", and address ${personaName} as "you". Begin the reply with *I. Never use "${charName}", "she", or "her" for ${charName} outside of speech.`
    );
  } else if (pov === 'third') {
    lines.push(
      `Point of view: THIRD person. Narrate ${charName}'s actions as "${charName}" / "she" / "her", while ${charName}'s spoken dialogue and inner thoughts stay in ${charName}'s own first-person voice. Begin the reply with *${charName}.`
    );
  }

  return [
    `[Reply guidance for ${charName} -- follow it, but never mention or quote it:`,
    ...lines.map((line) => `- ${line}`),
    ']',
  ].join('\n');
}
