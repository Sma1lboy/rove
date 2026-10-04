# Namespace retirement verification

The before image runs the published npm release `@sma1lboy/rove@0.9.238`.
The after image runs this branch against the same disposable `dev:sandbox`
home, `/private/tmp/rove-rename-proof/home`. Both use `/harness` → xterm.js →
PTY sidecar → real OpenTUI, at 1280 × 800, device scale 1, Kanagawa.
The after image shows the ordinary live-process reattachment notice.

`continuity.json` records the same host PID, engine PID, and session generation
before and after `dev:sandbox daemon restart`. `process-provenance.json`
identifies the release-built host and source-built replacement daemon.
`post-upgrade-io.json` records input echoed by the same engine process after
the upgrade. The marker was cleared without submitting a model request.
Claude authentication was unavailable; this proves live process and PTY
continuity, not a successful model response. Windows was not executed locally.

The release package was obtained with `npm pack @sma1lboy/rove@0.9.238` and
extracted under the fixture's `release/` directory. Its CLI was launched with
the environment returned by `sandboxChildEnv` from the `dev:sandbox` script.
It created task `01M42RD4Q21PW8WFZYTDXRN2MB`, opened `tab-1`, and submitted the
before marker. The branch then ran:

```sh
ROVE_SANDBOX_HOME_DIR=/private/tmp/rove-rename-proof/home bun run dev:sandbox daemon restart
ROVE_SANDBOX_HOME_DIR=/private/tmp/rove-rename-proof/home bun run dev:sandbox api pty-list
```

The before/after raw responses are included in the PR evidence comments.
Production Rove state was not used. The canonical-first attachment socket
test also checks an existing pre-rename endpoint and canonical preference.
