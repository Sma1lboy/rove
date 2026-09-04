---
"@sma1lboy/rove": patch
---

Surface a routine that is failing, instead of leaving it for you to find.

The Attention Inbox had exactly one routine-related entry — the success path
where a standing session's composer was busy. A routine pointed at a repo that
moved, or one whose engine will not start, produced nothing anywhere a user
looks, every minute, forever. Those two outcomes now raise one Inbox episode
per routine (not per firing, and not per throwaway task), and a run that starts
working again clears it. Opening the episode lands on the Routines page.

The Routines list rows also carry the latest run's status, so a routine that
has failed every firing no longer renders identically to one that has succeeded
every firing, and the header counts how many need a human.
