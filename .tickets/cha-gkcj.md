---
id: cha-gkcj
status: closed
deps: []
links: []
created: 2026-10-08T05:40:36Z
type: feature
priority: 1
assignee: aksel
parent: cha-85ms
tags: [v3, front, integrations]
---
# Native Front API inbox and conversation tiles

User requested Front token/API-backed tiles instead of only web pages. Build persistent uniquely keyed filtered Front inbox tiles and direct conversation readers using read-only HTTPS API requests in main process. Include Front search syntax, pinned/named filter tile identity, paging/refresh, safe email text rendering without remote images, attachments metadata, explicit browser fallback, missing-token/scope handling. Do not send replies or mutate mail state.

## Acceptance Criteria

Token opens native Front inbox; a filter opens a unique reusable list; selecting a conversation reads messages in a native tile; no Front web view needed; token stays main-only; email HTML cannot execute or load remote images; fixtures/unit and sandbox desktop tests cover ownership, filter switching, paging, missing auth, and restart.


## Notes

**2026-10-08T05:54:16Z**

Implemented Front token/API-native filtered inbox and direct message tiles. Personal filter identity saved securely as nonsecret settings; presets for addressed/assigned/mentions/tagged/author+unreplied. Native read APIs issue GET only against fixed Front host with bounded cursor paging and scope guidance. Email HTML converted in main process using html-to-text, no executable HTML or remote images in renderer; attachment names only. Browser/API presentations share front:conversationID and switch in place. 44 unit/security tests and 13 sandboxed desktop tests pass, including native paging/direct reading/restart and web fallback switch. No real account credentials supplied; Front send/comments/downloads remain explicit web fallback. Production dependency audit reports zero vulnerabilities.
