---
id: cha-g8i6
status: closed
deps: []
links: []
created: 2026-10-07T22:03:44Z
type: task
priority: 0
assignee: aksel
parent: cha-85ms
tags: [v3, model]
---
# V3 tile registry, shelf, ownership and migration

Global resource identities; four visible; LRU shelf; linked move/hide; stable workspace slots; preserve v1 drafts and browser URLs.


## Notes

**2026-10-07T22:16:13Z**

Tile registry and v1 migration implemented. 14 new model tests pass, including 480 simulated workday minutes (960 resource operations), unique ownership/LRU shelf/stable workspace IDs/linked move/hide/undo/draft and restart invariants. Desktop UI and auth settings now compiling; sandboxed Electron verification underway.

**2026-10-07T22:21:34Z**

Implemented typed global registry, four-tile LRU shelf, stable workspace slots, linked session/preview groups, close/restore and layout-only undo. V1 drafts, URLs and hidden workspaces migrate without duplicate resources. 26 unit/security tests pass; private workday simulation exercises 960 resource operations.
