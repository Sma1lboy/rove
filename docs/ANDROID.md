# Android client

Rove for Android is a Kotlin and Jetpack Compose client in `packages/rove-android`. It speaks bridge protocol version 1, shared with [iOS](IOS.md), and makes no daemon, bridge, or iOS changes. The Mac owns tasks and PTYs; Android holds pairing credentials and transient screen state.

This draft implements pairing by paste, QR scan or deep link, task attention ordering, terminal tabs, a control-key row and line composer, image/PDF attachments, new engine tabs, branch and working-tree diffs, new tasks, two-step land/delete confirmations, local notifications, and the shared offline demo. The list header opens the same pages as iOS: inbox, settings (bridge, usage, engines, plugins, notifications, worktrees, activity, feedback, about), board, routines, GitHub issues and worktrees.

## Build

Requirements: JDK 17, Node/npm, Android SDK platform 35, build-tools 35.0.0. Use the committed Gradle wrapper.

```sh
cd packages/rove-android
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk
./scripts/verify.sh
```

On macOS, `/usr/libexec/java_home -v 17` locates an installed JDK. On allen, use its installed JDK and SDK paths. Do not copy local signing keys or bridge credentials into the checkout.

The build reads the iOS demo fixture from the sibling package and bundles the npm-locked terminal assets. Output: `app/build/outputs/apk/debug/app-debug.apk`.

## Run on allen

Hermes prepares allen's emulator and access to a development Mac bridge. No emulator name or host address is assumed.

1. List configured devices with `emulator -list-avds`, then start the selected device with `emulator -avd <name>`.
2. Run `adb devices` and wait for the device to finish booting.
3. Install with `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
4. Launch with `adb shell am start -n run.rove.mobile/.MainActivity`.
5. Tap **try a demo**. Check the pairing page, task list, task detail, terminal and diff before connecting a Mac.

Run the bridge on the Mac using the commands in [the bridge README](../packages/rove-bridge/README.md). Use a named sandbox for mutations. On allen, the emulator's `10.0.2.2` means **allen**, not the remote Mac. Use a reachable Tailscale address, a Cloudflare tunnel, or an explicitly prepared tunnel from allen to the Mac. The app must not guess or substitute the address in the pairing URL.

Paste or scan the bridge's URL. For Cloudflare, enter both `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Tap **connect**. The app strips the token and preset before connecting and sends the token only in the bearer header.

## Protocol contract

Request: `{"id":1,"op":"tasks.list","args":{}}`.
Reply: `{"id":1,"ok":true,"result":{...}}`, or `{"id":1,"ok":false,"error":{"code":"...","message":"..."}}`.
Push: `{"event":"tasks","data":{...}}`.

| Operation | Android behavior |
| --- | --- |
| `hello` | Require protocol 1 before showing connected |
| `tasks.subscribe`, `tasks.list` | Initial snapshot, live updates, manual refresh |
| `engines.list`, `repos.list` | Use server names and IDs in creation forms |
| `task.tabs`, `tab.new` | List tabs and create an engine tab with a prompt |
| `term.attach` | Receive stream ID and base64 replay; only attach existing sessions |
| `term.data`, `term.exit` pushes | Decode bytes in xterm; stop input after exit |
| `term.input`, `term.resize`, `term.detach` | Send text, resize within bridge bounds, detach on screen exit |
| `diff.files`, `diff.file` | Preserve the bridge's `branch` or `working` scope |
| `task.create`, `task.land`, `task.delete` | Use bridge guards; never send force-delete |

The six task groups are `waiting-on-you`, `landing`, `ready-for-review`, `working`, `idle`, `unknown`. As in iOS's default attention sort, main tasks and pinned tasks float first, then group and server rank; ties keep server order. Unknown additive fields are ignored and future groups display as unknown.

The demo resolver consumes the iOS fixture directly. Reconnects never replay user mutations. The app fails pending requests on disconnect, then re-subscribes and reattaches after a new `hello`. HTTP 401 and 403 require re-pairing.

## Tests and screenshots

`./scripts/verify.sh` builds the APK and runs Android Lint, domain/protocol tests, MockWebServer integration tests, and Paparazzi Compose screenshot comparisons. The socket tests perform real localhost upgrades, check bearer authentication, close sockets during requests, observe reconnects, and test authorization failure and explicit disconnect.

The repository's CI does not build Android yet; run `verify.sh` locally or on allen before trusting a change.

Screenshot baselines live under `packages/rove-android/app/src/test/snapshots/images/`. Regenerate with `./gradlew :app:recordPaparazziDebug`; inspect the resulting images before accepting them. These are Compose render tests, not emulator or real bridge evidence.

### Emulator screenshots on allen

Every UI change also needs real emulator frames. Paparazzi does not run WebView, the IME or rotation. Push the branch first, because allen's script builds from GitHub:

