# Failure messages changed

- Error toasts: all error-kind notifications now include a separate next-step line, so long titles cannot truncate the hint. Original titles and context remain intact.
- Top-level CLI catch: preserves error text and debug stacks, prints structured hint/nextCommandArgs when supplied, otherwise points to read-only `rove doctor`. Not-a-repository keeps its existing directory-change advice.
- Plugin CLI: usage failures point to `rove plugin --help`; unexpected failures point to diagnosis.
- Theme CLI: failed operations point to valid names/options in `rove theme --help`.
- Release listing: connection/rate-limit failure names the retry command.
- New-task inline errors: correct the indicated field, then retry Create. Routine composer, issue list, and field-notes errors: diagnosis hint below the original error.
- Files: generic Git failures name `git status`; PR-check lookup names `gh auth status`.
- Preview reads: check file existence and permissions, then retry.
- Kanban read failures: run doctor, then reopen Kanban.
- Update: registry lookup, missing release URL, browser launch, updater exit, and release listing name retry or browser steps.
- Plugins settings: unreadable manifest, failed hook start, failed marketplace install name concrete checks.
- Settings writes and auto-routing key writes: check directory permissions and disk space, then save again.
- Doctor fix failure: inspect command output and rerun doctor.
- Pane crashes: retry, inspect client.log, and run doctor if persistent.
- Welcome prerequisite failures: render existing DoctorFix records for missing Git, missing engines, and signed-out engines. Both fix kinds are display-only in the TUI.

Existing validation instructions, field-required messages, status badges, engine-auth guidance, terminal retry hints, and API JSON envelopes retain their existing contracts. English and Chinese copies stay aligned.
