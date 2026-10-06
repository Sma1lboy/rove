# Beta review notes (draft)

Text to paste into App Store Connect for TestFlight external testing. Review the wording
before each submission; nothing here is sent automatically.

## What to Test

Rove is a remote control for Rove, a coding-agent tool that runs on your own Mac. The app shows
your tasks, the agents' terminals and their diffs, and lets you reply from your phone.

You do not need a Mac to try it. On the first screen tap **try a demo** (small grey text under the
connect button). The app then runs on sample data built into it:

- Task list: five sample tasks, grouped by what needs you. Tap one to open it.
- Task detail: a terminal replay of a Codex or Claude session, with the key row under it. `diff`
  in the header lists the changed files; tap a file to read its diff.
- Bell icon: the inbox of items that need a reply.
- Grid icon: board, routines, GitHub issues and worktrees.
- Gear icon: settings, usage meters, engines and plugins.

Actions such as new task, land, send and delete answer "success" locally and change nothing.
A strip at the top of every screen reads `demo · not connected to a mac`. **connect a mac** in the
strip leaves the demo and returns to the pairing screen. The demo is not saved: relaunch the app
and you are back on the first screen.

## Review notes

- **What the app is.** A client for `rove-bridge`, a small server a person starts on their own Mac.
  The phone pairs with it by scanning the QR code the bridge prints, or by pasting its link.
  Without a Mac there is nothing to pair with, so the demo above is the way to review the app.
- **Accounts.** None. There is no sign-up and no login. The pairing link carries a token for the
  user's own bridge.
- **Camera.** Used only to scan the pairing QR code. Nothing is recorded or stored.
- **Local network.** Used only to reach the user's own Mac, over the local network, Tailscale or a
  Cloudflare tunnel they set up. The app contacts no other server.
- **Demo mode.** Makes no network requests at all. It answers from a file inside the app.
- **Data.** The pairing (link and token) is kept in the iOS Keychain on the device. There are no
  analytics and no ads. The only third-party code is SwiftTerm, an open-source terminal view.
- **Encryption.** No cryptography of its own. Connections use the system networking stack (wss when
  the bridge sits behind Cloudflare). `ITSAppUsesNonExemptEncryption` is `false`.
