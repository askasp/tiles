---
id: cha-eagt
status: closed
deps: []
links: []
created: 2026-10-07T22:24:17Z
type: bug
priority: 1
assignee: aksel
parent: cha-85ms
tags: [v3, usability]
---
# Preserve reading position and partial forms while switching tiles

Review found that workspace switching unmounted session bodies, losing chat reading position, partially filled agent forms, and review filters. Keep nonclosed tile bodies mounted under one stable keyed host, hide off-workspace bodies, filter native placements to nonzero visible bounds, and restore chat scroll position without auto-follow stealing position.

## Acceptance Criteria

Switch away and back preserves partial agent question answers and review/filter state; browser layout stays max4 and invisible bodies do not create native views; focused composer sizing/focus remains correct; sandboxed regression tests pass.


## Notes

**2026-10-07T22:48:17Z**

Verified by sandboxed continuity test: 60-message chat reading position and partially filled agent question survive switching workspace, Home, and shelf. Hidden tile bodies stay mounted; hidden browsers receive no native bounds. Modal keyboard focus now remains inside dialogs and returns on close.
