#!/bin/bash
# Install a packed @sma1lboy/rove tarball on a clean Linux box — no C/C++
# toolchain — and drive one real PTY session through it.
#
# This is the install a new user (or a fresh WSL distro, or a `rove machine
# add` target) actually gets. node-pty is Windows-only at runtime and ships no
# linux prebuild; while it was a hard dependency, `npm i -g` died here
# compiling it. CI runs this inside a bare `ubuntu:24.04` container
# (ci.yml `clean-linux-install`); locally:
#
#   (cd packages/rove && npm pack --pack-destination /tmp)
#   docker run --rm -v /tmp:/pkg -v "$PWD/scripts:/s:ro" ubuntu:24.04 \
#     bash /s/clean-linux-install.sh /pkg/sma1lboy-rove-<version>.tgz
#
# Usage: clean-linux-install.sh <rove tarball>
set -euo pipefail

TARBALL=${1:?usage: clean-linux-install.sh <rove tarball>}
NODE_VERSION=${NODE_VERSION:-22.23.3}

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# Runtime prerequisites only. No build-essential, make, gcc or g++: the point
# is to prove the install does not need them.
apt-get install -y -qq --no-install-recommends ca-certificates curl git unzip xz-utils python3 >/dev/null
for cc in cc gcc g++ c++ make; do
  if command -v "$cc" >/dev/null; then
    echo "::error::$cc is on PATH — this check must run without a toolchain"
    exit 1
  fi
done

curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" |
  tar -xJ --strip-components=1 -C /usr/local
curl -fsSL https://bun.sh/install | bash >/dev/null
export PATH="$HOME/.bun/bin:$PATH"

echo "--- npm i -g $(basename "$TARBALL")"
npm i -g "$TARBALL"
rove --version

echo "--- one PTY session through the installed CLI"
export ROVE_HOME_DIR
ROVE_HOME_DIR=$(mktemp -d)
repo=$(mktemp -d)
git -C "$repo" init -q
git -C "$repo" -c user.name=ci -c user.email=ci@localhost commit -q --allow-empty -m init

# `sh -c` as the engine runs the prompt as a shell command in the task's PTY;
# the output comes back in `reason` once the command exits.
out=$(rove api add --repo "$repo" --title smoke --command "sh -c" \
  --prompt 'echo PTY_OK $(uname -s); sleep 5' 2>&1 || true)
task=$(printf '%s' "$out" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0)).taskId??"")}catch{}')
[ -n "$task" ] && out="$out$(rove api read-output --task-id "$task" 2>&1 || true)"
rove daemon stop >/dev/null 2>&1 || true

if ! printf '%s' "$out" | grep -q "PTY_OK Linux"; then
  echo "::error::no PTY output from the installed CLI"
  printf '%s\n' "$out" | head -c 4000
  exit 1
fi
echo "PTY_OK Linux"
