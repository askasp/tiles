---
id: cha-08ww
status: closed
deps: [cha-g8i6]
links: []
created: 2026-10-07T22:03:44Z
type: task
priority: 1
assignee: aksel
parent: cha-85ms
tags: [v3, attention]
---
# Background waiting sessions and attention navigation

Refresh visible sessions independently; notice inactive/shelved permission/forms; Super U finds waiting sessions without sending prompts.


## Notes

**2026-10-07T22:21:34Z**

Session hook watches every open/shelved session independently. Background permission/form events invalidate details and light up global waiting control and shelf/workspaces. Waiting navigation unshelves session plus linked previews. Verified private fixture request/reply flow.

**2026-10-07T22:32:35Z**

Seven sandbox-enabled desktop tests now pass, including native browser shortcut routing, popup deduplication, background attention, forms, five-session workday and auth settings. Additional continuity/alias/send-race regressions are being exercised before the final handoff.
