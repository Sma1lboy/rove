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

- **Data collected:** none. The app sends nothing to the developer or to any third party.
- **Data shared:** none.
- **What stays on the device:** the pairing link, token and Cloudflare Access headers, encrypted with an Android Keystore AES-GCM key. Android backups are off, so it never leaves the device.
- **What goes to the user's own Mac:** what the user types, attachments they pick, and task actions. This is the user's own server, not the developer's, so Play does not count it as collection. It travels over the transport the user chose (Cloudflare `wss`, or Tailscale/LAN).
- **Encryption in transit:** answer "yes" only if Play asks about the Cloudflare path; direct pairing relies on the user's network.
- **Deletion:** settings → bridge → **forget pairing** removes everything, as does uninstalling.
- **Analytics, ads, crash reporting:** none.

## Privacy policy

Play requires a public privacy policy URL even when no data is collected. The policy is `docs/PRIVACY.md`, entered in Play Console as <https://github.com/Sma1lboy/rove/blob/main/docs/PRIVACY.md>. That URL works once this file is on `main`. Keep it in line with the Data safety answers above.

## Third-party code

xterm.js and addon-fit (MIT), OkHttp (Apache-2.0), ZXing Android Embedded (Apache-2.0). Fonts: Maple Mono NF and JetBrains Mono (SIL OFL 1.1), credited under settings → about.

## Store listing

Still to make: a short and a full description, a 512×512 icon, a 1024×500 feature graphic and at least two phone screenshots. Take the screenshots in demo mode on a debug build. Release builds set `FLAG_SECURE`, so every capture of them comes back black; debug builds leave it out and otherwise look the same.
