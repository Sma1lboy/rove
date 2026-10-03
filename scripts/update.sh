#!/usr/bin/env sh
set -eu

# The product is Rove. `@sma1lboy/kobe` is the old package name, still
# published in lockstep, but this script moves everyone onto the new one:
# it's fetched fresh over curl on every run, so even a year-old install
# migrates itself the next time the user updates. Nothing is published
# solely to shepherd them across (no stub package, no deprecation shim).
PACKAGE="@sma1lboy/rove"
LEGACY_PACKAGE="@sma1lboy/kobe"

# Optional argument: `curl … | sh -s -- 0.7.90` installs that exact version,
# `… | sh -s -- nightly` installs the head of a channel (any npm dist-tag),
# `… | sh -s -- --list` prints recent published versions and exits.
#
# Both forms take the same `pkg@<arg>` slot in the install below — npm makes
# no distinction between a version and a dist-tag there. The only place they
# diverge is resolving what the target RESOLVES to, for the verify step.
VERSION="${1:-}"

if [ "$VERSION" = "--list" ]; then
  npm view "$PACKAGE" versions --json 2>/dev/null | sed 's/[][",]//g' | awk 'NF' | tail -n 20
  echo ""
  echo "install one with: rove update <version>"
  echo "            or:   curl -fsSL https://raw.githubusercontent.com/Sma1lboy/rove/main/scripts/update.sh | sh -s -- <version>"
  exit 0
fi

