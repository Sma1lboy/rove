The docs site's plugin directory is generated from the public GitHub topic `rove-plugin`.

1. Run `node scripts/scan-plugins.mjs` from the repo root.
2. If it says the page is already current, make no commit and no PR — report that with the `rove api routine-respond` line the daemon prefixed to this prompt.
3. Otherwise it rewrote `docs/PLUGIN-DIRECTORY.md`: commit that file alone, push the branch, and open a PR titled `[routine] chore: refresh the plugin directory`, naming in the body the repositories added or removed.

Never hand-edit `docs/PLUGIN-DIRECTORY.md` — `scripts/scan-plugins.mjs` owns it. Follow the repo's CLAUDE.md for everything else (changesets, PR body length, no AI attribution).
