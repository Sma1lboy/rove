---
"@sma1lboy/rove": patch
---

Migrating a legacy `kobe` install to the Rove layout now succeeds on Windows.

Every launch reported `state migration will retry: state.json: EPERM:
operation not permitted, fsync` and then migrated nothing, so a machine
upgrading from `kobe` kept its old settings, themes and attachments stranded
under `~/.kobe` and `~/.config/kobe` forever — the failure left the completion
marker unwritten, which is what makes the next launch retry, so the warning
repeated indefinitely.

The migration flushes each copied file before publishing it, and it was
reopening the file read-only to do so. Windows backs `fsync` with
`FlushFileBuffers`, which requires a writable handle and rejects a read-only
one; POSIX flushes an `O_RDONLY` descriptor without complaint, so the bug was
invisible everywhere CI runs. Because `copyFileSync` also carries the source
file's mode onto the copy, a legacy file with no write bit defeats a writable
reopen just as thoroughly — on Windows and POSIX alike. The flush now widens
the temporary file's mode when it has to, then restores the mode it publishes.
