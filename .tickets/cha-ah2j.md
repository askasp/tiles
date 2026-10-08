---
id: cha-ah2j
status: closed
deps: []
links: []
created: 2026-10-08T07:15:03Z
type: feature
priority: 0
assignee: aksel
parent: cha-o8mt
tags: [ux, launcher, files, connectors]
---
# Source-aware universal launcher and Files tiles

Implement agreed UX: source/resource/action separation, universal search with optional source-scoping (OpenCode, Files, Front, Slack, GitHub, Web), explicit source/action labels and recent choices ranking. Plain project search/open must never create a session or force the filesystem folder into OpenCode. Add safe read-only native folder/text-file tiles and direct OpenCode-project actions for browse files/new session. Keep OpenCode SDK backend behind same source descriptor interface; preserve unique resources and existing provider flows. Generic AI-authored connectors remain a separate architecture task.

## Acceptance Criteria

Searching a project shows Files folder and OpenCode project separately; scoped search excludes other sources and supports keyboard enter/back navigation; file/folder browsing creates no OpenCode sessions; new session is explicitly labeled and separate; chosen recent resource ranks higher without hidden action substitution; files are main-process read-only/bounded, executable content never executes; stable folder/file identities and restart verified with unit and sandboxed tests.


## Notes

**2026-10-08T07:28:18Z**

Implemented shared source descriptors, optional launcher chips/source-first Enter and empty-Backspace exit, explicit source/resource/action labels, recent-choice tie ranking, and deliberate browse/show-sessions/start-session commands. Plain open/find project no longer creates sessions. Added native read-only folder and UTF-8 text-file tiles with canonical symlink identities, mounted state/restart restoration, 1,000-entry/256-KiB bounds, binary/pseudo-file rejection and inert HTML previews. OpenCode project and Files folder have distinct unique keys with explicit cross-source actions. Home labels OpenCode projects and offers scoped search shortcuts; folder picker opens Files. Regression exposed PR cleanup and DM-alias collisions: dm/pr now request discovery without excluding universal local resource matches; full source names/chips still narrow. 51 unit/security tests and 15 sandboxed desktop tests pass on preceding build; final rerun validating descriptor-driven classification and URL labels underway. Arbitrary AI-authored connectors/OAuth/free-form intent remain cha-o8mt, not claimed implemented.

**2026-10-08T07:28:48Z**

Final production build/typecheck and sandboxed desktop rerun passed: 15 tests passed, 1 extended soak intentionally skipped. Latest descriptor-driven source classification and explicit URL action labels are covered. Unit/security suite: 51 passed. Source-aware UX task complete; generic AI connector epic remains open.
