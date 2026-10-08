---
id: cha-tzxo
status: closed
deps: [cha-g8i6]
links: []
created: 2026-10-07T22:03:44Z
type: task
priority: 1
assignee: aksel
parent: cha-85ms
tags: [v3, ui]
---
# V3 equal tile desktop and keyboard control

No fixed chat; auto layouts; focus/swap/promote/fullscreen; stable workspace shortcuts; shelf and overview.


## Notes

**2026-10-07T22:21:34Z**

Equal-status tile UI compiles: single fill, two equal split, three primary/stacked, four grid. No fixed chat and no nested browser tabs. Shared headers, shelf, overview drag/move controls, directional focus/swap/promote/fullscreen and stable slot keys. Initial sandboxed workflow test passed.

**2026-10-07T22:32:35Z**

Seven sandbox-enabled desktop tests now pass, including native browser shortcut routing, popup deduplication, background attention, forms, five-session workday and auth settings. Additional continuity/alias/send-race regressions are being exercised before the final handoff.
