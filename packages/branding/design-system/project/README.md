Rove is a local-first workspace for running many AI coding sessions at once. It has two clients that draw the same facts: a terminal UI (OpenTUI + React) and a web client (React + Tailwind). Both paint from one theme. The look is a quiet, warm-neutral workbench with one terracotta accent, monospace for structure and sans for prose. The tokens here are the default `claude` theme. Dark is the default theme and comes first.

## Content fundamentals

- **Sentence case for actions and titles:** "New task", "Run again", "Delete". No Title Case, and no ALL CAPS except the rare kicker. Placeholders and empty-list notes are lowercase, terminal style: "no tasks yet", "no pending attention".
- **Name the thing the user does.** An action keeps one name through the whole flow: the button says "Delete", the toast says "Deleted".
- **Short and literal.** No marketing verbs (unlock, seamless, supercharge), no filler, no exclamation marks, no emoji.
- **Errors say what happened and what to do next.** Never just "Error" or "Something went wrong". Show the error in the block that failed, not as a page banner.
- **Use real ellipses.** `Loading…`, `Saving…`, never `...`.
- **Unknown is not empty.** Before the daemon's first reply, show nothing or a placeholder at full height. Never "No tasks". An empty state names the next step: "no tasks yet", then "New task above: pick a project folder, then say what to do".
- **The TUI's words win.** Web strings reuse the TUI's message catalogue, and every new string ships in `en` and `zh`.

## Visual foundations

### Colour

- Ground: `paper` for the page and terminal, `surface` for anything raised (dialogs, menus), `inset` for an active tab, a field or a toast, and `menu` for a selected or cursor row, one step deeper, so a selected row never looks like a hovered one.
- Text: `ink` > `muted` > `subtle`, in that order of importance. Set body in `ink`, secondary lines in `muted`, and project heads, ages, placeholders and key legends in `subtle`.
- **One accent, used for meaning.** `accent` (terracotta) marks selection, focus, the wordmark brackets, running or unseen status and the primary action. Never use it for hover: hover is the neutral `hover` wash.
- **Status tones are fixed.** `warning` (amber) means a wait you can clear: needs input, rate limited. `error` (red) means broken until you act. `accent` means running or unseen, and `subtle` means idle. Every status also has a glyph, because colour is never the only signal (see StatusGlyph).
- Washes: `accent-soft` for a picked chip or a row mid-drag, `hover` for pointer hover and menu highlight.
- Lines: one `hairline` weight in `line`, with `line-active` for a focused field. Use space to separate groups before you reach for a line.
- Never hard-code a hex in a component. `prefs-theme.ts` remaps every token from the active TUI theme at runtime, so a raw colour goes stale when the theme changes.

### Type

- **Two faces, two jobs.** `mono` carries structure: the wordmark, project heads, chips, glyphs, tabs, keys, paths, IDs and code. `sans` carries prose: body, dialog copy, settings descriptions and tab-strip titles. Don't spread mono into paragraphs, and don't put sans into a glyph column, because alignment depends on `1ch`.
- **Four sizes only:** `fs-meta` 12, `fs-body` 13, `fs-title` 14 and `fs-display` 16.
- Show hierarchy with weight and tone, not new sizes: 700 for the wordmark, 600 for project heads, tabs and dialog titles, 500 for kickers, 400 elsewhere. Dialog titles use `fs-title`.
- **Never change weight on hover or selection,** because bold widens the label and shifts the row. Mark state with `inset`, `hover` or colour.
- Figures are tabular (`font-variant-numeric: tabular-nums` on `body`), so counts and versions don't jitter.

### Space, radius, layout

