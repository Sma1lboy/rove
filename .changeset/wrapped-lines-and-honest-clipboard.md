---
"@sma1lboy/rove": patch
---

Copying a soft-wrapped terminal line pastes as one line, and search can find text that straddles the wrap

The terminal snapshot builds one row per GRID row and never read xterm's
`isWrapped`, so a line the emulator broke across columns arrived downstream as
several unrelated rows. Two things a user does constantly fell out of that.
Drag-selecting a path out of a build log copied
`…/packages\n/kobe/src/…\narch.ts:41:9` — three broken shell commands where one
path was selected. And the `/` scrollback search, which ran `indexOf` per row,
reported `no matches` for a needle spanning the break: a confident negative for
text visible two rows above the query. xterm.app, iTerm2 and tmux all rejoin
soft-wrapped rows; Rove was the outlier.

The flags now travel with the snapshot, and both consumers group rows into
logical lines from them. The highlight is unchanged — you selected two visual
rows and still see two highlighted rows; only the extraction joins. A search hit
across a wrap is a multi-row range, which the existing paint already handles.

**Clipboard writes now report whether anything was copied.**
`copyTextToSystemClipboard` returned `void` and discarded both channels'
answers: the local pipe's exit status was never read (a missing command exits
127 without throwing; `xclip` with no `$DISPLAY` passes the `which` probe and
then fails), and OSC 52's boolean could not survive a `(text) => void`
signature. So on a headless box with no `wl-copy`/`xclip`/`xsel`, in a terminal
that refuses OSC 52, **Copy branch name** toasted `Copied branch feat/whatever`
over an untouched clipboard. It now says it could not reach a clipboard, and the
pane's copy-on-select — silent on success, as it should be — speaks on failure.
Windows also gets a local clipboard command for the first time (`clip`, then
PowerShell's `Set-Clipboard`): the `where` probe written for it was unreachable
behind a platform check that returned null, leaving OSC 52 as its only channel.

**The parked search hit no longer drifts out from under its counter.** The hit
you walked to was remembered as a position in the match array, which a
scrollback trim renumbers — the counter kept reading `3/5` while the accent
highlight had moved to a different occurrence, and `enter` walked on from the
wrong place. It is now remembered by absolute line id, re-derived each frame,
falling forward to the next surviving hit when that line is trimmed and dropped
outright when a resize resets line numbering — the same discipline
`followWindowShift` already applies to a selection.
