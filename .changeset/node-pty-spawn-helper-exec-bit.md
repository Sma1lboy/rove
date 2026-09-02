---
"@sma1lboy/rove": patch
---

Restore the exec bit on node-pty's macOS `spawn-helper` after every install. node-pty@1.1.0 is published with `prebuilds/darwin-*/spawn-helper` at mode 0644, and neither bun nor npm adds an exec bit the tarball never carried, so on macOS every PTY spawned through node-pty failed — and because `.rove/init.sh` runs `bun install` in each new worktree, the breakage came back on every task Rove created (issue #85). The root `postinstall` now runs `scripts/fix-node-pty-exec-bit.mjs`, which chmods any non-executable `spawn-helper` under `node_modules` (no-op off macOS, and a chmod failure warns instead of failing the install). `rove doctor` gains a `node-pty:` row that names the broken helpers on a tree from before this fix, and `--fix` offers the chmod.
