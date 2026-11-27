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

Pair by pasting `http://host:7878/#token=…` (any link the bridge prints, or `rove://pair?url=…`) in the first
screen, or scan the QR on a device. In the simulator: `-pairLink <link>` as a launch argument.

Notes:
- The bridge is plain `ws://` on LAN/Tailscale, so Info.plist sets `NSAllowsArbitraryLoads`.
- SwiftTerm is pinned to 1.18.0: 1.19+ adds a build-tool plugin that `xcodebuild` refuses without `-skipPackagePluginValidation`.
