---
name: unslop
description: Strip AI writing tells from Rove's user-facing prose — README, the docs/ pages that sync to docs.rove.run, landing copy, and release notes. Use when the user says "unslop", "洗一下文案", "这读起来像 AI 写的", or after drafting any user-facing page. Adapted for this repo from cursor/plugins pstack/skills/unslop.
metadata:
  internal: true
---

# Unslop

Rewrite text so it stops reading as machine-generated. Two halves, both required:
cut the tells, then make sure something human is left.

Upstream pattern list: <https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md>.
This file keeps the repo-specific parts — what counts as prose here, what is
data and must survive, and which surfaces are in scope.

## Scope in this repo

In scope (the product's public face):

- `README.md`
- The `docs/` pages listed in `SECTIONS` in `packages/kobe-docs/scripts/sync-docs.mjs`
  (they publish to docs.rove.run)
- `packages/kobe-landing/**` — English copy only
- Release notes and changeset bodies

Out of scope unless asked: `docs/PLAN.md`, `HARNESS.md`, `ARCHITECTURE.md`,
`DESIGN.md`, `RELEASING.md`, `AGENTS.md`, and `docs/design/**`. Those are
operator manuals for agents, not product surface.

## Never rewrite these

The same character can be punctuation in one line and data in the next. Check
before replacing:

- **Table cells meaning "not applicable"** — `| copilot | — | ... |` in
  ENGINES.md and SESSIONS.md. An em dash there is the value.
- **Verbatim CLI output** — e.g. the `rove doctor` sample in TROUBLESHOOTING.md.
  Quoting output means quoting it exactly.
- **Code, including placeholders** — `${ev.taskId ?? "—"}` in PLUGIN-SDK.md.
- **CSS/JS/HTML comments** in landing files.
- **Chinese copy.** `——` is correct CJK punctuation, not a tell. The landing
  page's `zh` i18n dictionary keeps its em dashes.
- **A file's own established separator.** PLUGIN-EVENTS.md uses `·` between a
  heading and its engine-support marks; match the file rather than inventing
  a new convention.

## The patterns

Full list upstream. The ones that actually show up here, in order of volume:

1. **Em dashes in prose.** By far the biggest. Resolve each one *per sentence*
   into a period, comma, semicolon, colon, or parens. Do not global-replace
   with a single substitute — swapping every `—` for `,` just trades one tic
   for another, and swapping for parens trades it for a different one.
2. **Inline-header lists.** `- **Label** — restatement of the label` becomes
   `- **Label.** <genuinely new detail>`. If the text after the label only
   rephrases it, the line has no content; write the content.
3. **Curly quotes** → straight.
4. **Filler.** "simply", "in order to", "it is important to note that".
5. **Fancy ways to say "is"** — "serves as", "stands as", "boasts".
6. **Title-case headings** → sentence case. Proper nouns and defined product
   terms (Terminal Tab, Claude Code) stay capitalized.
7. **Sentences that say nothing specific to this project.** If the line could
   appear verbatim in another tool's docs, cut it.

Then add voice back: vary sentence length, state the tradeoff instead of
listing both sides neutrally, and let a sentence be blunt.

## Two failure modes this repo has actually hit

Both produced broken output that looked fine at a glance. Check for them.

**Fragments from over-eager splitting.** Turning `X — y` into `X. y` mid-clause
leaves a sentence starting lowercase, or a verbless remainder. After editing,
scan for it:

```bash
python3 - <<'PY'
import sys
for p in sys.argv[1:]:
    lines = open(p, encoding='utf-8').read().split('\n')
    for i in range(len(lines) - 1):
        a, b = lines[i], lines[i + 1]
        if a.rstrip().endswith('.') and b[:1].islower() and b.strip() \
           and not b.startswith(('|', '-', '*', '`', '#', ' ')):
            print(f"{p}:{i+1}: {a[-50:]} || {b[:50]}")
PY
```

Also read each rewritten sentence whole. The scan only catches line-broken
prose, not a fragment that fits on one line.

**Escaping breaks in i18n strings.** The landing dictionaries are single-quoted
JS. Replacing `agent’s` with a literal `'` breaks the file. Always:

```bash
node --check packages/kobe-landing/index.js
node --check packages/kobe-landing/themes.js
```

## Verify before claiming done

```bash
bun run lint
bun run --filter @sma1lboy/kobe-docs build   # the docs-site CI gate
node --check packages/kobe-landing/*.js
```

Then confirm the em dashes that remain are all data, not prose:

```bash
grep -rn "—" README.md docs/*.md packages/kobe-landing/*.html
```

Every hit should be a table cell, CLI output, a code placeholder, a comment,
or Chinese. If one is a sentence, it was missed.

Editing the landing page's English also means checking its Chinese counterpart
still has the same keys:

```bash
node -e '
const s = require("fs").readFileSync("packages/kobe-landing/index.js", "utf8")
const keys = (b) => new Set([...b.matchAll(/'"'"'([a-zA-Z0-9._]+)'"'"':/g)].map(m => m[1]))
const zh = keys(s.split("var en =")[0].split("var zh =")[1])
const en = keys(s.split("var en =")[1].split("var dicts")[0])
console.log("zh only:", [...zh].filter(k => !en.has(k)))
console.log("en only:", [...en].filter(k => !zh.has(k)))
'
```
