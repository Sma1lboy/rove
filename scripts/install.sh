#!/usr/bin/env sh
set -eu

# One-step install for Rove, for a machine that has nothing yet.
#
#   curl -fsSL https://rove.run/install.sh | sh
#   curl -fsSL https://rove.run/install.sh | sh -s -- 0.8.136   # pin
#
# Rove's CLI is a Bun program, so this script installs Bun first when the
# machine has none, then installs the package with it. Updating later is
# `rove update` (scripts/update.sh), which reuses whichever package manager
# owns the binary on PATH.
PACKAGE="@sma1lboy/rove"
LEGACY_PACKAGE="@sma1lboy/kobe"
VERSION="${1:-}"

# Oldest Bun Rove runs on. Must match `engines.bun` in packages/kobe/package.json
# and MIN_BUN_VERSION in packages/kobe/src/cli/bun-runtime.ts — the three are
# held together by test/architecture/bun-version-floor.test.ts.
#
# Checked because nobody else checks it: `bun install` ignores `engines`
# outright, so a machine with an old Bun installs Rove cleanly and then runs a
# build whose terminal tabs are silently dead (Bun's PTY spawn option arrived
# in 1.3.11; older Bun drops it without an error).
MIN_BUN="1.3.11"

if [ -t 1 ]; then
  BOLD='\033[1m'
  ACCENT='\033[38;2;204;120;92m'
  GREEN='\033[32m'
  RED='\033[31m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  BOLD='' ACCENT='' GREEN='' RED='' DIM='' RESET=''
fi

say() { printf '%b\n' "$1"; }
die() { printf '%berror: %b%b\n' "$RED" "$1" "$RESET" >&2; exit 1; }

# `bun --version` reduced to a bare x.y.z (it can carry a `-canary…` tail).
bun_version_of() {
  "$1" --version 2>/dev/null | head -n 1 | tr -d '\r' | sed 's/^v//; s/[^0-9.].*$//'
}

# Prints 1 when $1 is older than $2, else 0. awk because `sort -V` is GNU-only
# and this script has to run on macOS's BSD userland too.
version_older() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, x, "."); split(b, y, ".")
    for (i = 1; i <= 3; i++) {
      av = x[i] + 0; bv = y[i] + 0
      if (av < bv) { print 1; exit }
      if (av > bv) { print 0; exit }
    }
    print 0
  }'
}

printf '%b\n' \
  "${ACCENT}${BOLD}██████╗  ██████╗ ██╗   ██╗███████╗" \
  "██╔══██╗██╔═══██╗██║   ██║██╔════╝" \
  "██████╔╝██║   ██║██║   ██║█████╗" \
  "██╔══██╗██║   ██║╚██╗ ██╔╝██╔══╝" \
  "██║  ██║╚██████╔╝ ╚████╔╝ ███████╗" \
  "╚═╝  ╚═╝ ╚═════╝   ╚═══╝  ╚══════╝${RESET}" \
  "${DIM}many sessions. one terminal.${RESET}" \
  ""

case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux | Darwin | *BSD) ;;
  MINGW* | MSYS* | CYGWIN*)
    die "this script needs a POSIX shell. On Windows install Bun and Rove with npm:\n  npm install -g bun\n  npm install -g ${PACKAGE}"
    ;;
  *) say "${DIM}unrecognised platform — continuing anyway${RESET}" ;;
esac

command -v git >/dev/null 2>&1 || say "${DIM}note: git is not on PATH — Rove needs it to create task worktrees${RESET}"

# 1. Bun — the runtime Rove itself executes under.
BUN="$(command -v bun 2>/dev/null || true)"
if [ -z "$BUN" ] && [ -x "${BUN_INSTALL:-$HOME/.bun}/bin/bun" ]; then
  BUN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
fi

if [ -z "$BUN" ]; then
  say "${BOLD}Installing Bun${RESET} ${DIM}(Rove's runtime — https://bun.sh)${RESET}"
  command -v curl >/dev/null 2>&1 || die "curl is required to install Bun"
  command -v unzip >/dev/null 2>&1 || say "${DIM}note: Bun's installer wants unzip; install it if the next step fails${RESET}"
  curl -fsSL https://bun.sh/install | bash || die "Bun install failed — install it manually from https://bun.sh, then re-run this script"
  BUN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
  [ -x "$BUN" ] || die "Bun installed but no binary at $BUN"
  say ""
