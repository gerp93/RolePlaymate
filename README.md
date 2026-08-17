# RolePlaymate

A versioned library for AI chatbot characters. Every save creates a new
version instead of overwriting the last one, so you can browse history,
see a word-level diff between drafts, and restore any earlier version —
the same workflow Trackdraft offers for song lyrics, applied to character
cards instead. No AI is used anywhere in the app; it's a plain CRUD +
version-history tool.

## Each character has

- **Name**
- **Personality**
- **Scenario**
- **Opening Greeting**
- **Image** (uploaded portrait)

## Versioning

- Creating a character records version 1.
- Editing and saving always creates a **new** version; nothing is overwritten.
- The version history sidebar lists every version with its timestamp and
  optional "what changed" note.
- Selecting an older version shows a read-only, word-level diff against the
  version before it (additions in green, removals in red-strikethrough).
- **Restore** copies an old version's content into a brand-new version, so
  the full history is preserved (like a revert commit, not a hard reset).

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Prisma + SQLite for storage
- `diff` for word-level version comparisons
- Uploaded images are saved to `public/uploads`

## Getting started

```bash
npm install        # also runs `prisma generate`
cp .env.example .env
npm run db:push     # creates prisma/dev.db with the schema
npm run dev
```

Open http://localhost:3000.