# Resolve a symlink chain to the real file. `readlink -f` is GNU-only —
# BSD/macOS readlink has no -f — so try realpath first, then GNU readlink,
# then walk the chain by hand with plain `readlink`. Prints the input
# unchanged when nothing resolves.
resolve_link() {
  target="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath "$target" 2>/dev/null && return 0
  fi
  if readlink -f "$target" >/dev/null 2>&1; then
    readlink -f "$target" 2>/dev/null && return 0
  fi
  # Hand-rolled walk for BSD readlink. Bounded so a symlink cycle can't
  # spin forever.
  hops=0
  while [ -L "$target" ] && [ "$hops" -lt 40 ]; do
    link="$(readlink "$target")" || break
    case "$link" in
      /*) target="$link" ;;
      *) target="$(dirname "$target")/$link" ;;
    esac
    hops=$((hops + 1))
  done
  # The hand-rolled walk leaves `bin/../lib` style segments behind. `cd -P`
  # collapses them using only POSIX builtins, so the derived prefix is a
  # real path and not one that merely resolves by luck.
  dir="$(dirname "$target")"
  base="$(basename "$target")"
  if cd -P "$dir" 2>/dev/null; then
    printf '%s/%s\n' "$(pwd -P)" "$base"
  else
    echo "$target"
  fi
}

# `rove` first: on a migrated install both commands exist, and the newer
# name is the one whose absence means "not migrated yet".
BIN="$(command -v rove 2>/dev/null || command -v kobe 2>/dev/null || true)"
BEFORE="$("${BIN:-false}" -v 2>/dev/null || true)"

# Update with the same package manager that owns the binary on PATH,
# otherwise the new version lands in another prefix and PATH keeps
# resolving the stale install (issue #205).
#
# Picking npm-vs-bun is not enough on its own: a machine can have several
# npm (nvm's and homebrew's, say), and `npm install -g` writes to the
# prefix of whichever *node* is executing it — NOT the prefix that owns
# the binary you just ran. So resolve the running binary back to its own
# prefix and pin the install there with `--prefix`, which overrides both
# npmrc and npm_config_prefix.
ENTRY=""
if [ -n "$BIN" ]; then
  ENTRY="$(resolve_link "$BIN")"
fi

PREFIX=""
case "$BIN$ENTRY" in
  */.bun/*) MANAGER="bun" ;;
  *)
    MANAGER="npm"
    # <prefix>/lib/node_modules/@scope/pkg/... -> <prefix>
    case "$ENTRY" in
      */lib/node_modules/*) PREFIX="${ENTRY%%/lib/node_modules/*}" ;;
    esac
    ;;
esac

# A prefix is only usable if it is the one npm would build itself: it must
# hold the package dir we resolved through. Empty PREFIX = let npm decide,
# same as before.
NPM_PREFIX_ARGS=""
if [ -n "$PREFIX" ] && [ -d "$PREFIX/lib/node_modules" ]; then
  NPM_PREFIX_ARGS="--prefix $PREFIX"
fi

# Is the install on PATH still the legacy package? Resolve the symlink and
# look at which package dir it lands in — `command -v` alone can't tell,
# since @sma1lboy/kobe ships a `rove` bin too.
MIGRATING=0
case "$ENTRY" in
  */@sma1lboy/kobe/*) MIGRATING=1 ;;
esac

# What the install will actually land on. A bare dist-tag (`nightly`) has to
# be resolved through the registry: the verify step at the bottom compares
# the installed `rove -v` against TARGET, and comparing it against the literal
# string "nightly" would fail every nightly install with a bogus "another
# install is shadowing it".
case "$VERSION" in
  "") TARGET="$(npm view "${PACKAGE}" version 2>/dev/null || true)" ;;
  [0-9]*) TARGET="$VERSION" ;;
  *) TARGET="$(npm view "${PACKAGE}@${VERSION}" version 2>/dev/null || true)" ;;
esac

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

printf '%b\n' \
  "${ACCENT}${BOLD}██████╗  ██████╗ ██╗   ██╗███████╗" \
  "██╔══██╗██╔═══██╗██║   ██║██╔════╝" \
  "██████╔╝██║   ██║██║   ██║█████╗" \
  "██╔══██╗██║   ██║╚██╗ ██╔╝██╔══╝" \
  "██║  ██║╚██████╔╝ ╚████╔╝ ███████╗" \
  "╚═╝  ╚═╝ ╚═════╝   ╚═══╝  ╚══════╝${RESET}" \
  "${DIM}many sessions. one terminal.${RESET}" \
  ""

if [ "$MIGRATING" = "1" ]; then
  printf '%bkobe is now Rove.%b %s -> %s — same tool, same `kobe` command, new name.\n' \
    "$BOLD" "$RESET" "$LEGACY_PACKAGE" "$PACKAGE"
fi

# The failure this script exists to prevent is silent: two installs on
# PATH, and the one you are running is not the one you think. We are about
# to update only the prefix that owns the binary on PATH — so if there are
# others, name them now, while the user is here and looking.
SEEN=""
DUPES=""
DUPE_DIRS=""
OWN_BINDIR="$(dirname "$BIN")"
saved_ifs="$IFS"
IFS=:
for dir in $PATH; do
  IFS="$saved_ifs"
  [ -n "$dir" ] || dir="."
  for name in rove kobe; do
    cand="$dir/$name"
    [ -x "$cand" ] || continue
    real="$(resolve_link "$cand")"
    case " $SEEN " in
      *" $real "*) continue ;;
    esac
    SEEN="$SEEN $real"
    # One install owns both a `rove` and a `kobe`. Group by the directory
    # they sit in, so a sibling bin is never reported as a rival install —
    # true whether the bins are symlinks into a package dir or plain files.
    bindir="$(dirname "$cand")"
    [ "$bindir" = "$OWN_BINDIR" ] && continue
    case " $DUPE_DIRS " in
      *" $bindir "*) continue ;;
    esac
    DUPE_DIRS="$DUPE_DIRS $bindir"
    DUPES="$DUPES $cand"
  done
  IFS=:
done
IFS="$saved_ifs"

if [ -n "$DUPES" ]; then
  printf '%bwarning: rove is installed more than once.%b\n' "$BOLD" "$RESET" >&2
  printf '%b  updating (first on PATH): %s%b\n' "$DIM" "$BIN" "$RESET" >&2
  for d in $DUPES; do
    printf '%b  also installed, NOT updated: %s%b\n' "$DIM" "$d" "$RESET" >&2
  done
  printf '%b  PATH order decides which one runs. Remove the ones you do not want.%b\n' \
    "$DIM" "$RESET" >&2
fi

if [ -n "$TARGET" ]; then
  printf '%bUpdating %s: %s -> v%s%b (via %s)\n' "$BOLD" "$PACKAGE" "${BEFORE:-not installed}" "$TARGET" "$RESET" "$MANAGER"
else
  printf '%bUpdating %s via %s...%b\n' "$BOLD" "$PACKAGE" "$MANAGER" "$RESET"
fi

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

# Both packages own a `kobe` AND a `rove` bin, so installing one over the
# other dies with EEXIST (verified on npm 11). The legacy package has to go
# first — and only once we're about to replace it, so a failed install
# can't leave the user with nothing.
if [ "$MIGRATING" = "1" ]; then
  # shellcheck disable=SC2086 # empty-or-two-words, needs splitting
  "$MANAGER" uninstall -g $NPM_PREFIX_ARGS "$LEGACY_PACKAGE" >>"$LOG" 2>&1 || true
fi

# npm retires the old package dir to a sibling `.rove-<hash>` before it
# unpacks the new one, then deletes the retired copy. On Windows that delete
# cannot finish while a Rove is running: a DLL a process has mapped
# (opentui.dll in the TUI and daemon, conpty.node in the PTY host) is
# undeletable, and a running Rove is the NORMAL state during an update —
# the daemon and the PTY host are long-lived by design. npm swallows the
# failure, reports success, and leaves the retire dir behind with the
# mapped files in it. The hash is derived from the package path, so the
# NEXT update targets the very same retire dir: `rename` fails because the
# destination exists, npm falls back to a file-by-file copy, and copying
# onto the still-mapped DLL dies with EBUSY. Every second update on Windows
# failed this way while Rove was open.
#
# Clear the leftovers before npm runs: delete what can be deleted (Git
# Bash's rm uses POSIX delete semantics and usually manages even a mapped
# file; everything goes once the old build has exited) and move the rest
# out of npm's way — Windows allows renaming a mapped file even when it
# refuses to delete it. Anything moved aside is caught by the same glob on
# a later run and deleted then. Only npm has retire dirs; a bun install
# never enters this block.
clear_retired_installs() {
  scope="$1"
  [ -d "$scope" ] || return 0
  for retired in "$scope"/.rove-* "$scope"/.kobe-*; do
    [ -d "$retired" ] || continue
    rm -rf "$retired" 2>/dev/null || true
    [ -d "$retired" ] || continue
    case "$retired" in
      *.stale-*) continue ;;
    esac
    mv "$retired" "${retired}.stale-$$" 2>/dev/null || true
  done
}

if [ "$MANAGER" = "npm" ] && [ -n "$BIN" ]; then
  if [ -n "$PREFIX" ]; then
    clear_retired_installs "$PREFIX/lib/node_modules/@sma1lboy"
  fi
  # npm on Windows keeps no `lib/` and its bins are shims, not symlinks, so
  # PREFIX stays empty there: the shims sit at the prefix root with
  # node_modules beside them. A no-op wherever that layout does not exist.
  clear_retired_installs "$(dirname "$BIN")/node_modules/@sma1lboy"
fi

# bun caches the package manifest, so a version published minutes ago is
# "not found" until that cache expires — `bun add` reports it as
# `No version matching "X" found ... (but package exists)`, which names
# neither the cache nor a way out. Ask bun to re-fetch the manifest instead:
# --no-cache on the FIRST attempt costs one registry round-trip and removes
# the entire class of "I just released it and cannot install it".
# npm resolves dist-tags per invocation and needs nothing here.
INSTALL_ARGS=""
if [ "$MANAGER" = "bun" ]; then INSTALL_ARGS="--no-cache"; fi

# shellcheck disable=SC2086 # empty-or-two-words, needs splitting
"$MANAGER" install -g $NPM_PREFIX_ARGS $INSTALL_ARGS "${PACKAGE}@${VERSION:-latest}" >>"$LOG" 2>&1 &
PID=$!

if [ -t 1 ]; then
  # ponytail: braille spinner, same glyph set as the TUI's DEFAULT_SPINNER_FRAMES
  # (packages/kobe/src/engine/spinner-frames.ts) — keep the two in sync by eye.
  set -- ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
  while kill -0 "$PID" 2>/dev/null; do
    frame=$1
    shift
    set -- "$@" "$frame"
    printf '\r%b%s%b installing...' "$DIM" "$frame" "$RESET"
    sleep 0.1
  done
  printf '\r\033[K'
fi

if ! wait "$PID"; then
  printf '%berror: %s install failed:%b\n' "$RED" "$MANAGER" "$RESET" >&2
  cat "$LOG" >&2
  # bun says `No version matching "X" ... (but package exists)` for a stale
  # manifest cache and names neither the cache nor a fix. --no-cache above
  # should prevent it; if it still happens, say what to do rather than
  # leaving the user with a message that reads like the version is missing.
  if grep -q 'but package exists' "$LOG" 2>/dev/null; then
    printf '%bThat version IS published — this is a stale package-manager cache.%b\n' "$DIM" "$RESET" >&2
    printf '%bTry: rm -rf ~/.bun/install/cache && %s install -g %s@%s%b\n' \
      "$DIM" "$MANAGER" "$PACKAGE" "${VERSION:-latest}" "$RESET" >&2
  fi
  # EBUSY is npm's spelling of Windows' sharing violation: something has a
  # file in the old install open in a way the install cannot get past.
  # After the retire-dir sweep above that is a running Rove itself — name
  # the remedy rather than leaving an errno the user cannot act on.
  if grep -q 'EBUSY' "$LOG" 2>/dev/null; then
    printf '%bA running Rove is holding files in the old install (Windows cannot replace a file a process has loaded).%b\n' \
      "$DIM" "$RESET" >&2
    printf '%bQuit Rove, run `rove daemon stop`, then retry. Engine sessions live in the PTY host and survive both.%b\n' \
      "$DIM" "$RESET" >&2
  fi
  # We removed the legacy package to free the bin names, so a failed
  # install would otherwise leave the user with no kobe at all. Put it
  # back before giving up.
  if [ "$MIGRATING" = "1" ]; then
    printf '%brestoring %s...%b\n' "$DIM" "$LEGACY_PACKAGE" "$RESET" >&2
    # shellcheck disable=SC2086 # empty-or-two-words, needs splitting
    if "$MANAGER" install -g $NPM_PREFIX_ARGS "${LEGACY_PACKAGE}@latest" >/dev/null 2>&1; then
      printf '%brestored — you are back on %s, nothing was lost.%b\n' "$DIM" "$LEGACY_PACKAGE" "$RESET" >&2
    else
      printf '%breinstall by hand: %s install -g %s%b\n' "$RED" "$MANAGER" "$LEGACY_PACKAGE" "$RESET" >&2
    fi
  fi
  exit 1
fi

# The shell caches command→path lookups; after swapping packages the cached
# entry points at a path that no longer exists.
hash -r 2>/dev/null || true

AFTER="$(rove -v 2>/dev/null || kobe -v 2>/dev/null || true)"

if [ -n "$TARGET" ] && [ "${AFTER##* }" != "$TARGET" ]; then
  echo "error: 'rove' on PATH reports '${AFTER:-nothing}' but the target is ${TARGET}." >&2
  echo "PATH resolves rove to: $(command -v rove || echo 'not found')" >&2
  echo "Another install is likely shadowing it. Remove the stale one or run: ${MANAGER} install -g ${NPM_PREFIX_ARGS} ${PACKAGE}@${VERSION:-latest}" >&2
  exit 1
fi

printf '%b✓ %s -> %s%b\n' "$GREEN" "${BEFORE:-rove (not installed)}" "${AFTER:-unknown}" "$RESET"
if [ "$MIGRATING" = "1" ]; then
  printf '%bYou are on %s now. Both `kobe` and `rove` still work — your tasks, worktrees, and settings are untouched.%b\n' \
    "$DIM" "$PACKAGE" "$RESET"
fi
printf '%bThanks for using Rove. Happy building.%b\n' "$DIM" "$RESET"
