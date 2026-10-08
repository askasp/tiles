---
id: cha-k415
status: closed
deps: []
links: []
created: 2026-10-07T21:16:58Z
type: task
priority: 0
assignee: aksel
tags: [v0.1]
---
# Ship runnable ChatOS v0.1

Electron, OpenCode 2 local-service integration, project/session navigation, i3-style workspaces, hide/reopen, basic browser bonus. Keep existing server sessions untouched during tests.

## Acceptance Criteria

App launches; real projects and sessions load; close/reopen preserves draft and stage layout; sandboxed browser works; build, typecheck, unit and desktop smoke tests pass.


## Notes

**2026-10-07T21:27:03Z**

Build and 7 unit tests pass. Read-only service check: OpenCode 2.0.24, 41 projects, 50 recent root sessions, 32 enabled models. Electron smoke test passed against the live service, including session open, stage split, hide/reopen, and unsent draft preservation. v0.1 run command shared with Aksel. Mutation/browser/restart test uses a private fixture server next; existing sessions remain untouched.

**2026-10-07T21:34:41Z**

Final verification passed: production build/typecheck, 7 unit tests, 3 Electron desktop tests (development renderer; read-only live server; private fixture workflow for prompts, permission replies, forms, browser ownership, sandbox isolation, and restart persistence). Normal sandbox-enabled launch passes. npm audit --omit=dev reports zero vulnerabilities. Remaining usability work is cha-8o9y and cha-yc3c.
