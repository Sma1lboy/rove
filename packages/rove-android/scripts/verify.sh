#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci --prefix web --ignore-scripts --no-audit --no-fund
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:verifyPaparazziDebug
