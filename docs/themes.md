# Themes

Rove bundles four themes (`claude`, `conductor`, `skylight`, `tokyonight`) and
ten more are [one command away](#hosted-themes). You can also write your own or
import one from your local terminal emulator.

Any `~/.rove/themes/*.json` file loads at boot and appears in the theme
picker (Settings → General → Appearance → Theme in the TUI, or Settings →
Appearance → Theme in the web client). A user theme with the same name as a
bundled one wins. The web client rereads the directory each time Settings opens,
so a new or edited file shows there without a restart; its **Make one with an
agent** link opens a Scratch session whose agent is asked to write a theme into
this directory (see
[What an agent may edit](./CONFIGURATION.md#what-an-agent-may-edit)).

## JSON shape

A theme is a JSON object with `theme` (required) and optional `defs`,
`fontFamily`, and `$schema` fields:

```json
{
  "$schema": "https://raw.githubusercontent.com/sma1lboy/rove/main/packages/rove/src/tui/context/theme/theme.schema.json",
  "fontFamily": "JetBrains Mono",
  "defs": {
    "brand": "#cc785c"
  },
  "theme": {
    "background": "#141413",
    "text": "#eae7df",
    "cursor": "#cc785c",
    "primary": "brand",
    "accent": { "dark": "#cc785c", "light": "#c96442" }
  }
}
```

- **`defs`** (optional): a palette of named colors that `theme` entries
  can reference by name. Values are hex strings, or references to other
  `defs` keys.
- **`theme`** (required): the slot map. Each value is either a hex
  string (`#abc`, `#aabbcc`, `#aabbccdd`), a bare string referencing a
  key in `defs`, or a `{ dark, light }` pair for theme-mode-aware
  colors. Both `dark` and `light` are required when you use the variant
  form. Settings → General → Appearance → Mode (`themeMode` in
  `state.json`) picks which half is drawn: `dark`, `light`, or `auto` to
  follow the terminal's background.
- **`fontFamily`** (optional): a monospace font family name (for example
  `"Berkeley Mono"` or `"Fira Code"`). See [Font support by client](#font-support-by-client).
- **`$schema`** (optional): pointer back to Rove's JSON schema for
  editor autocomplete. The canonical URL is the one above.

You don't have to fill every slot; Rove has fallbacks (e.g.
missing `borderActive` falls through to `border`, missing `border`
falls through to `text`). The full slot list with fallbacks lives in
[`packages/rove/src/tui/context/theme-core.ts`](../packages/rove/src/tui/context/theme-core.ts).
The canonical example is
[`packages/rove-core/src/theme/claude.json`](../packages/rove-core/src/theme/claude.json).
Copy it as a starting point.

## CLI

```sh
# List bundled + user-installed themes
rove theme list

# Install from a URL or local path. Default name is the basename.
rove theme add https://raw.githubusercontent.com/<you>/<repo>/main/<theme>.json
rove theme add ./my-theme.json --name darkside --use

# Auto-detect and import from a local terminal emulator (and switch to it)
rove theme import --list
rove theme import ghostty
rove theme import alacritty --name work-term --no-use

# Overwrite an existing user theme
rove theme add ./darkside.json --force
rove theme import ghostty --force

# Remove a user-installed theme (built-ins can't be removed)
rove theme remove darkside
```

`rove theme add` validates the JSON before writing and refuses to
overwrite without `--force`. Invalid themes are rejected with a
one-line reason; the schema rules are the same ones the boot-time
loader applies.

## From your local terminal

Rove can auto-detect and import colors (background, foreground, cursor, ANSI
0–15 palette) and optional font family directly from your terminal emulator's
config files, with zero external dependencies and without executing Lua or
launching the terminal:

| Terminal | Paths probed | Formats supported |
| --- | --- | --- |
| **Ghostty** | `~/.config/ghostty/config`, `config.ghostty`, and on macOS `~/Library/Application Support/com.mitchellh.ghostty/config` (`config.ghostty`) | `background`, `foreground`, `cursor-color`, `palette = N=#hex`, `font-family`, `config-file` includes, and `theme = <name>` (`dark:…,light:…`) |
| **Kitty** | `~/.config/kitty/kitty.conf`, `~/.config/kitty/current-theme.conf` | `background`, `foreground`, `cursor`, `color0`–`color15`, `font_family`, and `include` directives |
| **Alacritty** | `~/.config/alacritty/alacritty.toml` (and `~/.alacritty.toml`, `%APPDATA%\alacritty\alacritty.toml` on Windows) | `[colors.primary]`, `[colors.cursor]`, `[colors.normal]`, `[colors.bright]`, `[[colors.indexed_colors]]`, `[font.normal]`, `[general] import = [...]` |
| **WezTerm** | `~/.wezterm.lua`, `~/.config/wezterm/wezterm.lua` | Static extraction of `colors = { background, foreground, cursor_bg, ansi, brights }`, `color_scheme` (`colors/<name>.toml`), `wezterm.font(...)`, and `wezterm.font_with_fallback(...)` |

Four ways to import and switch in one step:

- **CLI**: `rove theme import [ghostty|kitty|alacritty|wezterm]` (pass `--list`
  to inspect detected configs, `--no-use` to install without switching).
- **Agent / script API**: `rove api theme-import --list` or
  `rove api theme-import --terminal ghostty [--name <name>] [--force] [--no-switch]`.
- **TUI**: open **Settings → General → Appearance → Theme**; detected local
  terminals appear at the bottom of the picker (`↓ Import from <Terminal>`) with
  a live workspace preview before you press Enter.
- **Web**: open **Settings → Appearance → Theme**; detected local terminals
  appear under **From your terminals** — hover to preview colors and font, click
  to import (or sync) and switch immediately.

`rove theme add <path>` also accepts any standalone Ghostty, Kitty, Alacritty
TOML, WezTerm Lua/TOML, or Xresources (`*.background: #011627`) scheme file:

```sh
rove theme add ~/.config/alacritty/alacritty.toml --use
```

The file must set `background` and `foreground`; the 16 ANSI colors fill both
semantic UI roles (blue for the primary accent, red for errors, green and red
for diff lines) and explicit `terminalBlack`–`terminalBrightWhite` slots (plus
`cursor` when defined), while panels and borders are stepped from the
background toward the foreground. A hue the file leaves out falls back to the
text color. The imported theme is written as ordinary theme JSON under
`~/.rove/themes/` that you can edit by hand.

### Font support by client

When a terminal config specifies a monospace font family, Rove saves it as the
optional top-level `fontFamily` field in the imported theme JSON. Each client
applies it only where it actually controls font rendering:

- **Web (`rove-web`)**: applies `fontFamily` to `--mono` (UI monospace chrome)
  and embedded xterm.js terminals, keeping Rove's bundled Nerd Font symbols in
  the fallback stack so status-line icons still render. The font must be
  installed on the browser's device; otherwise the browser falls back to
  JetBrains Mono.
- **TUI (`rove`)**: **does not change fonts**. A TUI runs inside your host
  terminal emulator, which owns font selection and rendering; `fontFamily` is
  preserved in the JSON and ignored at draw time.
- **iOS / Android**: mobile clients do not load desktop fonts and ignore
  `fontFamily`.

## Publishing on GitHub

1. Commit your theme JSON to a public repo (or gist).
2. Click "Raw" on GitHub and copy the URL. It should look like
   `https://raw.githubusercontent.com/<you>/<repo>/main/<theme>.json`.
3. Share `rove theme add <raw-url>` with anyone who wants to install it.

That's the entire distribution mechanism: no plugin manifest, no
registry. The same shape is what Rove ships internally; your theme
doesn't have to know it's a "user" theme.

## Hosted themes

Ten more themes are hosted rather than bundled: `catppuccin`, `dracula`,
`everforest`, `gruvbox`, `kanagawa`, `nord`, `opencode`, `osaka-jade`,
`rose-pine`, `solarized`. Install any of them with one command:

```sh
rove theme add https://rove.run/themes/gruvbox.json
```

Preview all thirteen at <https://rove.run/themes>. In the web client,
Settings → Appearance → Theme lists the hosted themes you have not installed
under the installed ones: point at one to preview the page in it, click to
install it and switch to it.

## Troubleshooting

- **Theme doesn't show up**: check `rove theme list` to confirm the
  file is being read. If it's missing, re-check the file extension
  (`.json`) and the directory path printed by `rove theme list`.
- **Terminal config not detected**: run `rove theme import --list` (or
  `rove api theme-import --list`). A config must declare at least
  `background` and `foreground` (either inline or in a referenced theme/include
  file on disk).
- **Theme rejected at boot**: Rove writes a `console.warn` line to
  stderr with the file path and the rejection reason. Run
  `rove doctor` for a full environment report and check the recent
  output above where you ran `rove`.
- **Want to override a built-in?** Drop a file with the same name
  (e.g. `~/.rove/themes/claude.json`). User files load after bundled
  ones and win on collisions.
