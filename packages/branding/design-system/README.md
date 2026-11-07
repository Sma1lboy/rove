# Rove design system (local copy)

A local copy of the Rove design system that lives on claude.ai as a Design System artifact
(https://claude.ai/artifact/YWPgKk3s256JqGBSDRePAv). `project/` holds that artifact's files as they were published:
tokens, brand book, component guidelines and previews, and logos.

- `project/` — source, copied from the artifact (`tokens.json`, `README.md`, `terminal.md`, `components/`, `assets/`)
- `tokens.css` — generated: every token as a CSS variable, dark on `:root`, light under `[data-theme="light"]`
- `rove-design-system.html` — generated: one self-contained page that opens offline (only JetBrains Mono comes from Google Fonts)

Rebuild after changing `project/`:

```bash
node packages/branding/design-system/build.mjs
```

To refresh `project/` from the artifact, ask Claude to re-read the artifact into this folder (the artifact's
`/_blob` logo uploads are saved as `project/assets/Logos/*.png`), then rebuild.
