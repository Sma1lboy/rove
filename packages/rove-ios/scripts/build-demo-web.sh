#!/bin/bash
# Builds the in-app demo (rove-web on canned answers, rove-web/vite.demo.config.ts) into DemoWeb/, which the app
# bundles as a folder. Run by hand before building or archiving; Xcode only checks that the folder is there.
set -euo pipefail
cd "$(dirname "$0")/.."
out="$PWD/DemoWeb"
(cd ../rove-web && bunx vite build --config vite.demo.config.ts --outDir "$out" --emptyOutDir --logLevel warn)
