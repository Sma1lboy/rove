/**
 * IBM Bob Shell screen-state manifest — the only activity signal Rove has
 * for a bob session (no hooks, no readable transcript markers yet).
 *
 * Every string below is read off the `bobshell` 2.0.4 bundle
 * (dist/bob.js, released 2026-09-16), not off a live capture: the dialogs
 * are Ink components whose labels are literal in the source. The RUNNING
 * turn's footer is NOT in this list — the bundle draws its status line from
 * localized fragments that could not be pinned to one stable phrase, so a
 * working bob currently classifies as at-rest until someone captures the
 * real footer and adds the rule. Blocked states are the ones that matter
 * for "go look at it", and those are covered.
 */

import type { EngineScreenManifest } from "../screen-state.ts"

export const BOB_SCREEN_MANIFEST: EngineScreenManifest = {
  rules: [
    // Folder-trust dialog on a never-seen directory. The default launch
    // passes `--trust` so a Rove task should not see it, but a user launch
    // command without the flag still can.
    { state: "blocked", any: ["do you trust this folder?"] },
    { state: "blocked", all: ["trust this folder", "don't trust"] },
    // Tool-approval prompt: "Approve Once" / "Reject" plus the
    // for-this-task variants.
    { state: "blocked", all: ["approve once"], any: ["reject", "approve for task", "always allow command"] },
    // Resume picker (`bob -r` with no id) and the MCP/secret prompts all
    // carry an Esc-to-dismiss footer beside an Enter verb.
    { state: "blocked", all: ["enter to resume", "esc to close"] },
    { state: "blocked", all: ["mcp server authentication"] },
    // Second-Ctrl+C confirmation: the session is waiting on a human.
    { state: "blocked", any: ["press ctrl+c again to exit"] },
  ],
}
