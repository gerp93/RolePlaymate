import { OverusedPhrases, describeOverused } from './phraseGuard';

export interface StyleReminderInput {
  charName: string;
  personaName: string;
  concise: boolean;
  pov: 'first' | 'third' | null;
  /** The other characters in a group conversation; empty or absent for a one-character chat. */
  otherCharacters?: string[];
  /** The user's per-message directions for this reply, if any -- repeated here, at the end, because
   * the copy in the system prompt sits above the whole transcript and a 12B model largely ignores
   * it there. */
  directions?: string;
  /** True when the system prompt carries a memory section this turn. */
  hasMemories?: boolean;
  /** Wording this character has been leaning on in their recent replies (see phraseGuard). */
  avoid?: OverusedPhrases;
  /** The chat's scene note: where the story is now, until the user changes it. */
  sceneNote?: string | null;
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
  directions,
  hasMemories = false,
  avoid,
  sceneNote,
}: StyleReminderInput): string {
  const lines: string[] = [];

  // First, and worded as binding: the user wrote this for exactly this reply, so it outranks the
  // standing style rules below it.
  const direction = directions?.trim();
  if (direction) {
    lines.push(`Direction for this reply (the user wants this to happen -- do it): ${direction}`);
  }

  // Where the story is right now, as the user last set it. The scenario text in the system prompt
  // is the starting setup and cannot follow the story around; this can, and it sits at the end
  // where it outweighs the habit of the transcript.
  const scene = sceneNote?.trim();
  if (scene) {
    lines.push(`Current scene (in effect until the story moves on -- stay in it): ${scene}`);
  }

  // Memories are retrieved by similarity, so some come from scenes the story has since left. A
  // rule up in the system prompt loses to the transcript; here, at the end, it holds.
  if (hasMemories) {
    lines.push(
      `Scene continuity: the memories in the system prompt are past events, some from other places or moments. The recent conversation above is the present -- stay in the location, situation and activity it shows, react to what was just said and done, and never jump back to a memory's setting or repeat it. Use a memory only if it fits the scene right now.`
    );
  }

  // Quoted back to the model, at the end where it holds: a rule above thousands of tokens of history
  // loses to the habit it is imitating from that history.
  const variety = describeOverused(avoid);
  if (variety) lines.push(variety);

  lines.push(
    `Formatting: put ${charName}'s actions, thoughts, and narration in single asterisks, like *this*. Put every line ${charName} says aloud in double quotes wrapped in double asterisks, like **"this"**. Always close every asterisk pair.`
  );

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

/**
 * The final user-role turn of a continuation -- a character taking another turn with no reply from
 * the user. Without it the request ends on the character's own last reply, and the model is being
 * asked for a second assistant turn straight after its first: it tends to restate that reply, and
 * after several of them starts writing the user's side. A real turn to answer ends that, and says
 * outright what a continuation is for. The reply guidance (and any directions) is appended to it
 * like any other last user turn.
 */
export function buildContinuationCue(charName: string, personaName: string): string {
  return (
    `[${personaName} has not replied. Continue the scene as ${charName}: ${charName} speaks or acts again, on their own. ` +
    `Move things forward with something NEW -- a new action, new information, or a change in the situation. ` +
    `Do not repeat, restate, or rephrase anything ${charName} has already said or done in the lines above, ` +
    `and do not write anything for ${personaName}. Never mention or quote this note.]`
  );
}
