#!/bin/sh
# Builds the macOS dmgs signed with a Developer ID and notarized, then uploads them to the rolling
# `desktop` release. Run on a Mac that holds the certificate; the keys never leave that machine.
#
#   ASC_KEY_ID, ASC_ISSUER_ID   App Store Connect API key (the .p8 sits in ~/.appstoreconnect/private_keys)
#   KEYCHAIN_PASSWORD           optional: unlocks the login keychain, which codesign needs over SSH
#   --no-upload                 build and verify only
set -eu

: "${ASC_KEY_ID:?set ASC_KEY_ID}" "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"
key="$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
[ -f "$key" ] || { echo "missing $key" >&2; exit 1; }

identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)
[ -n "$identity" ] || { echo "no Developer ID Application certificate in the keychain" >&2; exit 1; }
[ -z "${KEYCHAIN_PASSWORD:-}" ] || security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$HOME/Library/Keychains/login.keychain-db"

cd "$(dirname "$0")/.."
ROVE_DESKTOP_ELECTRON=1 bun install --frozen-lockfile
bun run build
rm -rf release
# electron-builder notarizes and staples the .app before it makes the dmg.
APPLE_API_KEY="$key" APPLE_API_KEY_ID="$ASC_KEY_ID" APPLE_API_ISSUER="$ASC_ISSUER_ID" \
  bunx electron-builder --mac --publish never \
  -c.mac.identity="${identity#Developer ID Application: }" -c.mac.hardenedRuntime=true -c.mac.notarize=true

for app in release/mac*/Rove.app; do
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose "$app"
done
ls -l release/*.dmg

[ "${1:-}" = "--no-upload" ] || gh release upload desktop release/Rove-mac-arm64.dmg release/Rove-mac-x64.dmg --clobber --repo Sma1lboy/rove
