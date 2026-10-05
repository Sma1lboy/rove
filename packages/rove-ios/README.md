# Rove Mobile (iOS)

SwiftUI remote control for the Rove daemon. Talks only to `rove-bridge` over one WebSocket
(protocol: `packages/rove-bridge`). iOS 17+, iPhone, simulator builds.

```sh
brew install xcodegen          # once
cd packages/rove-ios
xcodegen generate              # creates RoveMobile.xcodeproj (git-ignored)
xcodebuild -scheme RoveMobile -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build test
```

Pair by pasting `ws://host:7878/?token=…` (or `rove://pair?url=…`) in the first screen, or scan the QR on a device.

Notes:
- The bridge is plain `ws://` on LAN/Tailscale, so Info.plist sets `NSAllowsArbitraryLoads`.
- SwiftTerm is pinned to 1.18.0: 1.19+ adds a build-tool plugin that `xcodebuild` refuses without `-skipPackagePluginValidation`.
