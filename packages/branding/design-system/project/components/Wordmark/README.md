# Wordmark

The bracket wordmark `[ rove ]`: always set as text, never as an image.

Static rendition hand-written from `WORDMARK` and `BRACKET` in `packages/rove-web/src/ui/shell.ts`, as used in `rail-view.tsx`.

- Mono, `fs-title` (14px), 700 weight, 0.02em tracking, no wrap. The brackets are `accent` and the name is `ink`, with one space inside each bracket.
- It leads the rail head on one line, followed by the inbox count (`accent` when unread, else `muted`) and the update arrow. The head must not wrap at the narrowest rail.
- The connect and login screens set the same wordmark over their card.
- The app icon is a separate mark (`assets/Logos/`). Don't build a wordmark from it, or the other way round.
