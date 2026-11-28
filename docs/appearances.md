# Appearance packs

An appearance pack lets you restyle Rove's web interface (including Rove Desktop, which renders the same web client) without editing Rove's source code. Drop a directory into `~/.rove/appearances/<name>/`, pick it under **Settings → Appearance → Appearance pack**, and hard-refresh the browser whenever you edit files in that directory.

## How appearance packs relate to themes and plugins

| Mechanism | Location | What it changes |
|---|---|---|
| [Themes](./themes.md) | `~/.rove/themes/*.json` | Color palettes (`defs` + dark/light color slots) shared across TUI and web. |
| [Plugins & Mods](./PLUGIN-AUTHORING.md) | `~/.rove/plugins/` | Executable commands, lifecycle events, terminal panes, TUI pages, and out-of-process Mods drawing new panels on the Mods page. |
| **Appearance packs** | `~/.rove/appearances/<name>/` | Skinning Rove's existing chrome slots (layout framing, density, colors, declarative slot layouts, and custom React slot components). |

Appearance packs reuse Rove's theme color grammar and the Mods declarative element tree (`ModNode`), rather than introducing a second extension runtime. TUI slots are not rendered in this release; the shared contract lives in `@sma1lboy/rove-client` so TUI support can read the same manifests later.

## Directory layout

```text
~/.rove/appearances/
└── ticket-cards/
    ├── appearance.json
    └── components/
        ├── TicketRow.tsx
        └── StatusStrip.tsx
```

- Directory names must match `^[a-z0-9][a-z0-9._-]{0,63}$`. The name `default` is reserved for Rove's built-in appearance.
- Every change to `appearance.json` or `components/*` is picked up on a browser hard refresh — no rebuild and no bridge restart required.

## Manifest (`appearance.json`)

Unknown keys and wrong types reject the whole manifest with exact paths and reasons so you can fix typos immediately.

```json
{
  "version": 1,
  "name": "Ticket Cards",
  "description": "Floating card panes with engine-tinted session tickets.",
  "author": "Rove",
  "theme": "claude",
  "colors": {
    "defs": {
      "ember": "#d97757",
      "ocean": "#5fa8ff"
    },
    "tokens": {
      "paper": { "dark": "#111110", "light": "#f7f5f0" },
      "surface": { "dark": "#1b1a18", "light": "#ffffff" },
      "accent": "ember"
    },
    "engineColors": {
      "claude": "ember",
      "codex": "ocean",
      "default": "#7aa2f7"
    }
  },
  "layout": {
    "frame": "cards",
    "paneGap": 10,
    "shellPadding": 10,
    "radius": 12,
    "radiusSm": 8,
    "radiusXs": 4,
    "density": "comfortable",
    "railWidth": 290,
    "borderStyle": "hairline",
    "statusBar": "always"
  },
  "slots": {
    "rail.row": {
      "component": "components/TicketRow.tsx"
    },
    "status.bar": {
      "component": "components/StatusStrip.tsx"
    }
  }
}
```

### Top-level fields

- **`version`** (required): must be `1`.
- **`name`** (required): display name shown in Settings (1–64 characters).
- **`description`** / **`author`** / **`$schema`** (optional): metadata strings.
- **`theme`** (optional): name of an installed or bundled [theme](./themes.md) to inherit base colors from before applying `colors.tokens`.
- **`colors`** (optional):
  - `defs`: named `#hex` or `rgb()`/`rgba()` color definitions.
  - `tokens`: overrides for Rove's semantic CSS tokens (`paper`, `sidebar`, `surface`, `inset`, `menu`, `line`, `lineFaint`, `lineActive`, `ink`, `muted`, `subtle`, `accent`, `accentSoft`, `hover`, `focus`, `info`, `error`, `success`, `warning`, `merged`, `diffAdded`, `diffRemoved`, `diffAddedBg`, `diffRemovedBg`). Each value accepts `#hex`, `rgb()`/`rgba()`, a `defs` reference, or a `{ dark, light }` object.
  - `engineColors`: per-engine accent/tint colors keyed by engine id (plus optional `"default"` fallback), exposed as `data.engineColor` and `--ap-engine-color`.
- **`layout`** (optional):
  - `frame`: `"flush"` (default edge-to-edge hairlines) or `"cards"` (floating rounded panes).
  - `paneGap` / `shellPadding`: integer pixels (`0`–`32`).
  - `radius` (`0`–`24`), `radiusSm` (`0`–`20`), `radiusXs` (`0`–`16`).
  - `density`: `"compact"`, `"comfortable"`, or `"spacious"`.
  - `railWidth`: default rail width in pixels (`180`–`420`).
  - `borderStyle`: `"hairline"`, `"solid"`, or `"none"`.
  - `statusBar`: `"auto"` (link-down only), `"always"`, or `"hidden"`.
