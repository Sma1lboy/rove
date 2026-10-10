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
- If interrupted, it leaves the emulator rotated (`user_rotation`).
- It never sees screens that need a live bridge: real pairing errors, the reconnect banner, a terminal that has exited, and confirmed land/delete.
- It skips land and delete on purpose.
- In the 5ab7de529 run, every `landscape/` frame was 1080×2400 (portrait): the rotation did not take effect before capture.
- The crash log can hold `uiautomator`'s own crash (`registerUiTestAutomationService` NPE). That is the crawler, not the app; check the process before blaming the APK.

## Device checks still required on allen

- Scan an actual pairing QR code; cancel/deny camera permission; open a `rove://pair` link.
- Connect through direct and Cloudflare paths. Deny Access, rotate the token, then re-pair.
- Verify encrypted pairing survives process death; disconnect and verify it is cleared.
- Type into a real engine using the keyboard and composer. Test IME composition, Enter, sticky Ctrl, Esc, Tab, Shift-Tab, arrows, Ctrl-C, keyboard show/hide and rotation.
- Test replay plus live output, split Unicode bytes, alternate screen, scrollback, tab switching and reconnect during output. Verify leaving a tab detaches without terminating its PTY.
- Compare Fit and Watch against the desktop. Fit intentionally resizes the shared PTY. Watch does not yet scale to the remote column count.
- Create a task and tab in a sandbox, inspect a real diff, cancel both destructive confirmation stages, and verify dirty-task deletion is refused.
- Turn notifications on in **settings → notifications**; the app asks for the Android 13+ permission there, not at launch. Grant/deny it and drive the required task transitions. Background delivery is best-effort while the process is alive; no FCM or foreground service is implemented.

The terminal control-row placement is proposed for owner acceptance. This draft does not change desktop shortcuts. Publishing this page through the docs site's sync list is deferred because this task is restricted to the Android package and this document.
