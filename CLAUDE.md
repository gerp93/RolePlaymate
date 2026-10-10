# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working
with code in this repository.

## What this is

RolePlaymate is an Electron desktop app: a character-writing notepad where
AI chatbot characters are made of individually editable, versionable fields
(personality, scenario, opening greeting), plus a portrait image. The library
half is a plain versioning tool, modeled on
[TrackDraft](https://github.com/gerp93/TrackDraft)'s song/part/version split
applied to character cards instead of lyrics. Roleplay chat is being added on
top of it (see "Chat" below); it talks to a **local** Ollama server, so the app
still ships no model and makes no network calls of its own, and the library
stays fully usable with Ollama absent. Data is stored locally in a
SQLite file (WAL mode, foreign keys enforced) that the user can optionally
encrypt as a whole (see "App encryption" below).

The driver is `better-sqlite3-multiple-ciphers` -- chosen over `node:sqlite`
because node's built-in has no cipher support. Its N-API prebuilds for
win/mac/linux ship in the package, so there is **no `electron-rebuild` step**;
the only packaging requirement is the `asarUnpack` entry for its `prebuilds/`
folder in `package.json`. Every service imports `DatabaseSync` from
`database/sqlite.ts`, the one place the driver is named (the type keeps the old
driver's name so the services didn't change). Writes go straight
to disk; there is no "save the database" step (the old `sql.js` build had to
re-serialize the whole file on every mutation). Multi-statement writes go
through `transaction()` in `database/schema.ts`, which is re-entrant because
some read paths write (`getVersionsByField` self-heals the active-version
invariant). Because WAL keeps recent commits in a `-wal` sidecar, anything that
copies the database file must close it first -- see `dbLocation.setDbPath`.

## Commands

```bash
npm install
npm run dev        # renderer (Vite) + electron main, concurrently
npm run build       # build:renderer + build:electron
npm run typecheck    # tsc --noEmit for both renderer and main
npm test             # node:test over src/shared and src/main/**/*.test.ts (compiled to dist-test/)
npm run package      # electron-builder, produces installers in release/
```

## Architecture

- `src/main/` — Electron main process: `main.ts` (window, IPC handlers,
  auto-updater wiring), `database/` (SQLite schema + per-entity services),
  `chat/` (prompt composition, Ollama and Chatterbox HTTP clients; see below), `dbLocation.ts` (relocatable SQLite
  file, always inside `RolePlaymate_Data/`; see "Data folder layout"),
  `images.ts` (native file picker for portraits, copies into the `images/`
  folder beside the database).
- `src/renderer/` — React UI (Vite), `pages/` for routed screens,
  `components/` for the character/field editor pieces, `utils/themes.ts` for
  the VisualAssault theme switcher.
- `src/shared/` — types and pure utilities (version diffing) used by both
  processes.

Data model mirrors TrackDraft's Song/Part/PartVersion split: a `Character`
is like a `Song` (name + portrait are plain fields, not versioned); each of
its three `CharacterField`s (personality/scenario/greeting) is like a `Part`
-- independently versioned via `CharacterFieldVersion`, with its own history,
active-version marker, and word-level diff view. Unlike TrackDraft's freely
add/remove/reorder-able parts, a character's three fields are fixed and
auto-created alongside the character itself.

`src/renderer/themes.css` is vendored from
[VisualAssault](https://github.com/gerp93/VisualAssault)
`packages/css/themes.css` at a pinned tag — re-run
`scripts/update-visual-assault-css.sh <tag>` to bump it, never hand-edit.

## Chat (in progress)

Roleplay chat is being ported from
[gerp93/KVGenius](https://github.com/gerp93/KVGenius)'s refactor branch, where
it was reduced to a thin HTTP client against a local **Ollama** server. Image
generation stays in KVGenius -- different models, different server.

`src/main/chat/promptBuilder.ts` composes the system prompt from each
character's **currently active** field version, so switching a field's active
version changes the next reply. Sections are joined by a blank line and each is
skipped when blank: character (name/description/personality/scenario/example
dialogue) -> character instructions -> persona (only when the persona has BOTH
a name and a background) -> retrieved memories -> per-turn directions. The
greeting is deliberately *not* in the system prompt; it seeds the conversation
as its first assistant message. The scenario section's text is no longer a
character field -- see "Scenarios" below.

Per-message **directions** are in the system prompt (that last section) *and* repeated at the
very end of the request, first in the `styleReminder.ts` block appended to the last user turn
(or, for a Continue, which has no user turn, to the system prompt's end). The system-prompt
copy alone was ignored: a 12B model imitates the recent transcript far more than a section
above thousands of tokens of history. `PendingTurn.directions` carries them so a redo repeats
them, and a restart recovers them from the stored user message.

`{{char}}`/`{{user}}` macros in field content are substituted before the text
reaches a model -- `{{user}}` resolves to the selected persona's name, or
"User" when none is selected.

`chat/ollamaClient.ts` is a thin `fetch` client against the Ollama HTTP API --
no dependency, no model in-process. It streams `/api/chat` (the source never
did) and keeps a non-streaming path for the short internal calls where partial
output is useless. Settings stores the Ollama HTTP URL only. Start / Stop /
unload live in the sibling **Hardpoint** app (Tuning → Hardpoint embeds it);
RolePlaymate does not auto-start Ollama on launch. `chat/chatSession.ts` holds per-conversation
state in a Map; the source used module globals, which is why it could only ever
have one live conversation.

**Chat is the only feature that pushes to the renderer.** Everything else is
`ipcRenderer.invoke` request/response. `chat:send` returns a `streamId`
immediately and tokens follow on a single `chat:stream` channel carrying a
discriminated union (`token` | `done` | `error` | `cancelled`) -- one listener,
one switch, one cleanup path. `preload.ts`'s `onStream` returns an unsubscribe
closure; call it on effect teardown or every remount leaks a listener. Exactly
one terminal event is always emitted, including when generation throws: the
source left its generating flag set on an exception, which stuck the UI with no
way out but a restart.

Errors are never persisted as assistant turns. The user's message is written
before generation (so a crash can't lose it), the reply only on success -- the
source wrote its error text into the transcript, poisoning the context of every
later turn.

Each reply's wall-clock generation time is stored twice: once on its
`message_variants` row (shown in the transcript's hover info next to the
model name, gone if that message is deleted) and once as a standalone row in
`generation_stats` (model + duration only, no message/conversation reference
at all). The Model Tuning page's "Avg response time"/"Replies" columns read
only the latter, so deleting a message, deleting a whole conversation, or
letting retention clear old chats never shrinks that history -- only the
reply text and its FK-linked rows are deletable; the timing metric survives
on purpose. The composer's Stop button shows a live-ticking elapsed time
while `isGenerating` is true, covering both the pre-first-token wait and the
rest of the stream.

## Spoken replies (Chatterbox)

Optional, same pattern as Ollama: a thin `fetch` client
(`chat/chatterboxClient.ts`) against a **local** Chatterbox TTS server
(https://github.com/devnen/Chatterbox-TTS-Server, default
`http://localhost:8004`). The app ships no voice model. Chat and the library
stay fully usable when Chatterbox is absent -- a down server is silent, never a
failed turn. Settings stores the Chatterbox HTTP URL (and voice pickers). Start /
Stop live in **Hardpoint** (Tuning → Hardpoint); RolePlaymate does not auto-start
Chatterbox on launch.

A character stores an optional `ttsVoice` (mode `predefined` | `clone` plus a
filename). `predefined` is a stock file in Chatterbox's `voices/` folder;
`clone` is a reference clip in `reference_audio/`. Settings lists custom voices
and Chatterbox's stock voices in two expansion panels. Custom clips can be
imported and deleted through Chatterbox's HTTP API (`POST /upload_reference`,
`DELETE /delete_reference`) so the user never has to open Chatterbox's own
UI; WAV/MP3 only (not MP4). Import requires a voice name (stored in
`app-config.json`, shown in pickers; the file on disk is that name plus the
source extension). Settings can also open Chatterbox's `reference_audio`
folder. Stock voices are preview-only here and are not deleted from here.
Settings also stores an optional narrator voice in `app-config.json`; chat uses the
character or persona voice if set, otherwise the narrator. Chat Settings (right
sidebar) has independent tracks for character replies and persona (user) lines: Off,
Auto, or Manual, each with Character/Persona vs Narrator vs split
italics. Chat Settings also has Interrupt vs Queue for new speech when at least
one track is not Off: only one clip plays at a time; Interrupt cuts the current
clip when the next line is ready, Queue waits until it finishes. Queue mode
shows Skip dialogue next to Directions only while a clip is generating or
playing -- it drops the current clip and starts the next. Clicking Play on a
message always cuts in. Same-voice lines stay one Chatterbox request; split queues clips
and prefetches the next while the current one plays. Persona Auto
queues ahead of the character reply. Play/pause, the equalizer, a generate
button (Speak), and a spinner while synthesizing live on each
message's footer tray. The WAV is stored beside the database (`tts/`, path
on `messages` / `message_variants`); later Play reads that file instead of
calling Chatterbox. Track modes are localStorage toggles (Off / Auto /
Manual), not a chat error path.

## Scenarios

A settings/situations list owned 1-to-N by either a character or a
[Group](#groups) -- never both, enforced by a `CHECK` on `scenarios`
(`character_id`/`group_id`, exactly one non-null) -- not shared many-to-many
like world lorebooks, each independently versioned and independently
hideable via the same PIN-lock as characters/personas/lorebooks. Split out
from what used to be two fixed, single-slot `CharacterField`s (`scenario`
and `greeting`) so a character's permanent traits (personality/dialogue)
never have to be duplicated onto a new character just to give it a different
setting. `FieldType` no longer includes either; an existing character's old
scenario/greeting text is migrated on first startup after upgrade into a
"Default" Scenario (`migrateCharacterScenarioFieldToScenarios`/
`migrateCharacterGreetingFieldToScenarios` in `schema.ts`, the latter
reusing the former's scenario when one was already created for that
character) -- the old `character_fields` rows are left in place, unused.
`scenarios.character_id` was `NOT NULL` before groups existed;
`migrateScenariosToNullableOwner` rebuilds the table on first startup after
upgrade (SQLite can't relax `NOT NULL` in place), with foreign keys
deliberately toggled off around the rebuild -- they'd otherwise cascade-drop
every version/greeting/image the moment the old table is dropped -- and a
`PRAGMA foreign_key_check` after it, so a bad rebuild fails loudly instead of
silently orphaning rows.

A scenario carries **two** independently versioned texts -- its descriptive
content (`scenario_versions`) and its own opening greeting
(`scenario_greeting_versions`), same self-healing "active tracks latest"
model as character fields, just two tables instead of one shared by a
`field_type` column (see `ScenarioService`, which runs both through one
generic version-CRUD engine parameterized on table name). A conversation
picks at most one Scenario (`conversations.scenario_id`, nullable -- no
scenario behaves exactly like a character with none, including no opening
greeting: greeting only ever comes from a selected scenario now). Both
texts are resolved by `ChatSessionManager`/`conversations:create`
internally from the conversation row or the create request wherever needed,
and fed into `buildSystemPrompt` as `scenarioContent`/`scenarioGreeting`
rather than pulled from a character field. The scenario itself is swappable
mid-conversation, same as persona; greeting only ever applies at conversation
start (it seeds the first message, not the system prompt), so switching
scenarios later never retroactively injects a new greeting.

Each scenario has its own 0-to-many image gallery (`scenario_images`, mirrors
`character_images`). While a scenario is selected, its images join --
never replace -- the character's own in that conversation's image picker; if
the scenario has a cover image, it becomes that conversation's default
portrait (`conversationService.setConversationScenario` seeds
`character_image_mode`/`scenario_image_id` from it). `character_image_id` and
`scenario_image_id` pin the same portrait slot and are mutually exclusive --
picking one clears the other.

## Groups

A named ensemble of 2-6 characters (`MIN_GROUP_CHARACTERS`/
`MAX_GROUP_CHARACTERS` in `shared/types/group.ts`) that chat together -- a
peer of Character, not a conversation setting: its own row
(`character_groups`), its own hide flag, and its own [Scenarios](#scenarios)
(group-owned, via `scenario_id`'s sibling `group_id`). `GroupService`
mirrors `CharacterService`'s shape (create/update/setHidden/delete). The
roster (`character_group_members`, many-to-many with `position` for display
and greeting order) is **live**, not a snapshot: editing it changes every
conversation started from that group immediately, and past transcript lines
keep whichever speaker they were written with regardless of later roster
edits. A `conversations` row is either a character's (`character_id`) or a
group's (`group_id`), never both; `messages.speaker_character_id` plus a
snapshotted `speaker_name` records who spoke an assistant line in a group
conversation (`speaker_name` is what keeps an old line labeled after that
character is deleted -- `speaker_character_id` goes `NULL` via `ON DELETE
SET NULL`, `speaker_name` doesn't).

Ollama only has `user`/`assistant` roles, so a group turn is built per
*speaker*: `chat/groupHistory.ts`'s `buildGroupHistory` walks the stored
transcript and turns it into that one character's view -- their own past
lines are `assistant`, everyone else's (the persona's and every other
character's) are `user`, prefixed `Name: ` and merged when two land back to
back (most chat templates expect strict alternation). This is why a group
conversation's prompt is never built from `ChatSession.history`, the flat
per-conversation cache every solo chat uses -- `ChatSessionManager` rebuilds
it fresh from the database on every group turn instead
(`getGroupHistory`/`getGroupTurn`). A redo has to replay the *exact* messages
that turn was first sent, so `PendingTurn.replayMessages` snapshots them
rather than trusting a rebuild to reproduce the same merge after the
conversation has moved on; `reconstructGroupPending` covers the same case
after an app restart, approximating what it can't recover (per-turn
directions, retrieved memories, lore) the same way `reconstructPending`
already does for solo chats.

`PromptBuilder` takes an optional `group: GroupPromptContext` (name,
instructions, the *other* roster members with their descriptions --
`{{char}}` resolves to whichever character is speaking, so a shared
scenario's text should use names rather than assume one fixed speaker). When
present it inserts a `[GROUP CHAT]` section (new `groupContext` prompt
template) right after the character/scenario block and before the behaviour
rules, and extends `buildStopPhrases` with `\nName:` for every other member
-- otherwise a local model happily keeps writing the next character's line
for them. `buildStyleReminder` gets the same "don't write for Alice, Bram,
or the persona" nudge appended per turn, since that's rebuilt fresh on every
generation (including redo) and templates are stored/versioned so an
existing install won't just start seeing new default wording. A model still
sometimes opens a reply with its own `"Name: "` label anyway (it just read
that convention off the transcript) -- `stripSelfLabel` strips that one
narrow pattern (plain or markdown-emphasis-wrapped, only at the very start)
before the reply is saved, applied to the raw model output *before*
`finalizeReply`'s markdown formatting, or `"Bram:"` becomes `"*Bram:*"`
first and no longer matches.

Two smaller consequences of "several characters, one conversation": lore is
still scanned per current *speaker* (`getEntriesForCharacter(speakerId)`),
so a personal lorebook only ever reaches its own owner even mid-group, same
guarantee as solo chat; and `conversationService.appendMessage`'s durable
`characters.message_count` counter credits the line's speaker in a group
conversation rather than the conversation's (nonexistent) owning character.

There is deliberately no saved-vs-quick-group distinction yet (see the
group-chat plan this section was written from) -- every group today is a
deliberate library entry created from the Groups page, picked from the same
start-screen slot a character is (a Character/Group radio above the dropdown
swaps which alphabetized list it shows; switching clears the pick). The chat page tracks a group
conversation's *next speaker* as ordinary `characterId` state -- advanced
round-robin around the roster after each reply (`Chat.tsx`'s group-turn
effect) -- so `chat:send`/`chat:continue`'s existing one-speaker-at-a-time
IPC shape needed no changes; `GroupRosterBar` lets the user override that
pick before sending.

### Respond as (guest speakers)

A one-character conversation can hand a single reply to another library character: the composer's
"Respond as" picker (not shown in a group, whose roster bar already does this) sets `characterId`
on that one `chat:send`/`chat:continue`, then resets. "Quick character..." creates a real library
character (name + one-line description) and selects it -- the description is all the other
speakers see of them, since a speaker only gets their *own* full card. It is created with
`is_quick = 1`, which changes one thing: the Characters page lists it in a collapsed "Quick
characters" group instead of the main grid, with a Promote button (`characters:promoteQuick`) that
clears the flag. Editing one does not promote it, and it stays pickable everywhere else.

There is **no stored roster**. `ChatSessionManager.getGuestScene` derives an implicit scene from
the transcript: the conversation's own character plus every distinct guest with an assistant line
in it (`isGuestLine`). While nobody but the owner has spoken, `getGroupTurn` returns null and the
chat is byte-for-byte the plain solo path. Once a guest has spoken -- or is about to -- *every*
turn, the owner's included, takes the group path: labelled per-speaker history, the `[GROUP
CHAT]` section (named "<owner>'s scene"), other-speaker stop phrases. The owner must get it too,
or `finalizePending`'s flat history would fold the guest's line in as the owner's own. Deleting
every guest line returns the conversation to plain solo (`deleteMessage` drops the session).

Replies written before any guest spoke (and the greeting) recorded no speaker, so
`buildGroupHistory` takes a `defaultSpeaker` -- the owner -- for lines with *neither* id nor name.
A guest whose character was later deleted has a name but no id and stays theirs, not the
owner's. `getSession`/`reconstructGroupPending` use the same test on a cold start, and
`appendMessage` credits a recorded speaker's `message_count` before falling back to the owner.
`assertHiddenContentAccessible` refuses a conversation with a hidden guest while locked, like a
group's hidden member.

The "Respond as" picker sits between the transcript and the composer, under the "Continue as"
links and above the composer's divider, and resets after each send. Under the last message,
"Continue as <owner>" stays as it always was and gains a second link for whoever the picker
currently holds (`continueOptions` in `Chat.tsx`; `handleContinue` takes an optional speaker that
beats the picker).

**Continue.** A continuation used to send the model a conversation that *ended on its own
previous reply* -- a second assistant turn straight after the first, with the reply guidance glued
to the end of the system prompt. It restated that reply, and the more continues in a row the likelier
it was to start writing the user's side. Now `continueAsCharacter` (and a redo of one) always ends on
a user-role note (`buildContinuationCue`: "<persona> has not replied. Continue the scene as <char>...
something NEW... do not repeat, restate, or rephrase... do not write anything for <persona>") with
the reply guidance and any directions appended to it, and `mergeAdjacentTurns` folds back-to-back
same-role messages into one turn so what the model sees strictly alternates. The stored transcript is
untouched -- five continues are still five messages. Solo chats only reconstruct a redoable reply after
a restart when it directly follows a user message, so a continue chain is not redoable after one.

**Directions only.** Send works with directions and no message: an empty message takes the Continue
path with `recordDirections`, which stores a **directions-only user line** (`isDirectionsOnly`:
role `user`, empty content, directions set) so the turn shows in the transcript. Such a line is never
part of what a model is shown (`buildGroupHistory`, `getSession` skip it; a redo of its reply is a
continuation, and after a restart its directions are read back from the row), and replying to one
means acting on its directions. The built-in "continue on your own" nudge is never recorded.

**A user message with no reply** (the reply was deleted, or generation failed) can be edited in place
(`editUnansweredUserMessage`; a directions-only line may keep empty text while it has directions) and
answered with "Reply as <name>" under it, or Send with directions only. `generate` takes
`replyToMessageId`: the stored row is the turn's user line, so it is neither inserted a second time
nor left in the flat history (the cache is rebuilt from the transcript, so it ends with that very
message and is popped).

## Scene note

A scenario's text is the story's starting setup and cannot follow the characters when they move on; the greeting is
only the first message. So each conversation has an optional **scene note** (`conversations.scene_note`, at most
`FIELD_LIMITS.sceneNote` chars): where the story is now, a sentence or two, edited in the Settings tab's Scene section.
It is added to the code-built end-of-prompt reminder (`buildStyleReminder`'s `sceneNote`, "Current scene ... stay in it")
and to the persona-drafting prompt, and is read fresh from the row on every generation (`sceneNoteFor`), so a redo after
editing it uses the new text. It is not a template, for the usual reason (stored templates never pick up changed
defaults). A branch copies it; a duplicate ("new chat, no transcript") does not.

After a reply, `ChatSessionManager.checkScene` (fire and forget) can **propose** a new note: every `SCENE_CHECK_EVERY`-th
assistant reply it sends the last 4 lines and the current note to the side-task model (the extraction model, falling back
to the chat model -- `sideTaskModel`, shared with extraction) and asks for `SAME` or one sentence. `parseSceneSuggestion`
drops SAME, anything too short, and anything whose word overlap with the current note or the last suggestion offered is
>= 0.6, so a restatement is never asked about twice. The answer is pushed on `chat:scene-suggestion` and only shown while it
still belongs to the latest reply; the renderer shows an editable banner above the composer (Update / Not now), never a
blocking dialog. App-wide off switch in the Scene section (`sceneSuggestions` in `app-config.json`, default on). It is a
second model call competing with the next reply for the GPU, which is why it is throttled and why the extraction model
setting matters. **Automated runs and speed tests pass `suggestScene: false`** (no one to answer, and it would add a call to
every timing); the scene note itself still applies to a run, and its Scene section is locked while one is going.

## Memories

Facts extracted from a conversation and carried into later turns, so continuity survives the
sliding history window without resending the transcript.

Retrieval is **semantic**, not keyword like lore: extracted memories are paraphrases with no
fixed vocabulary, so "she distrusts the dock authority" has to surface when the user asks
about "the harbour officials". `chat/memoryRetrieval.ts` embeds via Ollama's `/api/embed`,
which replaces KVGenius's local sentence-transformer -- and with it the torch dependency and
the Blackwell/sm_120 SDPA workaround that file had to carry. Vectors are cached as float32
BLOBs on the memory row (`embedding` / `embedding_model`), so a settled conversation costs
one embed call per turn rather than one per memory; a vector whose model doesn't match is
recomputed rather than compared across embedding spaces. When embedding fails -- no Ollama,
no embedding model pulled -- retrieval degrades to pinned-only rather than failing the turn.

`source = 'manual'` means **pinned**: always injected, bypassing both the score threshold and
the token budget (which may go negative as a result), and still counting toward `topK`. All
three are ported deliberately, not accidents.

`chat/memoryExtraction.ts` mines each completed exchange. It runs **after** the reply has
been delivered and is not awaited -- the source ran it inline, adding a second to every turn
before the user saw anything. Results arrive on `chat:memories-updated`. Candidates are
filtered by Jaccard similarity against stored memories, against each other (the source only
checked the former, so one extraction could insert two phrasings of the same event), by
overlap with the system prompt, and by a generic-phrase blocklist.

Memories compete with the live transcript for a small model's attention, so three things keep a
stale one from dragging a scene back: retrieval embeds the last few lines plus the outgoing message
(`buildMemoryQuery`), not the message alone (a bare "*nods*" matches whatever is vaguely similar,
from any earlier scene); `topK` is 6; and whenever memories are in the prompt the code-built
style reminder at the very end says the recent conversation is the present and memories are past
events (`hasMemories` in `buildStyleReminder`). That last rule is code, not a prompt template, for the
same reason the other reply guidance is: templates are versioned in the database and an existing
install never picks up a changed default. The extractor is told to skip momentary state (positions,
what someone is doing or waiting for, sounds, scenery), which is true for one beat and wrong after.

Two more memory guards, from a run where "Cormac is taking a closer look at the evidence" was injected on 40 of 100 turns and
"fear and urgency are evident in her demeanor" on 25: `whyUnfit` now rejects what someone is in the middle of doing (only
when the person is the sentence's subject at its start -- "She believes someone at the Bureau is watching her" is a fact)
and "evident / demeanor / body language" commentary; and `selectMemories` leaves out any memory already injected in
`RECENT_USE_LIMIT` (5) of the last 10 turns, founding memories included, because the gentle score penalty cannot stop a fact
that matches everything. Memories stored before the filters were this strict stay in the list but are not injected
(`retrieve` skips auto memories that `whyUnfit` rejects).

Extraction quality has four layers, added after a 100-turn automated run produced 234 memories that were
mostly paraphrases of the scene's mood ("The atmosphere is one of tender, loving intimacy"), which
retrieval then ranked as the most relevant memories to that same scene: the prompt rules above; text filters
(`GENERIC_PHRASES` now rejects mood/play-by-play openers, and a last bullet cut off by the token cap is dropped
rather than stored mid-sentence); a **semantic** duplicate check at write time (`pickSemanticallyNew`: a candidate
within cosine 0.85 of a stored memory or an earlier candidate is dropped -- word overlap misses paraphrases; skipped,
keeping everything, when embedding is unavailable); and an optional **extraction model** (Settings -> Chat
Dependencies; `memoryExtractionModel` in `app-config.json`, default = the chat model). A roleplay tune is a poor
extractor, but a second model that does not fit in VRAM beside the chat model makes Ollama reload models every turn,
so it is opt-in with that warning.

A second pass, from reading a 100-turn run's log in full (all of it generic, nothing tied to one character):

- **Fit filter** (`whyUnfit`, `stripAnalyticTail`): a memory is read back later by the other speaker, so a "fact" in second
  person ("your touch shows..."), commentary on the scene ("underscores their mutual attraction"), a passing feeling or
  impulse, or scene upkeep ("the siren continues to blare") is rejected, and an explanatory tail (", indicating that...")
  is cut off, leaving the event. The extraction prompt asks for third-person events, decisions, revelations and open
  questions, and to keep specific names and identifiers.
- **Selection** (`selectMemories`): MMR (relevance 0.75) so near-paraphrases do not fill `topK`; a small penalty for a
  memory injected in each of the last 10 turns (`ChatSessionManager.memoryUseLog`, in memory only) so one fact does not sit
  in the prompt every turn; and about a third of the slots reserved for the oldest memories (the first ~15%, at least 8),
  because the founding facts of a story otherwise sink under newer, similar ones.
- Tested on pure functions only (`memoryRetrieval.test.ts`, `memoryExtraction.test.ts`); the thresholds were calibrated on
  one run, so expect to revisit them.

## Repetition guard

`chat/phraseGuard.ts` (pure, no model) finds what the repetition guard in automation cannot: new sentences built from the
same stock phrases. `findOverusedPhrases` takes the speaker's last 12 replies and returns 3-7-word runs (at least two
content words) that appear in 3 or more of them, minus phrases the other speakers use too (that is the scene's
vocabulary), plus repeated opening words. The style reminder (`buildStyleReminder`, `avoid`) then quotes them at the very
end of the prompt, and the persona-reply drafter does the same in its own prompt. Sampling backs this up: new optional
sampler params `minP`, `repeatLastN`, `frequencyPenalty`, `presencePenalty` (defaults set in `DEFAULT_SAMPLERS`, editable
per model like the others; the allowed keys are `TunableSamplerKey`). The defaults are reasoned, not tuned.

`isStalled` measures how much of each recent line is new vocabulary (threshold `STALL_NOVELTY`, calibrated on one run);
when the scene is going in circles, the persona drafter is also told to change something (`STALL_NUDGE`).

Persona drafts sometimes ran on into the other character's turn (a trailing "Veridia: *"). `suggestPersonaReply` now sends
stop sequences for the other speakers and `cutOffOtherSpeakers` trims whatever slips through.

## Run-quality report

`chat/runQuality.ts` (`renderQualityReport`) is a section of the automated-run Markdown export, between Settings and
Prompt setup. From the log alone it reports reply stats, stock phrases and repeated openings, stall points, opening
threads that never came back, who takes the initiative, memory health (pool growth, memories injected every turn, share
that fail the fit filter, whether founding memories reached the prompt) and whether the character card's example dialogue is
a placeholder. It is a reading aid; it changes nothing about a run.

## Automated runs

The chat sidebar's **Automate** tab plays both sides of the open one-character conversation for N
turns (1-100) and keeps a diagnostic log. A turn is the persona's line, drafted by
`ChatSessionManager.suggestReply` (the composer's "Suggest reply"), then sent through
`ChatSessionManager.generate` (what `chat:send` calls). `chat/automationRunner.ts` adds nothing to
those paths -- it only calls them from the main process, so the conversation is an ordinary one:
memories extract and retrieve, lore fires, redo/edit/delete work on it afterwards, and a Stop leaves
at worst a persona line with no reply (the chat's existing "Reply as ..." covers that; the next run
also answers it first). Two things guard a long run. **Repetition:** a persona line or a reply whose word-set overlap with
the last 6 messages is >= 0.8 (and >= 6 words) is redone up to twice -- the persona line with a "you repeated
something, write something different" note and a higher repeat penalty, the reply through the normal redo path run
hotter; three consecutive turns still repeating end the run ("stopped", with the reason in the log). It is
automation-only, not applied to normal chat. **Truncation:** the persona-drafting call is capped at 150 tokens and
used to send the fragment as the persona's line; `trimToCompleteSentence` (plain string handling, no model) now cuts
a draft back to its last complete sentence and closes a dangling `*` or `"`. The Automate tab also takes optional
"what the persona is steering toward" directions, added to the persona-drafting prompt only. The first turn's system
prompt (the character card as given) is kept in the log and shown up front in the Markdown export.

**Progress footer.** `RunProgressFooter` (rendered by `Layout` under `<main>`) is a flex item, not an overlay, so the page above
gets shorter: while a speed test (`useSpeedTestRunning`) or an automated run (`useAutomation`) is going it shows the label,
"turn N of M" / "model N of M (name)", a bar and percent, and a View link (`/model-tuning?tab=speed`, which Model Tuning reads
to open its Speed test tab, or `/chat/<id>`; hidden when already there). It is absent when nothing runs. It deliberately shows
no character or persona names, so a run of a hidden character does not leak them while the PIN is locked. A speed test takes
priority over the per-model run it is driving.

### Speed tests

Model Tuning -> **Speed test** compares models on this PC without anyone chatting. `startBenchmark` runs the
same short automated chat once per ticked model, sequentially, each in a **fresh conversation** (created through
`createConversationWithGreeting`, the same function the chat's start screen uses, so the greeting and scenario
resolve identically) so no model inherits another's context. After each model it deletes that conversation (unless
"keep" is ticked) and asks Ollama to **unload the model**, so the next one is timed from a cold start with the GPU
to itself. Each model's run is an ordinary `automation_runs` row carrying `benchmark_id`; those are kept out of
`listRuns` (the Settings and Automate-tab lists), and the summary lives in `automation_benchmarks`.

**Chat is paused while a speed test runs**: `assertNoSpeedTest` makes the main process refuse chat sends, redos, edits that
regenerate, continues, reply suggestions and speech (`tts:speak`) in *every* conversation until the test finishes or is stopped,
so nothing else competes for the GPU (the runner writes its own conversations directly, not through those handlers). The chat
page shows the same overlay as an automated run over the composer, worded for the speed test with the whole-test progress and a
Stop button (`useSpeedTestRunning`). Only a speed test pauses other chats; an ordinary automated run does not.

What makes the numbers usable: the user side is, by default, `SCRIPTED_LINES` -- generic lines that read
sensibly after any reply, identical and in the same order for every model (speed depends on tokens in and out, not
on the story, and a scene each model wrote itself would differ per model; it also skips the persona-drafting call).
The repetition guard is **off** (a redo would double a reply's time). Figures come from Ollama's own counters,
captured on every reply into `debug.timings` (`ReplyTimings`: total/load/prompt-eval/eval durations from the final
chunk, plus first-token time measured in `OllamaClient.chat`): **tokens/s = output tokens / eval time**, prompt
tok/s likewise, because wall time per reply mostly measures how long the reply happened to be. Only a turn with no
counters falls back to tokens over wall time, and the result is flagged approximate. `summariseModelRun` reports
**medians** (and p90) and drops the first reply as warm-up (its model load is shown separately as cold load),
when there are at least 3 turns. Not measured yet: GPU/CPU split (Ollama's `/api/ps`) and text-to-speech.

**Enforcing, not just asking (automation).** Quoting a character's worn-out phrases back to her (`describeOverused`) is
only a request, and a roleplay model ignores it often enough -- one 100-turn run had "take a deep breath" in 43% of
replies with the request in every prompt. So the runner also **redoes** a reply that uses a flagged phrase or opening
(`overusedHits`, against the same `findOverusedPhrases` list the reminder quotes), up to `MAX_REPEAT_RETRIES` shared with
the near-copy redo. A redo names what was reused (`retryAvoid` -> "Your previous attempt ... reused ...") and samples
harder (repeat penalty 1.25, `repeat_last_n` 512, frequency penalty 0.4, temperature up). A phrase still used after the
redos is only **logged** (`stockPhraseHits`, shown in the export), never a strike: the 3-strike stop stays reserved for
near-copies, or most runs would end early. Not done for normal chat: a redo there would have to replace text already
streamed to the screen (a new stream "reset" event), so that waits for evidence that redoing actually works.

**What counts as a repeat.** `isRepeat` is word-set overlap >= 0.8 *or* `repeatedSequenceShare` >= 0.4: the share of the
reply's 5-word sequences already used in the last 6 replies. Overlap misses a paraphrase loop that says the same things in
new words in the same order ("Your corruption ends now... no more secrets or lies from behind closed doors", ten times);
long shared sequences do not (0.43 to 0.89 on the looping replies of a real run, 20 of 99 replies >= 0.5).

**Who writes the persona's side.** The persona's lines are drafted by the same roleplay model, which writes fragments,
mixes person and walks off alone, and the character copies it. `AutomationStartRequest.personaModel` picks a different model
for the persona (the Ollama-swap caveat is shown in the panel), and `scriptedPersona` sends the generic
`SCRIPTED_LINES` instead, so only the character's behaviour is being tested.

One run at a time app-wide. Groups are not supported (their round-robin
speaker lives in the renderer).

While a run owns a conversation the renderer locks it (`canChat`) and the main process refuses
writes to it (`assertNotAutomating` in the chat handlers), so a typed message cannot interleave.
The run lives in the main process and survives leaving the chat page; `useAutomation` re-attaches on
mount via `automation:getActive` and `automation:progress`, and `useChatSession.syncFromStore`
reloads whatever a run wrote.

Logs are rows in `automation_runs` / `automation_run_turns`, not files, so they are covered by app
encryption and move with the data folder. Each finished turn is appended immediately (a crash keeps
everything before it; `markStaleRunsInterrupted` labels the leftover on next launch). `conversation_id`
is deliberately not a foreign key: the log outlives the conversation. Per turn it records the persona
line, the reply, and the debug payload (the exact prompt, retrieval scores for injected *and*
rejected memories, lore, tokens), with the bulky duplicates dropped. A run also records when each
memory was extracted and the memory list at the end. Runs of a hidden character, persona or scenario
are hidden from the list while the PIN is locked. **Export** (JSON or Markdown) writes a plain file
via a save dialog -- the one deliberate decrypted copy.

## Lorebooks

Reference material injected only when the conversation is about it, so a
large setting doesn't have to live in a character's fields and burn context
every turn. Not ported from KVGenius -- it never built one.

Two scopes share `lorebook_entries` but mean different things in the prompt.
**World** books are shared setting material, many-to-many with characters via
`character_lorebooks` *and*, separately, with personas via `persona_lorebooks`,
injected as common knowledge. **Personal** books hold one character's (or
persona's) private history, owned outright by that character/persona, injected
as things *that character* remembers and explicitly not common knowledge -- a
model told "the mutiny happened" as world fact lets anyone reference it,
whereas "you remember the mutiny" keeps it in the character's head. Personal
books refuse to be attached elsewhere, and are edited on the character/persona
page rather than beside the shared books, so private history never looks
attachable.

Character and persona world-book attachments are independent lists. A book
attached only to the persona reaches "Suggest reply" (`getEntriesForPersonaWithWorldBooks`)
but not the character's normal reply (`getEntriesForCharacter`) -- attach it to
both to give the character access too.

Entry text is versioned exactly like character fields, including the rule that
**active always tracks the latest version** -- there is no "activate an older
version". An earlier draft had one and it fought `ensureLatestIsActive`: the
lore scan (which reads `is_active` directly) honoured the manual switch while
the editor silently undid it. To make older text live again, save it as a new
version.

`chat/loreMatcher.ts` does keyword matching -- deterministic, free, and works
with Ollama absent. Keys match on **word boundaries**, not substrings ("Ash"
must not fire inside "ashamed"), and are regex-escaped since real keys contain
things like `Vance (captain)`. The scan window is the last few messages plus
the pending one. Budgeting mirrors the memory retriever: always-on first, then
priority, then reject-but-continue so a short entry still fits after a long one
is skipped. Rejected entries are reported, not dropped silently -- the debug
console's Lore section is the only practical way to answer "why didn't my entry
fire?", and it also shows the exact scan window.

Templates and stop phrases currently live as constants in
`chat/promptTemplates.ts`, and the Ollama host is still the
`localhost:11434` default; both move into `app-config.json` when the settings
layer lands. `chat:previewSystemPrompt` is a temporary IPC handler for
inspecting the assembled prompt without a model running -- remove it once the
debug console exists.

## App encryption and the hidden-items privacy screen

Two separate features with two separate secrets; don't conflate them.

**App encryption** is optional and **off by default**. The user turns it on in
Settings -> Security with a password (4-128 chars, longer recommended); there is
deliberately no flag anywhere saying it is on -- the database file is the source
of truth (`isDatabaseEncrypted` checks for the plain SQLite header), so the
app can decide whether to ask for a password before it has opened anything.
When on, the database is encrypted page-by-page by the driver (SQLCipher
compatible; the password goes through SQLCipher's own PBKDF2, so nothing about
the key lives outside the file) and the portrait and TTS files are encrypted
with AES-256-GCM under a random key stored *inside* the encrypted database
(`app_secrets`), so changing the password never re-encrypts files. A forgotten
password is unrecoverable by design: no escrow, no reset.

- `appEncryption.ts` enables, changes, and disables encryption in place. WAL
  cannot be rekeyed, so it drops to `journal_mode = DELETE` around each rekey.
  Enable encrypts the *files* before rekeying the database, so a crash leaves a
  state `initFileEncryption` and `readLibraryFile` both tolerate (mixed
  encrypted/plain files; a leftover key row on a plain DB means "finish turning
  it off").
- `fileCrypto.ts` owns the file format (`RPENC1` magic + IV + tag + ciphertext)
  and every read goes through `readLibraryFile`, which decrypts only when the
  magic is present. Anything that writes or copies into `images/` or `tts/`
  must call `protectLibraryFile` afterward, or new files land in plaintext.
  The `rpimage://` handler decrypts on the fly and implements `Range` itself
  (`<audio>` seeks with it).
- Launch gate: before `initDatabase`, `main.ts` checks `isDatabaseEncrypted`
  and, if so, shows `unlockWindow.ts` -- a standalone window with its own
  preload, since no services or IPC handlers exist yet. Nothing else (services,
  retention timer) starts until it resolves.
  `startupComplete` stops the unlock window closing from tripping
  `window-all-closed`.
- The app never keeps the password after unlock; "current password" checks open
  a throwaway second connection (`verifyPassword`).
- This protects data at rest only. Prompts still reach Ollama in plaintext, and
  Chatterbox's own `reference_audio/` folder is outside the app's control.

**Hidden items** (characters, personas, world books, scenarios) are a **privacy
screen only**: `is_hidden` plus a PIN, no cryptography. `SecurityService` is
just a scrypt-hashed PIN and an in-memory unlocked flag (reset every launch);
main-process handlers filter hidden rows while locked, and hiding/unhiding
requires the PIN to have been entered. The PIN is independent of the encryption
password and is seeded as `1234` on a fresh database. There is no PIN reset.

Older versions encrypted each hidden row's text under a PIN-derived key
(`v1:` ciphertext). `database/legacyHiddenDecrypt.ts` is the only code that
still knows that format: on first launch after upgrade it decrypts every such
value once, using the default PIN silently if that still matches, otherwise
asking for it, and records completion in SQLite's `user_version`. It leaves
values that merely start with `v1:` but don't authenticate alone. That module,
its call in `main.ts`, and the `key_salt` column are safe to delete once no
install can still hold the old format.

## Data folder layout

The database always lives in an app-named folder, `RolePlaymate_Data/`
(underscore; not bare `RolePlaymate`, which would nest a same-named folder
inside `userData`), at the default location and at any relocated one:
`<parent>/RolePlaymate_Data/roleplaymate.db`, with `images/` and `tts/` as its
siblings. Both are derived from the db file's directory (`getImagesDir`,
`getTtsDir`), so they follow it. This exists because two apps' databases
relocated into one shared folder (`P:\databases`) had their generic `images/`
folders resolve to the same directory and mix. The standard is written up in
KVG_Standards' `db-location-versioning.md` ("Data folder layout").

- **Settings -> Database Location** picks a parent *folder*;
  `dbPathInsideFolder` builds the nested path. "Use Existing File" still adopts
  whatever file it is pointed at as-is.
- **Old flat default install** (`userData/roleplaymate.db`):
  `migrateLegacyDefaultDbLocation` moves the db and its `-wal`/`-shm` into
  `userData/RolePlaymate_Data/` at startup, before anything reads the db path.
  It only renames, never overwrites (both files present -> leaves both), moves
  sidecars first, and rolls back and stops startup on failure rather than let
  a fresh empty db appear. Do not weaken any of that.
- **Existing portraits and clips are NOT moved.** Their rows hold absolute
  paths into `userData/images` and `userData/tts`, which stay valid.
  `getLegacyLibraryDir` makes those folders part of the library *while on the
  default location*: `getImageLibraryDirs`/`getTtsLibraryDirs` are what the
  `rpimage://` handler, path migrations, delete guards, and encrypt/decrypt
  passes consult. Anything new that touches library files must use those, not
  `getImagesDir`/`getTtsDir` alone -- the latter is only where new files are
  written. (Missing this for encryption would leave legacy files encrypted with
  no key after "disable".)
- **Installs relocated by hand are left alone** -- the user chose that path and
  its siblings may be shared with another app, so the app can't tell whose
  files are whose. They move over by choosing a parent folder: relocation
  copies only the files the database references (the path migrations do it at
  next launch), never a whole `images/` folder, so another app's files can't
  come along. The originals are left in place.
- `app-config.json` and `main.log` stay at the `userData` root: the config has
  to be findable before the db location is known.

## Release pipeline

Both `.github/workflows/auto-release.yml` (fires on every push to `main`)
and `cut-release.yml` (manual, explicit version) call
[`gerp93/KVG_Standards`](https://github.com/gerp93/KVG_Standards)'s
`release-electron.yml` reusable workflow, currently pinned `@main` (interim
exception — KVG_Standards has no tagged releases yet). To force a release
with no other code change, add a dated entry to `VERSION_BUMP.md` instead
of pushing an empty commit.

## Known gap

No `assets/logo.png` source mark exists yet, so `scripts/generate-icons.js`
is wired but inert, and the in-app logo `<img>` tags degrade gracefully
(hidden on load failure) rather than showing a broken image. See `TODO.md`.
This wasn't fabricated deliberately — see KVG_Standards' "Logo & branding"
checklist, which treats a placeholder mark as worse than none.

## Standards

This repo follows [gerp93/KVG_Standards](https://github.com/gerp93/KVG_Standards)
for theming, release/CI, self-update (via `electron-updater`, the
sanctioned Electron pattern), licensing, database location, release notes,
`VERSION_BUMP.md`, and `TODO.md` conventions. See that repo's `README.md`
and `REPO_SCOPE.md` for the current standards and this repo's scope against
them — don't assume this file has the full, current picture.
