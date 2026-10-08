---
id: cha-yc3c
status: closed
deps: []
links: []
created: 2026-10-07T21:34:14Z
type: feature
priority: 1
assignee: aksel
tags: [sessions, usability]
---
# Surface waiting sessions across workspaces

Track pending permission/question events for inactive sessions, show amber workspace indicators and an actionable notification, reconcile counts when switching sessions. Keep native browser views from covering notifications.

## Acceptance Criteria

A session requesting input in the background is visible immediately; switching to it shows inline requests; answering clears its indicator; tested with isolated fixture events.


## Notes

**2026-10-07T22:32:35Z**

Implemented and tested by cha-08ww: background permissions/forms trigger waiting indicators and global attention navigation, including shelved session + preview restoration. Notifications stay in the workspace bar, above native browser views.