- **`slots`** (optional): map of slot id → slot specification.

## Slots

| Slot id | Surface | Declarative fields |
|---|---|---|
| `shell.frame` | Outer frame wrapping rail, workspace, side panel, and status bar | `taskCount`, `selectedTitle`, `panelOpen`, `railFolded` |
| `rail.frame` | Sidebar rail container | `unreadCount`, `taskCount`, `groupBy`, `sortBy` |
| `rail.groupHeader` | Project or state group header in the rail | `label`, `repo`, `count`, `collapsed`, `kind` |
| `rail.row` | Session row (including selection state and second line) | `title`, `branch`, `repo`, `engine`, `status`, `statusLabel`, `pr`, `todos`, `tokens`, `age`, `cloud`, `pinned`, `diffStats`, `cost` |
| `rail.footer` | Rail bottom strip (usage and Settings) | `usageSummary`, `settingsLabel`, `unreadCount` |
| `session.header` | Workspace session tab bar and panel launcher | `title`, `branch`, `repo`, `engine`, `status`, `tabCount`, `activeTab` |
| `panel.tabs` | Right side-panel header / tab strip | `kind`, `title`, `hint`, `tabCount`, `expanded` |
| `panel.section` | Right side-panel view / inspector body | `kind`, `title`, `branch`, `repo`, `engine`, `status`, `diffStats`, `todos`, `pr`, `cost` |
| `status.bar` | Footer bar below the terminal | `connection`, `taskTitle`, `branch`, `engine`, `status`, `diffStats`, `usageSummary` |

### Slot specification options

Each entry under `slots.<slotId>` accepts:

- **Declarative field layout**: `fields`, `secondaryFields`, `surface` (`"paper"`, `"sidebar"`, `"surface"`, `"inset"`, `"accentSoft"`, `"engineTint"`), and `variant` (`"default"`, `"card"`, `"compact"`, `"pill"`, `"minimal"`).
- **Declarative element tree**: `tree` using the Mods `ModNode` vocabulary (`box`, `text`, `button`, `input`) with plain-text `{{field}}` interpolation (never raw HTML).
- **Custom component**: `component` (relative path under `components/*.tsx|ts|jsx|js`) and optional `export` (defaults to `"default"`). Cannot be combined with `tree`.
- **Hide slot**: `hidden: true` (cannot be combined with `component` or `tree`).

## Custom components

`rove-bridge` bundles a pack's `components/*.tsx|ts|jsx|js` files on demand and serves them from the bridge's own origin (`/appearances/<name>/bundle.js`) with `Cache-Control: no-store`. React and JSX imports are mapped onto the host's single React instance, so hooks work normally.

Components may also import host primitives and live CSS tokens from `@rove/appearance`:

```tsx
import { ui, useTokens } from "@rove/appearance"
import type { AppearanceSlotComponentProps } from "@sma1lboy/rove-web/appearance"

export default function InspectorSection({ data, defaultNode }: any) {
  const tokens = useTokens()
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ padding: "8px 10px", background: tokens["--inset"], fontFamily: "var(--mono)" }}>
        {data.title} · {data.branch} ({data.statusKind})
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>{defaultNode}</div>
    </div>
  )
}
```

Every component receives `{ slot, data, defaultNode, children, spec, tokens, mode }`. Returning `defaultNode` inside a wrapper lets you augment an existing slot (for example, adding a live status header above the Files or Diff view) without reimplementing the view itself.

## Fault isolation and debugging

Appearance packs never leave Rove on a blank screen:

- **Manifest & bundle errors**: unknown keys, invalid types, bad color values, missing files, or TSX compile errors reject the pack whole and fall back to the built-in default UI.
- **Per-slot error boundary**: if one slot component throws during render, only that slot falls back to Rove's default UI while other slots stay active.
- **Outer shell error boundary**: if an appearance causes a shell-level render crash, Rove automatically disables the pack and re-renders in the default UI.
- **Error inspection**: a compact banner displays the failing pack name, slot/file, and message with **Details** and **Switch to default**. **Settings → Appearance** shows the full validation list or stack trace and a **Switch to default** button.

## Example packs

Two ready-to-copy example packs live in the repository:

- [`examples/appearances/ticket-cards/`](../examples/appearances/ticket-cards/): floating card panes, custom engine-tinted session ticket rows, and a persistent status strip.
- [`examples/appearances/status-inspector/`](../examples/appearances/status-inspector/): declarative two-line rail rows paired with a custom right-panel status inspector above the live Files/Diff view.

Copy either directory into `~/.rove/appearances/`, then pick it in **Settings → Appearance → Appearance pack**:

```sh
mkdir -p ~/.rove/appearances
cp -r examples/appearances/ticket-cards ~/.rove/appearances/
```
