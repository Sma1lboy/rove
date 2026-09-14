# @sma1lboy/kobe-landing

Marketing landing page for **Rove** — served at **https://rove.run**.

Static HTML with no build step or framework. The homepage uses `index.html`,
its own `home.css`, and `index.js` for language selection and installation
commands. English content and the npm command remain readable without JavaScript.
The product video uses the existing Rove recording in `assets/demo.mp4`.

Plugins, themes, and changelog pages retain their shared `blueprint.css` styling.
Homepage layout changes belong in `home.css` so they do not affect those pages.

## Local preview

```bash
bun run dev          # serves on http://localhost:4321
```

## Deploy

Hosted on Vercel as a static project (no build). The repo root is `packages/kobe-landing`.

```bash
bun run deploy           # production (vercel deploy --prod)
bun run deploy:preview   # preview URL
```

The custom domain `rove.run` is a CNAME → Vercel's DNS
(`*.vercel-dns-016.com`), managed in Cloudflare (zone `sma1lboy.me`). The old
`kobe.sma1lboy.me` domain is kept as a Vercel-level 301 redirect to
`rove.run`.

### Why `vercel.json` pins `ignoreCommand: "exit 1"`

Vercel's default monorepo skip-check runs `git diff --quiet HEAD^ HEAD -- .` to
avoid rebuilding when the root directory is untouched. The repo-root
`.vercelignore` allowlists only this directory, which strips `.git` from the
clone — so git exits non-zero with *"Not a git repository"* and **every**
deployment, on `main` and on every PR, reported as failed. This site is static
(`buildCommand: null`), so there is nothing to skip: `exit 1` means "always
build". `vercel.json` takes no comment keys (an unknown key fails validation
outright), which is why this note lives here.