else
  say "${DIM}bun found: ${BUN} ($(bun_version_of "$BUN"))${RESET}"
fi

# 1b. …and new enough. A Bun below MIN_BUN installs Rove without complaint and
# then runs it with dead terminals, so this is the last place to catch it before
# the user hits that. Bun that installed itself is upgraded in place; a Bun
# owned by Homebrew/npm/asdf is left alone — upgrading someone else's package
# manager's package behind their back is not this script's call.
BUN_VERSION="$(bun_version_of "$BUN")"
if [ -n "$BUN_VERSION" ] && [ "$(version_older "$BUN_VERSION" "$MIN_BUN")" = "1" ]; then
  BUN_PREFIX="${BUN_INSTALL:-$HOME/.bun}"
  case "$BUN" in
    "$BUN_PREFIX"/*)
      say "${BOLD}Upgrading Bun${RESET} ${DIM}(${BUN_VERSION} is older than the ${MIN_BUN} Rove needs)${RESET}"
      "$BUN" upgrade >/dev/null 2>&1 || true
      BUN_VERSION="$(bun_version_of "$BUN")"
      [ -n "$BUN_VERSION" ] && [ "$(version_older "$BUN_VERSION" "$MIN_BUN")" = "0" ] ||
        die "bun is still ${BUN_VERSION:-unknown} after \`bun upgrade\` — Rove needs ${MIN_BUN}.\n  Upgrade it by hand, then re-run this script."
      say "${DIM}bun upgraded to ${BUN_VERSION}${RESET}"
      ;;
    *)
      die "bun ${BUN_VERSION} at ${BUN} is too old — Rove needs ${MIN_BUN} or newer.\n\n  Rove's terminals use Bun's PTY API; on an older Bun every terminal and\n  engine tab opens empty and stays empty.\n\n  Upgrade it, then re-run this script:\n    brew upgrade bun            # Homebrew\n    npm install -g bun@latest   # npm-managed Bun\n    curl -fsSL https://bun.sh/install | bash   # Bun's own installer"
      ;;
  esac
fi

BUN_BIN_DIR="$(dirname "$BUN")"

# 2. Rove. Both packages own the `rove` and `kobe` bin names, so an install
# on top of the pre-rename package dies with EEXIST — clear it first.
if [ -d "${BUN_INSTALL:-$HOME/.bun}/install/global/node_modules/${LEGACY_PACKAGE}" ]; then
  say "${DIM}removing the pre-rename ${LEGACY_PACKAGE} first${RESET}"
  "$BUN" remove -g "$LEGACY_PACKAGE" >/dev/null 2>&1 || true
fi

say "${BOLD}Installing ${PACKAGE}${VERSION:+@$VERSION}${RESET}"
"$BUN" install -g "${PACKAGE}@${VERSION:-latest}" >/dev/null 2>&1 ||
  die "install failed — retry with output: ${BUN} install -g ${PACKAGE}@${VERSION:-latest}"

# 3. Report, and say exactly what to add to PATH when the bin dir is missing.
hash -r 2>/dev/null || true
if command -v rove >/dev/null 2>&1; then
  say "${GREEN}✓ $(rove -v 2>/dev/null || echo 'rove installed')${RESET}"
  say ""
  say "Next: ${BOLD}cd${RESET} into a git repo and run ${BOLD}rove${RESET}."
elif [ -x "${BUN_BIN_DIR}/rove" ]; then
  say "${GREEN}✓ $(PATH="${BUN_BIN_DIR}:$PATH" "${BUN_BIN_DIR}/rove" -v 2>/dev/null || echo 'rove installed')${RESET}"
  say ""
  say "${BOLD}${BUN_BIN_DIR} is not on your PATH yet.${RESET} Add it, then reopen your shell:"
  say "  echo 'export PATH=\"${BUN_BIN_DIR}:\$PATH\"' >> ~/.$(basename "${SHELL:-sh}")rc"
else
  die "installed, but no rove binary landed in ${BUN_BIN_DIR}"
fi

say ""
say "${DIM}Rove needs at least one agent CLI on PATH (claude, codex, copilot, kimi).${RESET}"
say "${DIM}Update later with: rove update${RESET}"
