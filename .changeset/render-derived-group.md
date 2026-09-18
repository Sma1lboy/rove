---
"@sma1lboy/rove": patch
---

Sidebar rows and the Kanban board now show **whose turn it is**, derived rather than declared: `!` needs you, `»` ready to land (an approved PR — a state the rail could not express before), `●` needs review (a worker's report nobody has acted on), and the spinner for working. The sidebar's `attention` sort ranks by that group, so the top of the list is what needs a person next; a linked Kanban card wears the group as a badge and the ones that need you float to the head of In progress. Plugin-written row tokens render beside the branch and disappear when their TTL lapses, with no writer involved.
