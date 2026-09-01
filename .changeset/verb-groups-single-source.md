---
"@sma1lboy/rove": patch
---

Fix `rove api schema`: the `prompt` verb was in no browsable group. A verb's
group used to be declared twice — once by which `verbs-*.ts` file held it, once
in a hand-written table — and `prompt` was missing from the table, so it
reported group `other`, which `--group` then rejected as unknown. Groups are
now derived from a required `group` field on each verb, so an ungrouped verb is
a compile error instead of a silent orphan. Within a group, `--group` lists
verbs in the same canonical order as the index and `--all`.
