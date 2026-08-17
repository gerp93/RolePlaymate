# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working
with code in this repository.

## What this is

RolePlaymate is an Electron desktop app: a character-writing notepad where
AI chatbot characters are made of individually editable, versionable fields
(personality, scenario, opening greeting), plus a portrait image. No AI is
used by the app itself -- it's a plain library/versioning tool, modeled on
[TrackDraft](https://github.com/gerp93/TrackDraft)'s song/part/version split
applied to character cards instead of lyrics. Data is stored locally in a
`sql.js`-backed SQLite file.

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
  auto-updater wiring), `database/` (sql.js schema + per-entity services),
  `dbLocation.ts` (relocatable SQLite file), `images.ts` (native file picker
  for portraits, copies into `userData/images/`).
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
