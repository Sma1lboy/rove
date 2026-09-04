---
"@sma1lboy/rove": patch
---

The state directory and the plugin tree are repaired to owner-only on every
start, not just when they are created

`<home>/.rove` was created by a bare `mkdir` and landed at 0755 under the
default umask, and the daemon socket inside it bound at `srwxr-xr-x` because
`listen()` applies the umask too. Nothing else gates that socket — connections
are accepted with no peer-credential check — so on a shared machine the
directory mode was the entire ACL, and reaching the socket means `add` (launch
an engine) and `send` (text into a live session). Both the daemon and the PTY
host now create that directory 0700 and chmod it again on every boot, and both
sockets are chmod'd 0600 after the bind.

The "again on every boot" half is the one that matters. `mkdirSync` and
`writeFileSync` apply their `mode` only when they create the path, so a home
that predates the mode arguments kept 0755 forever — the population a
creation-time fix cannot reach is exactly the exposed one.

The same defect had the plugin tree world-readable.
`docs/PLUGIN-AUTHORING.md` tells authors to keep API keys in the config `.env`
and states that the `.env`, the state directory and `log.jsonl` are owner-only;
that was true for a fresh install and false for every older one, because
`writePluginSettings` rewrites the `.env` in place and an in-place write never
changes a mode. Every registered plugin's config, state, `.env`, `log.jsonl`
and the registry are now repaired at daemon start and after each settings save,
so the documented sentence holds on installs that already exist.

Two comments in the web-token chain described mechanisms that are gone.
`pty-auth.mjs` credited the daemon with minting the token file it fails closed
without — no daemon path does; `kobe-harness/dev.ts` is the only minter, which
matters to anyone adding a launcher. The harness token header was written
around a `<meta name="rove-web-token">` injector that #855 deleted along with
the daemon-hosted web transport, and presented the only channel that still
works, `VITE_ROVE_WEB_TOKEN`, as a narrow fallback. Both now say what the code
does.
