# Terminal UI

The TUI is the product, and the web client follows it. Both clients read one theme file (an opencode-format JSON under `packages/rove/src/tui/context/theme/`) with a `dark` and a `light` half. The TUI paints the slots directly. The web maps them onto its tokens (`prefs-theme.ts`). Theme mode `auto` follows the terminal's or the browser's colour scheme.

## Theme slots → tokens

| TUI slot | Web token | Used for |
| --- | --- | --- |
| `background` | `paper` | Terminal and page ground |
| `backgroundPanel` | `surface` | Panels, dialogs |
| `backgroundElement` | `inset` | Selected rows, active tabs |
| `backgroundMenu` | `menu` | Menus, terminal selection |
| `border` / `borderActive` / `borderSubtle` | `line` / `line-active` / `line-subtle` | Frames and rules |
| `text` / `textMuted` | `ink` / `muted` | Text |
| `diffLineNumber` | `subtle` (raised to AA on the web) | Quiet text |
| `primary` | `accent` (and `focus`) | The accent |
| `secondary` | `secondary` | Terminal cyan, markdown code |
| `error` · `warning` · `success` · `info` | same names | Status |
| `syntaxType` | `merged` | Merged PRs, terminal magenta |
| `diffAdded(Bg)` / `diffRemoved(Bg)` | `diff-*` | Diffs |

The xterm palette on the web comes from the same slots: black is `background`, red `error`, green `success`, yellow `warning`, blue `info`, magenta `syntaxType`, cyan `secondary`, white `textMuted`, bright black `diffLineNumber`, the cursor `primary`.

## Frames

- Every framed surface is a **rounded** box: spread `FRAME` (`{ border: true, borderStyle: "rounded" }`) and set `borderColor={theme.border}`. A bare `border` falls back to OpenTUI's square style.
- Layout is Yoga flexbox. Panes share width with `flexGrow`. Fixed `width`/`height` is for a documented convention, a fixed glyph or a modal only. Avoid `height="100%"`.
- Below about 70 columns the TUI goes into narrow mode and shows one pane at a time. The web matches this at 560px.

## Status glyphs

One function, `rowStatusGlyph` (`packages/rove/src/lib/row-status-glyph.ts`), turns a daemon row status into a glyph and a tone. The TUI sidebar, the tab strip and the web rail all call it, and none of them derives a status of its own.

| Status | Glyph (braille set) | Tone |
| --- | --- | --- |
| running / busy | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` spinner | `accent` |
| unseen (a turn finished, nobody looked) | `●` | `accent` |
| needs input | `?` | `warning` |
| attention, rate limited | `!` (`◷` in the tab strip) | `warning` |
| attention: error, dead engine, failed delete | `!` (`†` dead) | `error` |
| idle | `○` | `subtle` |

Status appears only on **tab rows**. Task rows carry no status cell and start flush with their project head. A task's right edge holds the chips (pin, PR), then the job spinner, then `☁` when the task lives on another machine.

## Keys

Every new or moved chord needs the owner's sign-off. Ship it as PROPOSED and record it in `docs/design/keybinding-decisions.md`. The web binds the same keys as the TUI wherever the browser allows. Key legends are mono, `subtle`, and hidden on touch screens.
