# Rove for Android

Native Kotlin and Jetpack Compose client for the existing Rove bridge. Android 8.0 (API 26) or newer. This is a draft MVP; device acceptance runs on allen.

## Build and check

Install JDK 17, Android SDK platform 35 and build-tools 35.0.0. Set `JAVA_HOME` and `ANDROID_HOME`, then run:

```sh
./scripts/verify.sh
```

The script installs the pinned terminal assets, builds the debug APK, runs protocol and real WebSocket tests, checks Android Lint, and compares Compose screenshots. The APK is `app/build/outputs/apk/debug/app-debug.apk`. No release signing configuration is included.

For an intentional visual update, run `./gradlew :app:recordPaparazziDebug`, inspect `app/src/test/snapshots/images`, and then run the verification script. Reports are in `app/build/reports/`.

## Structure

- `domain` defines task rows, stable iOS attention ordering, notification transitions, and reconnect policy.
- `data` owns protocol JSON, OkHttp, the typed `RoveRepository` over bridge ops, the terminal attachment session, Keystore encryption, demo resolution, and Android notifications.
- `ui` owns the ViewModel and Compose screens.

Compose calls typed `RoveRepository` methods and consumes domain rows; it never builds or decodes a bridge frame. `TerminalSession` owns attachment and detachment; it never starts a PTY. App actions use the bridge's existing allowlist.

### Terminal choice

xterm.js already handles ANSI control sequences, alternate screens, Unicode, selection, and streaming byte decoding. A WebView lets Android share that renderer without implementing a terminal emulator or depending on a terminal View's private APIs. The Compose shell and keyboard remain native.

The pinned xterm.js 5.5.0 and fit-addon 0.10.0 assets are copied into the APK at build time, with no CDN or runtime download. `WebViewAssetLoader` serves them from an app-only HTTPS origin. File access, content access, external navigation and network loads are disabled. PTY bytes reach `terminal.write(Uint8Array)` as base64 so split UTF-8 bytes survive. Terminal output is never inserted as HTML or evaluated as code.

Fit resizes the shared PTY and can reflow the desktop terminal. Watch stops sending resize requests; local wrapping can differ from the desktop because the current attach response does not expose the PTY size. Terminal scrollback is capped at 2,000 lines.

### Pairing and local data

Paste or scan the bridge URL. `preset=cf` selects Cloudflare; `none`, `tailscale`, or no preset select direct. Cloudflare requires `wss` and both Access fields. `rove://pair?url=…` links fill the form but never connect without a tap.

The token and preset are removed before the HTTP upgrade. The token travels in `Authorization: Bearer`; Access credentials travel in their named headers. Redirects are disabled. Keystore holds the AES-GCM key; private preferences hold only ciphertext. Android backups are disabled, and app windows block screenshots and the recents preview. No credentials are logged or stored in saved Compose state.

Direct `ws` is allowed for local development and Tailscale, matching iOS. It relies on the chosen network for transport encryption. Use `wss` for Internet endpoints.

A failed request is not replayed. After losing a connection during a mutation, check the task's state before retrying. Authorization refusals stop reconnecting. Other failures back off from 500 ms to 30 seconds. A successful handshake restores task subscriptions and the selected terminal attachment.

### Demo

`try a demo` resolves the **same file** used by iOS:
`../rove-ios/Sources/RoveMobile/Demo/demo-fixture.json`.
Gradle copies it into generated assets; there is no second fixture to maintain. The resolver understands selectors, aliases, relative timestamps and base64 text. Demo mode never opens a socket, saves pairing data, or posts notifications. Fixture writes return canned replies; they do not simulate persistent task mutations.

### Notifications

Tap `notifications` to grant Android 13+ permission. The app posts local notifications for the same task transitions as iOS and suppresses the initial/reconnect snapshot. They work while the app process and socket are running. There is no foreground service or FCM delivery after Android suspends the app.

## Acceptance

See [Android build and integration guide](../../docs/ANDROID.md) for allen, protocol details and the remaining device checks. Extra control buttons are proposed Android placements, pending owner review; desktop chords are unchanged.

## Dependencies

The build pins AGP 8.10.1, Gradle 8.11.1, Kotlin 2.1.21 and Compose BOM 2025.04.01. The Gradle distribution checksum is checked by the wrapper. The toolchain follows the [AGP 8.10 compatibility table](https://developer.android.com/build/releases/agp-8-10-0-release-notes) and [Compose compiler plugin setup](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler).

xterm.js and addon-fit are MIT licensed; their notices are bundled under `terminal/licenses/`. OkHttp is Apache-2.0; ZXing Android Embedded is Apache-2.0; Paparazzi is Apache-2.0. The app icon is the supplied Rove chip asset.
