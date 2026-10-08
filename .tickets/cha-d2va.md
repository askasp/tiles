---
id: cha-d2va
status: closed
deps: []
links: []
created: 2026-10-08T11:38:10Z
type: task
priority: 0
assignee: aksel
parent: cha-o8mt
tags: [architecture, storage, connectors]
---
# V4 connector recipes and durable SQLite desktop storage

Implement validated reusable collection/detail connector definitions, AI proposal/approval, secure bounded runtime, generic native tiles and launcher discovery. Persist definitions, revisions, drafts/layout and credentials using main-process SQLite with migration/backups; preserve existing providers and OpenCode sessions.


## Notes

**2026-10-08T12:23:56Z**

Implemented and verified: strict editable JSON connector schema; collection/detail/parent-scoped thread identities; fixed List/Table/Timeline/Record/Document/Conversation/Diff renderers; typed message kinds; inspect/approve/version-history UI; one-shot tool-free OpenCode proposal/search planning; bounded read runtime with pinned DNS, redirect rejection and rate backoff; native exact-request write confirmation and duplicate suppression; registered native OAuth PKCE/state/loopback + serialized refresh/rotation; OS-encrypted secrets with session-only fallback. Main-process node:sqlite WAL/FULL transactions, single-instance profile, browser/services migration, snapshots/revisions, permissions and online backups. npm test: 81 passed. xvfb-run -a npm run test:desktop: 19 passed, extended soak skipped. Two unrelated private API fixtures and OAuth fixtures; no real provider writes or server-session mutations. Production build/typecheck passed. Remote origin empty; preparing first tested repository commit/push.
