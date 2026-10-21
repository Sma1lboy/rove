# Native plugin process acceptance

`bun native.mjs` runs the real ModHost and hook runner under Bun. It checks pane
publication and presses, captured hook output, and termination of live child
and grandchild PIDs after mod stop, disable, replacement, hook timeout, and
shutdown. Windows plugins run through `cmd /c`, so killing only the wrapper
cannot pass. The test cleans up any surviving fixture processes after recording
the result.

The Windows plugin acceptance workflow pins Bun 1.4.3 and runs the host inside a
real ConPTY console. Node owns the console transport; Bun executes the host and
its plugin spawn code. A Node-hosted Vitest run is not a substitute.

`compare.mjs` compares the two production files from the unfixed revision
`61c4532cc642039ce4ce3f6739d1ee35f2c58cd0` with the checked-out head. It restores
the head files even if the baseline fails. Run only in a disposable checkout.
The workflow uploads JSON results with Windows and Bun versions, revision IDs,
and logs to the `windows-plugin-evidence` artifact.

With `ROVE_PLUGIN_SCENARIO=clients`, the same comparison launches the real
source daemon, web client, and TUI through `/harness` at 1280×800. It records
screenshots and Playwright traces. On the fixed code, a web press updates the
TUI, and a TUI press updates the web counter. No mocked client or renderer is
used. The ports 5273, 5274, and 5276 must be available.
