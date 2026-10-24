# Rove mobile apps: privacy policy

This policy covers Rove for Android (`run.rove.mobile`) and Rove for iOS. Both apps are remote controls for Rove, a coding-agent tool that runs on your own computer. Last updated 24 October 2026.

## Data received by Rove developers

The apps have no Rove accounts, analytics, advertising, crash reporting or tracking. They do not send your data to Rove developers. They do transmit data to your chosen bridge as described below.

## What the app sends, and where

The app talks only to `rove-bridge`, a server you start on your own computer. You choose its address when you pair, by scanning the QR code the bridge prints or by pasting its link. Over that connection the app sends what you type, the files you attach, and the task actions you take, and it receives your tasks, terminal output and diffs. The pairing token and any Cloudflare Access headers authenticate this connection. None of this traffic passes through a server run by Rove. If you use Cloudflare, traffic passes through its infrastructure. Agents on your computer may send input and attachments to providers you configure; those providers have their own policies.

The connection is as private as the network path you pick. Cloudflare pairing uses encrypted `wss://`. Direct pairing over the same Wi-Fi or Tailscale can use plain `ws://`; Tailscale encrypts that traffic itself, and a local Wi-Fi network does not.

## What stays on your phone

- The pairing link, its token and any Cloudflare Access headers. On Android they are encrypted with a key held in the Android Keystore, and Android backups are turned off for the app. On iOS they are kept in the Keychain.
- Notification settings and screen state.

Settings → bridge → **forget pairing** deletes saved pairing data. On Android, uninstalling also removes the app's local data. On iOS, use **forget pairing** before uninstalling: Keychain credentials can survive uninstall and be loaded again after reinstall. [Apple does not guarantee Keychain deletion on uninstall](https://developer.apple.com/forums/thread/36442).

Forgetting pairing or uninstalling does not delete files, task history or data held on your computer or by providers you configured. Manage that data on your computer and with those providers.

## Permissions

- **Camera**: only to scan the pairing QR code. Nothing is recorded or stored. Pasting the link works without it.
- **Notifications**: local notifications when one of your tasks changes state while the app is running. There is no push service.
- **Network**: only to reach your own bridge.

## Demo mode

**try a demo** runs on sample data built into the app. It makes no network requests and saves nothing.

## Children

The apps are developer tools meant for adults. They are not directed at children.

## Changes and contact

Changes to this policy are made in this file, and its history is public in the repository. For questions, open an issue at <https://github.com/Sma1lboy/rove/issues>.