- The rhythm is small: `space-0.5` through `space-5` (2–20px). A list row is 26px tall (40px on touch) with `space-0.75` × `space-2` padding. Dialogs pad `space-4.5` × `space-5`. Don't add a value 1px off an existing one.
- Radii: `radius-sm` (6) for controls and rows, `radius` (8) for dialogs and menus, `radius-xs` (4) for a small control inside a row, `radius-full` for the switch and pills. A row inside a padded panel takes the concentric inner radius, `calc(var(--radius) - <padding>)`, never a literal.
- Panes share width by ratio (flex-grow), not pixels. The web app is a grid: rail `minmax(220px, 280px)`, workspace, and a Files panel at `clamp(300px, 28vw, 440px)`. Below 560px (70 columns × 8px) it shows one pane at a time with a back bar, like the TUI's narrow mode.
- One left edge and one right edge per column. Text-bearing flex children get `min-width: 0` and truncate with an ellipsis.

### Elevation and borders

- Only floating things cast a shadow: `shadow-popover` for menus and tips, `shadow-dialog` for dialogs. Each also has its own `line` hairline border. Resting surfaces have neither.
- A box is a solid hairline or nothing. No dashed borders, no cards inside cards, no coloured side stripes, no gradients, glows or glass.

### Motion

- Motion answers an action: a press (`scale(0.97)` on `:active`), an open or a close. Nothing animates on mount or on a theme switch.
- Overlays fade in over 140ms or rise 4px over 180ms with `cubic-bezier(0.16, 1, 0.3, 1)`, and sink back out over 140ms. Menus scale from 0.96 over 120ms. The rail folds over 200–220ms with `cubic-bezier(0.2, 0, 0, 1)`.
- Animate only `transform` and `opacity`. Gate everything on `prefers-reduced-motion`.

### States and interaction

- Every control has rest, hover, focus-visible, active and disabled states. Disabled is 50% opacity and says why in a title or hint.
- Focus is `1px solid focus` with a 1px offset. A field marks focus on its own border with `line-active`, because a ring would be clipped inside a scroller.
- Hit targets are at least 24×24px with a pointer and at least 40–44px tall on touch. Small controls grow an invisible hit area on coarse pointers.
- Anything revealed on hover is also reachable from the keyboard, a right-click menu and touch.

## Iconography

- The status vocabulary is text glyphs, not an icon font: `○` idle, `●` unseen, `?` needs input, `!` attention, `◷` rate limited, `†` dead, `✓`/`✗` checks, `◇` subagents, `☁` another machine. A braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) marks a running row. Users can switch to the `starburst` or `ascii` sets.
- The web draws a running or waiting status as a 3×3 dot orb, stepped on a shared 80ms clock, in the same tone.
- Engine status lines and prompt themes use Nerd Font symbols. The web ships them as the "Rove Nerd Symbols" face (`src/fonts/symbols-nerd-font-mono.woff2`, limited to the private-use ranges), so viewers need nothing installed.
- The only drawn glyph is the thin chevron (10×10 viewBox, 1.3 stroke, round caps), which points down and rotates a quarter turn for "right".
- No emoji as icons.

## Brand

- **Wordmark:** `[ rove ]` in `wordmark` style: mono 14px 700, tracking 0.02em, brackets in `accent`, name in `ink`. It is always text, never an image.
- **Mark:** a bracketed capital R, in terracotta brackets and a paper-white R on the dark ground (`assets/Logos/`). Use the image file; never redraw it.

## Not synced

- Font files are not in `fonts/`. The web bundles JetBrains Mono through `@fontsource/jetbrains-mono` (400, 500, 600 and 700) and the "Rove Nerd Symbols" face (1.2 MB, over the 1 MB per-file cap); load JetBrains Mono from Google Fonts or the package when consuming this system.
- Components are **static renditions hand-written from** `packages/rove-web/src/ui/*` (Tailwind recipes rewritten as plain CSS in `components/bundle.css`). The React library itself was not built or bundled.
- The marketing palette in `packages/branding/src/colors.ts` (porcelain light `#f6f3ec`, used for videos and the landing page) differs from the app's light theme. It is not included as tokens.
- Other bundled TUI themes (`conductor`, `skylight`, `tokyonight`) are not included. Only `claude` is.
