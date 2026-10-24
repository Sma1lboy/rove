# Rove mobile apps: privacy policy

This policy covers Rove for Android (`run.rove.mobile`) and Rove for iOS. Both apps are remote controls for Rove, a coding-agent tool that runs on your own computer. Last updated 24 October 2026.

## What we collect

Nothing. The apps have no accounts, analytics, advertising, crash reporting or tracking, and they never send data to the developers of Rove or to any third party.

## What the app sends, and where

The app talks only to `rove-bridge`, a server you start on your own computer. You choose its address when you pair, by scanning the QR code the bridge prints or by pasting its link. Over that connection the app sends what you type, the files you attach, and the task actions you take, and it receives your tasks, terminal output and diffs. All of it goes between your phone and your computer. None of it passes through a server run by Rove.

The connection is as private as the network path you pick. Cloudflare pairing uses encrypted `wss://`. Direct pairing over the same Wi-Fi or Tailscale can use plain `ws://`; Tailscale encrypts that traffic itself, and a local Wi-Fi network does not.

## What stays on your phone

- The pairing link, its token and any Cloudflare Access headers. On Android they are encrypted with a key held in the Android Keystore, and Android backups are turned off for the app. On iOS they are kept in the Keychain.
- Notification settings and screen state.

Settings → bridge → **forget pairing** deletes the pairing data, and uninstalling the app deletes everything.

## Permissions

- **Camera**: only to scan the pairing QR code. Nothing is recorded or stored. Pasting the link works without it.
- **Notifications**: local notifications when one of your tasks changes state while the app is running. There is no push service.
- **Network**: only to reach your own bridge.

## Demo mode

**try a demo** runs on sample data built into the app. It makes no network requests and saves nothing.

## Children

The apps are developer tools meant for adults. They are not directed at children and collect no data from anyone.

## Changes and contact

Changes to this policy are made in this file, and its history is public in the repository. For questions, open an issue at <https://github.com/Sma1lboy/rove/issues>.
