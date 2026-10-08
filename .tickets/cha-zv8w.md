---
id: cha-zv8w
status: closed
deps: [cha-g8i6]
links: []
created: 2026-10-07T22:03:44Z
type: task
priority: 1
assignee: aksel
parent: cha-85ms
tags: [v3, launcher]
---
# V3 launcher finds, moves and tidies all resources

Search open/shelved/closed tiles and server sessions; Enter go/open; Shift Enter move; Ctrl Enter new workspace; visible action preview; arrange undo.


## Notes

**2026-10-07T22:21:34Z**

Launcher searches all visible/shelved/closed tiles, projects and remote sessions. Shows owner workspace/source. Enter focuses owner; Shift Enter moves linked group here; Ctrl Enter asks for new workspace only for unopened resources. Supports project+new session and just/hide-everything-but commands with layout-only undo. No LLM launcher claimed.

**2026-10-07T22:32:35Z**

Seven sandbox-enabled desktop tests now pass, including native browser shortcut routing, popup deduplication, background attention, forms, five-session workday and auth settings. Additional continuity/alias/send-race regressions are being exercised before the final handoff.
