---
id: cha-uok2
status: closed
deps: []
links: []
created: 2026-10-07T22:05:40Z
type: task
priority: 1
assignee: aksel
parent: cha-85ms
tags: [v3, auth]
---
# Service authentication settings for Slack Front GitHub

Settings page with browser login launch URLs, token fallback, read-only token validation, disconnect, and main-process-only encrypted secure storage. Never put tokens in localStorage or return them to renderer; refuse disk persistence when Electron uses basic_text. OAuth requires provider app client IDs and registered redirect URIs; communicate configuration requirements rather than pretending generic OAuth works.

## Acceptance Criteria

Settings opens and saves nonsecret URLs; browser sign-in goes to a unique service tile; tokens stay main-process-only; test token save/disconnect and secure storage failure path without real credentials.


## Notes

**2026-10-07T22:21:34Z**

Added Slack/Front/GitHub auth settings, scoped HTTPS service URLs, browser login, API-token save/verify/remove. Main-process-only token storage uses real OS encryption or ephemeral memory, rejects basic_text fallback. Three security tests and one sandboxed settings workflow pass. App OAuth needs registered provider client IDs/redirects; UI explains it. Native inbox API connectors are not yet implemented.

**2026-10-07T22:32:35Z**

Seven sandbox-enabled desktop tests now pass, including native browser shortcut routing, popup deduplication, background attention, forms, five-session workday and auth settings. Additional continuity/alias/send-race regressions are being exercised before the final handoff.