```sh
git push origin feat/android-client
ssh allen '/bin/zsh -lc "~/bin/rove_android_shots.sh feat/android-client 40"'
scp -r allen:~/ci/shots/android/<sha> /tmp/android-shots/
```

The script builds the APK and runs the unit tests. It opens demo mode and taps through every screen breadth-first, in light and dark mode. Where a screen has a text field, it takes an extra frame with the keyboard up. It then takes a few landscape frames and collects the crash log. Results go to `index.json`.

Debug builds leave out `FLAG_SECURE`. With it set, every screencap comes back black. Release builds keep it.

Known gaps:

- `index.json` is written only after the landscape pass, so an interrupted run leaves none.
- A full 40-screen run can take more than an hour, because every screen is reached by relaunching the app and replaying taps. Run it with `nohup`.
- It does not detect black frames.
- The landscape pass locks rotation with `wm user-rotation lock 1` and unlocks it in a `finally`; boot also unlocks it, in case an earlier run was killed. `settings put system user_rotation` is not enough on API 35, because launching an activity resets it. The crawler warns if any `landscape/` frame comes out portrait.
- It never sees screens that need a live bridge: real pairing errors, the reconnect banner, a terminal that has exited, and confirmed land/delete.
- It skips land and delete on purpose.
- The crash log can hold `uiautomator`'s own crash (`registerUiTestAutomationService` NPE). That is the crawler, not the app; check the process before blaming the APK.

## Terminal key row

The key row matches iOS `KeyRow`. It has the same keys in the same order: `esc enter ↑ ↓ tab shift+tab ctrl ← → ctrl+c`, a divider, then `interrupt`, `continue` and `yes`. It sits above the composer and shows `done` while the keyboard is up. `ctrl` is sticky as on iOS: one tap arms it, the next typed letter becomes its control byte, any other key disarms it, and a second tap turns it off. Query replies that xterm.js emits (DA1/DA2, DECRQM, OSC colour) are dropped before they reach the PTY or use up a pending ctrl (iOS `QueryReplyFilter`).

## Live bridge check on allen

Run against the Mac's real Cloudflare bridge, pairing from `~/ci/rove-android-pair.json` on allen. Mutations went only to throwaway tasks in `/tmp/rove-android-live/repo`. Their engine was a script that logs every byte its PTY receives, so key checks compare the bytes that arrived. Frames are in `docs/assets/reviews/android-live/`.

Passed:

- **Pairing.** Deep link with the Cloudflare headers connects. A wrong CF secret or a wrong token shows "pairing refused" and does not retry. Pairing survives a forced process kill. **Forget pairing** returns to the pairing screen after a relaunch. No token or CF credential appears in plaintext in the app's data directory.
- **Terminal input.** Typed text and hardware Enter arrive. Key-row bytes: `esc` `\x1b`, `enter` `\r`, arrows `\x1b[A/B/C/D`, `tab` `\t`, `shift+tab` `\x1b[Z`, `ctrl+c` `\x03`. Ctrl+c gives `\x03`, ctrl+dx gives `\x04x`, ctrl then esc gives `\x1b` followed by a plain `a`, and ctrl twice gives a plain `b`. The `continue`/`yes` chips send the text, then `\r`. A one-line composer message is sent as typed. A multi-line message goes as one bracketed paste, then `\r`. `done` hides the keyboard. `interrupt` shows the daemon's answer.
- **Output.** Replay plus live output on attach. Tab switching replays each tab's own history, and input reaches only the selected tab. In airplane mode the screen shows "disconnected · input paused" and input is dropped; when the network returns the app reattaches and input flows again. PTYs stay alive after the app detaches.
- **Tasks.** Create a task and a tab from the app. As on iOS, a tab needs a first message. The real diff shows the file list and the file. Both delete confirmations can be cancelled; a clean delete removes the task, and a dirty one shows `DIRTY_WORKTREE` with the file names.
- **Notifications.** **settings → notifications** asks for permission. After a denial it offers **open android settings**, and the tile clears on return. With the app in the foreground, working → idle posts "finished working". With the toggle off, nothing is posted.
- **Rotation.** The open screen survives rotation. The terminal, key row and composer work in landscape.

Not passed or not automatable:

- **Landscape typing straight into the terminal.** xterm's textarea has focus and the IME reports shown, but neither IME text nor raw key events reach the page on the emulator. The key row and composer work in landscape. Needs a real device to tell an emulator artifact from an app bug.
- **Background notifications.** Android freezes the backgrounded process within seconds, so nothing arrives until the app is reopened. This is expected without FCM or a foreground service.
- **Needs a real device:** QR scanning, camera denial, IME composition (pinyin; `adb input text` sends ASCII only), and the direct path (the emulator cannot reach the Mac's loopback bridge).
- **Not run:** Fit vs Watch against the desktop, alternate screen and scrollback, and split Unicode bytes beyond the CJK/emoji banner rendering correctly.

This draft does not change desktop shortcuts. Publishing this page through the docs site's sync list is deferred because this task is restricted to the Android package and this document.
