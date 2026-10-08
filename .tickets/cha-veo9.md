---
id: cha-veo9
status: closed
deps: [cha-g8i6]
links: []
created: 2026-10-07T22:03:44Z
type: task
priority: 1
assignee: aksel
parent: cha-85ms
tags: [v3, browser]
---
# V3 native browser ownership and navigation

One browser tile per URL, no nested tabs; move existing native view without reload; dedup popups; shared authenticated browser profile; up to four native views.


## Notes

**2026-10-07T22:21:34Z**

Native browsers now support four visible WebContentsViews. Native view identity survives workspace moves. Shared desktop auth partition preserves web logins; full-URL global identity dedups launcher opens, popups and redirect collisions. Explicit sandbox-enabled private workflow passes bridge isolation and no-copy checks.

**2026-10-07T22:32:35Z**

Seven sandbox-enabled desktop tests now pass, including native browser shortcut routing, popup deduplication, background attention, forms, five-session workday and auth settings. Additional continuity/alias/send-race regressions are being exercised before the final handoff.
