# Rove — branding

Animated logo concepts for Rove, built in [Remotion](https://www.remotion.dev/). All drawn from the
project's actual aesthetic: terminal-first, agent-deck-style brackets / BOLD CAPS, and
multi-pane orchestration as the product story.

> The repository keeps its `kobe` package and path identifiers for compatibility;
> rendered wordmarks and product copy use Rove.

## Concepts

| id | concept | what it sells |
|---|---|---|
| `bracket-chip` | `[ rove ]` over a row of engine marks, a caret stepping under one at a time | The README banner. The engine marks are a credentials row — one size, one ink, no rotation — and the caret is the agent-deck `[Tab] label` grammar that runs through the whole TUI. |
| `bracket-chip-vortex` | A field of engine marks pulled into Rove by a sink-vortex flow | The previous README banner. Kept renderable; render it with `bun run gif:bracket:vortex`. |
| `bracket-chip-original` | `[ rove| ]` typing in with a blinking cursor | The first banner direction. Reads as "press me." |
| `pane-grid` | The 5-pane TUI draws itself, wordmark settles into the workspace | The literal product. If the pitch is "Conductor-shaped 5-pane TUI for Claude Code," show it. |
| `task-streams` | Three parallel `● task-N ────►` lanes converging into the wordmark | The multi-task / orchestration value prop — many sessions in flight, one place to drive them. |
| `glyph-k` | A bold "R" assembled from terminal pixels, pulsing | Square app-icon shape. Works as favicon / dock tile / GitHub social card. The composition id stays stable for scripts. |

All of them use the palette in `src/colors.ts` so the assets stay consistent with the running TUI's default theme.

`bracket-chip` is the *slot* for the README banner, not a fixed concept: the composition behind that id
is whatever ships as `docs/assets/brand/bracket-chip.gif`. Swapping the banner means pointing the id at
the new component and retiring the old one under its own concept id, so both stay renderable.

## Render

```bash
cd branding
bun install            # or pnpm install / npm install
bun run studio         # interactive preview at http://localhost:3000
```

One-shot renders — these write straight into `docs/assets/brand/`, the committed asset directory:

```bash
bun run render:all     # the stills and gifs for the four shipped concepts
bun run gifs:all       # just the gifs
bun run stills:all     # just the PNG stills (frame chosen near the settled state)
```

Per-concept, e.g.:

```bash
bun run gif:bracket      # docs/assets/brand/bracket-chip.gif
bun run still:bracket    # docs/assets/brand/bracket-chip.png
bun run gif:grid         # pane-grid
bun run gif:streams      # task-streams
bun run gif:glyph        # glyph-k
bun run gif:bracket:vortex   # the retired README banner, on demand
```

## Canvases

| concept | size | duration |
|---|---|---|
| bracket-chip | 1600×400 (README banner) | 4s |
| bracket-chip-vortex | 1600×400 | 4s |
| bracket-chip-original | 1600×400 | 4s |
| pane-grid | 1200×800 | 5s |
| task-streams | 1200×630 | 4s |
| glyph-k | 800×800 (square / app icon) | 5s |

Override at render time with `--width`, `--height`, `--frames`. For a transparent PNG sequence
suitable for compositing into docs / screenshots, render with `--image-format=png` and
`--codec=png-sequence`.

## Promo stills

Single-frame compositions in `src/promo/`, drawn in the launch film's palette and type (Instrument Sans
for statements, JetBrains Mono for anything you type). `bun run still:promo` renders all four into
`docs/assets/brand/`:

| id | output | used by |
|---|---|---|
| `promo-engines` | `promo-engines.png` 1600×900 | README, top of "Why Rove" |
| `promo-detach` | `promo-detach.png` 1600×900 | README, "How it works" |
| `promo-plugins` | `promo-plugins.jpg` 1600×900 | README, "Plugins" |
| `promo-social` | `promo-social.png` 1280×640 | the repository's social preview, uploaded in GitHub Settings |

The engine roster in `src/promo/promo-theme.tsx` copies the engine registry by hand, so re-render
when an engine joins or leaves. The plugin list is `rove plugin search` output, so re-copy it the
same way.

## Promo film: `rove-life`

41 seconds of the sheet drawing Rove's own history, from the first commit (2026-05-08) to 0.9.223:
one revision per milestone, the revision table and the commits-per-month timeline filling in, and the
title block counting days, version and commits. The drawing field is a viewport (`src/life/camera.ts`)
that opens at 2.57 : 1 on day 0 and pulls back every revision, landing on the downbeat. No images and
no samples: strokes are polylines from `src/life/pen.tsx`, and `scripts/life-score.ts` synthesises the
score (instruments and drums in `scripts/score-dsp.ts`) from the same frame timeline,
`src/life/timeline.ts`.

| id | output | sheet |
|---|---|---|
| `rove-life` | `rove-life.mp4` 1920×1080, 41s | rove.run plot (light) |
| `rove-life-cyanotype` | `rove-life-cyanotype.mp4` 1920×1080, 41s | rove.run cyanotype (dark) |

`bun run mp4:life` and `bun run mp4:life:cyanotype` regenerate the score, then render. Before
`bun run studio`, run `bun run score:life` once: `public/life/score.wav` is generated, not committed.
The score script prints each bus's RMS and the final loudness (-14 LUFS); the target ratios are
written above `MIX`. The milestones, versions and commit counts in `src/life/RoveLife.tsx` were read
from `git log` on 2026-09-22 — re-read them before rendering for a later release.

## Picking one

`bracket-chip` already has the README-hero slot, and `glyph-k` is its companion for the square
app-icon slot. Both are settled.

`pane-grid` and `task-streams` are *story* logos — better for README / docs / landing page than for
the dock.

## Files

```
branding/
├── README.md          ← you are here
├── package.json
├── tsconfig.json
├── remotion.config.ts
└── src/
    ├── index.ts       ← registerRoot
    ├── Root.tsx       ← <Composition> registry
    ├── colors.ts      ← palette + mono font stack
    ├── banner/
    │   └── primitives.tsx   ← canvas constants, engine marks, wordmark, caption
    ├── BannerCaret.tsx      ← the README banner
    ├── BracketChipA2.tsx    ← the retired vortex banner
    ├── BracketChip.tsx      ← the first banner direction
    ├── PaneGrid.tsx
    ├── TaskStreams.tsx
    ├── GlyphK.tsx
    ├── promo/               ← the promo stills
    └── life/                ← the rove-life film: sheet, pen, camera, timeline
```

The branding subproject has its own `package.json`, `tsconfig.json`, and `node_modules` so it stays
isolated from the main Rove build (vitest only scans `test/**`, root tsconfig only includes
`src/**` + `test/**`).
