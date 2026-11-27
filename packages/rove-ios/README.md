# Rove Mobile (iOS)

A thin shell around rove-web: scan or paste the link `rove --web` prints and the app opens that page
full screen (`Sources/RoveMobile/Shell/`, see `docs/IOS.md`). The native screens are unused; `-nativeUI YES`
starts them. iOS 17+, iPhone, simulator builds.

```sh
brew install xcodegen          # once
cd packages/rove-ios
xcodegen generate              # creates RoveMobile.xcodeproj (git-ignored)
xcodebuild -scheme RoveMobile -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build test
```

**try a demo** on the first screen loads rove-web from the app bundle, on canned answers, with no network
(`Shell/DemoWeb.swift`, `rove-web/src/demo/`). That page is built output in `DemoWeb/` (git-ignored), and the
app won't build without it. Build it on a Mac with bun before building, and again before every archive,
since rove-web or the fixture may have changed:

```sh
scripts/build-demo-web.sh      # writes DemoWeb/; Xcode only checks it is there
```

The archive Mac needs no bun: copy the tree with `DemoWeb/` in it.

Pair by pasting `http://host:7878/#token=…` (any link the bridge prints, or `rove://pair?url=…`) in the first
screen, or scan the QR on a device. In the simulator: `-pairLink <link>` as a launch argument.

Notes:
- The bridge is plain `ws://` on LAN/Tailscale, so Info.plist sets `NSAllowsArbitraryLoads`.
- SwiftTerm is pinned to 1.18.0: 1.19+ adds a build-tool plugin that `xcodebuild` refuses without `-skipPackagePluginValidation`.
