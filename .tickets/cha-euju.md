---
id: cha-euju
status: closed
deps: []
links: []
created: 2026-10-07T22:28:54Z
type: feature
priority: 1
assignee: aksel
parent: cha-85ms
tags: [v3, usability, search]
---
# Name browser resources so DMs and inboxes remain findable

Several services expose generic page titles or opaque channel/conversation URLs. Add persistent local tile aliases, editable from the shared header, that survive browser title updates and restart. Search both alias and original title/URL; show source/owner to disambiguate. Session rename continues to use OpenCode.

## Acceptance Criteria

Rename a browser tile DM Carl; title events do not overwrite alias; launcher finds Carl; moving/shelf/restart preserves alias; unique URL ownership still enforced.


## Notes

**2026-10-07T22:48:17Z**

Verified local browser alias via unit persistence test and sandboxed renderer: DM Carl stays named despite a generic browser title update, remains searchable when shelved, and URL opens still reuse one native view.
