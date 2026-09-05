---
"@sma1lboy/rove": patch
---

`rove remove` can now delete a remote project's stored SSH password, and PR polling stops writing a branch name nobody reads

Forgetting a remote project dropped its `remoteRepos` entry — which is where the pointer to its keychain password lived. The password stayed in the OS keychain with nothing left in Rove that referenced it, and no command that could reach it. `rove remove --purge-credentials` now deletes it; without the flag the password is still kept (forgetting a project should not silently destroy a secret), but the removal output names the flag and the keychain item, so the exit is discoverable instead of theoretical.

`prStatus.headRef` is gone from the task record. It was requested from `gh pr view`, stored, compared in `samePrStatus`, encoded by the persistence codec and mirrored in the daemon protocol — and read by nothing. Because it took part in the equality check, a branch rename triggered a task write plus a `task.snapshot` broadcast that changed nothing anyone could see; the branch name consumers actually use is `task.branch`. This changes the broadcast and on-disk shape of `TaskPRStatus`: the field is now absent. Nothing rendered it, and the codec ignores unknown keys, so existing `tasks.json` records carrying it stay readable.

Also removed five exports that had no callers: `nextVendor` (superseded by `nextVendorWithin`, and unlike its replacement it cycled through engines that aren't installed), `withDaemonSession`, `isKobeSkillInstalled`, and the harness's `DEFAULT_CLI_API` / `cliCommand`.
