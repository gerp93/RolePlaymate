# RolePlaymate

RolePlaymate is an Electron desktop app: a character-writing notepad where
AI chatbot characters are made of individually editable, versionable fields
(personality, scenario, opening greeting), plus a portrait image. Modeled on
[TrackDraft](https://github.com/gerp93/TrackDraft)'s song/part/version split
applied to character cards instead of lyrics -- each field has its own
history, its own "active ★" version, and a word-level compare view, and any
version can be saved forward again without losing the ones before it. No AI
is used by the app itself. Data is stored locally in a `sql.js`-backed
SQLite file (relocatable in Settings).

## Development

```bash
npm install
npm run dev        # renderer (Vite) + electron main, concurrently
npm run build       # build:renderer + build:electron
npm run package      # electron-builder, produces installers in release/
```

## Standards

This repo follows [gerp93/KVG_Standards](https://github.com/gerp93/KVG_Standards)
for theming, release/CI, self-update, licensing, database location, release
notes, `VERSION_BUMP.md`, logo/branding, and `TODO.md` conventions. See that
repo's `README.md` and `REPO_SCOPE.md` for the current standards and this
repo's scope against them.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
