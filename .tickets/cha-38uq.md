---
id: cha-38uq
status: in_progress
deps: [cha-tzxo, cha-zv8w, cha-veo9, cha-08ww]
links: []
created: 2026-10-07T22:03:44Z
type: task
priority: 1
assignee: aksel
parent: cha-85ms
tags: [v3, tests]
---
# Simulate an entire workday and fix friction

Private fixture five sessions in two projects; repeated Slack DM/tagged threads, Front inbox/replies, GitHub PRs, previews; hundreds of switch/move/shelf/undo/restart operations; sandbox enabled.


## Notes

**2026-10-07T22:21:34Z**

All-day invariant simulation passed. Expanding sandboxed UI scenario to five sessions across two projects and repeated DM/mentions/mail/replies/PR interruption workflows. First UI run uncovered an overly strict test expecting four tiles when only three had been opened; corrected to enforce capacity and unique URL ownership. Adding opt-in extended soak with continuous actions and periodic restarts.

**2026-10-07T22:32:35Z**

72-second soak passed 233 continuous cycles with periodic restarts; main-process heap around 7.5–12.2 MB, RSS around 249–283 MB; native view count bounded at 20 incl renderer. Three-hour soak launched as shell sh_11876ce69001Q4sj8DkwTLyF4b; outcome pending, do not mark this task complete yet.

**2026-10-07T22:48:17Z**

Latest suite: 36 unit/security/provider tests pass; 11 sandbox-enabled desktop tests pass (extended soak excluded from normal suite). Usability fixes: partial form/reading continuity, aliases, first-send draft race, three-way waiting cycle, missing-query safety, keyboard focus trap and shifted number-row controls. Three-hour automated soak remains pending; do not close the simulation task or epic before final outcome.
