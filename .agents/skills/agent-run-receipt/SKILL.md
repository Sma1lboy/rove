---
name: agent-run-receipt
description: Generate a shareable Agent Run Receipt image when the owner of a Rove multi-agent workflow has accepted the integrated outcome and is ready to send the final report. Use after all selected workers have reported back and verification is complete; never use for an interim update or from a worker reporting to its dispatcher.
---

# Agent Run Receipt

Create one 1200×1500 evidence card that makes the user's completed work—not the Rove UI—the subject. Attach it to the owner's normal final report.

## Authority boundary

Only the workflow owner decides that the run is complete. Do not infer completion from a worker's `done` status, a quiet terminal, a passing test, or a PR check alone.

Generate the receipt only after the owner has confirmed all of the following:

- every worker included in this workflow has returned an outcome or has an explicitly accepted failure;
- selected work is integrated into the owner's checkout or intentionally excluded;
- required verification has run and the owner understands any remaining risk;
- no unresolved user decision or blocker prevents calling the requested outcome complete;
- the final report is being written now.

If the current Rove task has a dispatcher, it is a worker for the parent workflow. Report back with `rove api send`; do not generate the parent's receipt.

## Run boundary

Rove tasks have durable ancestry and batches, but no universal workflow-run ID. A long-lived owner can coordinate unrelated batches over time. Therefore the owner must explicitly name the task IDs belonging to this receipt.

Include:

- the owner task ID;
- every worker whose contribution, failure, review, or verification is part of the final outcome;
- nested workers only when their work materially belongs to this run.

Never collect every historical descendant merely because it shares the same owner or repository.

## Workflow

1. Resolve the directory containing this `SKILL.md`; scripts are relative to it.
2. Write one factual outcome sentence in the user's language. It should say what changed or became true, not "the agents finished."
3. Create a durable local artifact directory outside the repository, normally `~/.rove/artifacts/agent-run-receipts/<timestamp>/`.
4. Run the collector with the explicit boundary:

   ```bash
   bun <skill-dir>/scripts/collect.mjs \
     --owner-task-id "$ROVE_TASK_ID" \
     --task-ids "$ROVE_TASK_ID,<worker-id>,<worker-id>" \
     --outcome "<one factual outcome sentence>" \
     --output "<artifact-dir>/run.json"
   ```

5. Inspect `run.json` before rendering. Confirm the repo/PR, task membership, counts, titles, outcome, and public safety. Correct the command inputs rather than hand-editing factual metrics.
6. Render:

   ```bash
   bun <skill-dir>/scripts/render.mjs \
     --input "<artifact-dir>/run.json" \
     --output-dir "<artifact-dir>"
   ```

7. Inspect the generated PNG (or SVG fallback) at full size. Reject it if the headline, outcome, or proof cannot be understood without prior conversation.
8. Add the image to the final report after the outcome and verification summary. Use a clickable absolute file link. Do not replace the engineering report with the card.

## Privacy

Message previews are omitted by default. This is the public-safe mode and should remain the default.

Use `--include-message-previews` only when the user explicitly wants message text shown and the owner has inspected every selected preview for secrets, personal data, customer data, private paths, unpublished vulnerability details, and misleading partial context. The collector only sees bounded Rove `api send` metadata; it is not a complete transcript.

Task titles, branch names, repository names, PR titles, and outcome text can also be sensitive. Inspect them before attaching the image. Do not upload or post the artifact; generation authorizes a local final-report attachment only.

## Content contract

The card should answer, in one frame:

- What surprising coordination happened?
- What did the team actually accomplish?
- Which agents contributed?
- What evidence proves the result?

The default hook is `THIS PULL REQUEST HAD AN ORG CHART.` when a PR is present, otherwise `THIS TASK HAD AN ORG CHART.` Override it with `--headline` only when a more specific truthful hook is stronger.

Rove is a small signature in the lower-right corner. Do not add application chrome, settings, controls, or a product-tour caption.

## Failure behavior

- Missing owner task or explicit task list: stop and report the exact missing input.
- A selected task belongs to a different repository: stop; ask the owner to correct the boundary.
- Current task differs from `--owner-task-id`: stop unless running a deliberate offline test.
- No worker tasks: skip the receipt; this was not a multi-agent run.
- `rove api` failure: keep the ordinary final report and state that the receipt could not be generated. Never change task state or retry delivery.
- PNG conversion unavailable: attach the generated SVG instead.

## Final-report shape

Lead with the engineering outcome, then verification and remaining risk. End with one line such as:

```markdown
Agent Run Receipt: [open image](/absolute/path/to/agent-run-receipt.png)
```

Do not claim that the graph represents untracked engine-internal subagents or messages. It represents only the explicitly selected Rove tasks, recorded dispatcher edges, and confirmed Rove peer sends.
