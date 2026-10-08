---
id: cha-jm1r
status: closed
deps: []
links: []
created: 2026-10-07T22:37:39Z
type: feature
priority: 1
assignee: aksel
parent: cha-85ms
tags: [v3, integrations, search]
---
# Read-only provider search from token-backed launcher

Settings token fallback should support useful read-only discovery, not just account verification. Add main-process provider search for existing Slack DMs by name, Front conversations, and GitHub PRs with explicit source-prefixed queries. Return canonical browser URLs as existing globally unique tile resources; do not create DMs, send messages or change external objects. Respect scopes and surface missing-scope errors. Test with mocked HTTPS responses only until real credentials supplied.

## Acceptance Criteria

dm Carl, mail subject/from, and pr query can return provider resources when a scoped token is available; no token leaves main process; API failures/scopes visible; opening returned resources uses the same deduplicating tile registry.


## Notes

**2026-10-07T22:48:17Z**

Implemented main-process read-only provider search. Mocked HTTPS tests cover existing Slack DMs/users, messages/mentions, Front conversation search and GitHub review requests. Fixed credential destinations, header-only bearer tokens, redirect rejection, bounded caches/pages, missing-scope errors and rate-limit backoff. Sandboxed provider-result handoff test passes unique URL ownership, naming, existing-owner navigation and shelving. No real account credentials supplied; native source bodies/replies remain browser-backed.
