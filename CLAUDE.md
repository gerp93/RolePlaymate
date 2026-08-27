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
`node:sqlite`-backed SQLite file (WAL mode, foreign keys enforced).

`node:sqlite` is a Node built-in, so there is no native module to rebuild and
nothing to unpack from the asar -- but it requires **Node >= 22.13, which means
Electron >= 35**. Don't drop the Electron major below that. Writes go straight
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
npm run package      # electron-builder, produces installers in release/
```

## Architecture

- `src/main/` — Electron main process: `main.ts` (window, IPC handlers,
  auto-updater wiring), `database/` (`node:sqlite` schema + per-entity services),
  `chat/` (prompt composition; see below), `dbLocation.ts` (relocatable SQLite
  file), `images.ts` (native file picker for portraits, copies into
  `userData/images/`).
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
as its first assistant message.

`{{char}}`/`{{user}}` macros in field content are substituted before the text
reaches a model -- `{{user}}` resolves to the selected persona's name, or
"User" when none is selected.

`chat/ollamaClient.ts` is a thin `fetch` client against the Ollama HTTP API --
no dependency, no model in-process. It streams `/api/chat` (the source never
did) and keeps a non-streaming path for the short internal calls where partial
output is useless. `chat/chatSession.ts` holds per-conversation state in a Map;
the source used module globals, which is why it could only ever have one live
conversation.

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

## Lorebooks

Reference material injected only when the conversation is about it, so a
large setting doesn't have to live in a character's fields and burn context
every turn. Not ported from KVGenius -- it never built one.

Two scopes share `lorebook_entries` but mean different things in the prompt.
**World** books are shared setting material, many-to-many with characters via
`character_lorebooks`, injected as common knowledge. **Personal** books hold
one character's private history, owned outright by that character, injected as
things *that character* remembers and explicitly not common knowledge -- a model
told "the mutiny happened" as world fact lets anyone reference it, whereas
"you remember the mutiny" keeps it in the character's head. Personal books
refuse to be attached elsewhere, and are edited on the character page rather
than beside the shared books, so private history never looks attachable.

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
