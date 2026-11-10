# Play Console notes (draft)

Answers to paste into Play Console for the first internal test and for review. Check the wording before each submission; nothing here is sent automatically. The iOS counterpart is `packages/rove-ios/docs/REVIEW_NOTES.md`.

## App access (for reviewers)

Rove is a remote control for Rove, a coding-agent tool that runs on the user's own Mac. The app shows the user's tasks, the agents' terminals and their diffs, and lets them reply from the phone.

No Mac is needed to review it. On the first screen tap **try a demo**. The app then runs on sample data built into it:

- Task list: five sample tasks, grouped by what needs the user. Tap one to open it.
- Task detail: a terminal replay of a Codex or Claude session, with the key row under it. `diff` in the header lists the changed files; tap a file to read its diff.
- Bell icon: the inbox of items that need a reply.
- Grid icon: board, routines, GitHub issues and worktrees.
- Gear icon: settings, usage meters, engines and plugins.

Actions such as new task, land, send and delete answer "success" locally and change nothing. A strip at the top of every screen reads `demo · not connected to a mac`. The demo is not saved: relaunch the app and it is back on the first screen.

In Play Console → App access, choose "All or some functionality is restricted" and paste the paragraph above. No login is needed, so leave the credentials fields empty.

## What the app is

A client for `rove-bridge`, a small server a person starts on their own Mac. The phone pairs with it by scanning the QR code the bridge prints, or by pasting its link. There are no accounts, no sign-up and no login. The pairing link carries a token for the user's own bridge.

## Permissions

| Permission | Why |
| --- | --- |
| `INTERNET` | Reach the user's own bridge. The app contacts no other server. |
| `CAMERA` | Scan the pairing QR code only. Nothing is recorded or stored. Optional: pasting the link works without it. |
| `POST_NOTIFICATIONS` | Local notifications when a task changes state while the app is open. No push service. |

## Cleartext traffic

`usesCleartextTraffic` is `true` because **direct** pairing connects with `ws://` to the user's Mac over the same Wi-Fi or Tailscale. Those addresses are the user's own LAN or tailnet IPs, so no domain list can cover them. Cloudflare pairing requires `wss://`. The pairing screen says to use `wss` for Internet endpoints.

## Data safety form

The release owner must review the actual flows below before submitting the form. Internal-only apps are exempt from the form; an internal-test upload does not validate these declarations. See [Google Play's Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en-EN).

- **Collection:** declare off-device input, attachments and task actions for app functionality. User ownership of the destination is not an exemption.
- **Data types:** replies are other in-app messages; task titles, descriptions and commands are other user-generated content; task actions are app interactions. Supported attachments are images and PDFs, corresponding to photos and files/documents. Review authentication identifiers against the form's categories before submission.
- **Handling:** attachments are optional. Sending input and actions is needed for remote control. Data can persist on the Mac in files or agent history, so do not claim all processing is ephemeral.
- **Sharing:** assess routing separately from collection. Transfers explicitly requested by the user may qualify for the user-initiated sharing exception. Confirm any intermediary's role and processing before declaring no sharing.
- **Exemptions:** local-only processing is exempt. End-to-end encryption qualifies only when intermediaries cannot read the data. Cloudflare TLS alone does not establish that. The external-storage example requires the app never to access the data; Rove reads input and attachments.
- **Encryption in transit:** answer "no" for the current app, which permits plain `ws://` on a LAN. This declaration covers the whole app. Cloudflare uses `wss://`; Tailscale encrypts its network traffic, but neither protects every supported connection.
- **Pairing credentials:** saved locally with an Android Keystore AES-GCM key and excluded from Android backup. The token and any Cloudflare Access headers are also sent to authenticate the connection.
- **Deletion:** settings → bridge → **forget pairing** removes saved pairing credentials. Uninstalling removes Android app-local data. Neither action deletes files or history on the Mac or downstream services.
- **Analytics, ads, crash reporting:** none in the app.

## Privacy policy

Play requires a public privacy policy URL even when no data is collected. The policy is `docs/PRIVACY.md`, entered in Play Console as <https://github.com/Sma1lboy/rove/blob/main/docs/PRIVACY.md>. That URL works once this file is on `main`. Keep it in line with the Data safety answers above.

Play's User Data policy also requires the policy inside the app. Settings → about → **privacy policy** shows the same file: Gradle copies `docs/PRIVACY.md` into the APK, so it reads without a paired bridge, offline and in demo mode. `PolicyTextTest` checks that the bundled file reads as plain text.

## Third-party code

xterm.js and addon-fit (MIT), OkHttp (Apache-2.0), ZXing Android Embedded (Apache-2.0). Fonts: Maple Mono NF and JetBrains Mono (SIL OFL 1.1), credited under settings → about.

## Store listing

Still to make: a short and a full description, a 512×512 icon, a 1024×500 feature graphic and at least two phone screenshots. Take the screenshots in demo mode on a debug build. Release builds set `FLAG_SECURE`, so every capture of them comes back black; debug builds leave it out and otherwise look the same.
