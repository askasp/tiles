---
id: cha-o8mt
status: open
deps: []
links: []
created: 2026-10-08T07:08:53Z
type: epic
priority: 0
assignee: aksel
parent: cha-85ms
tags: [architecture, connectors, ai, tiles]
---
# AI-authored connectors and tile recipes instead of provider-specific code

User clarified the product abstraction: describe any API service in natural language, let AI discover/document its capabilities and auth requirements, authenticate via a secure broker, then request an inbox/conversation/thread in natural language and get a purpose-designed unique native tile. Service endpoints, response mappings, search operations, identity and tile layout must be editable persisted connector/recipe data, not per-service React/IPC additions. Use OpenCode V2 one-shot generate.text where appropriate (available in installed client) so planning cannot run tools or alter server sessions. API credentials never enter prompts or tile recipes. Preserve existing Front/browser workflows while introducing the generic runtime. Gmail REST needs OAuth and registered Google client configuration; app passwords are IMAP/SMTP, which requires a separate protocol adapter. Do not promise literal universal compatibility.

## Acceptance Criteria

Connect-to-service and open-specific-resource workflows work without app code edits for supported HTTPS JSON APIs; AI produces validated declarative connector and tile recipes; user sees/approves credential destinations and scopes; OAuth/refresh or token auth uses the main-process broker; search uses approved operations and disambiguates results; resource IDs dedupe across queries and presentations; native layouts derive from recipes; untrusted docs/API data cannot execute code, reveal credentials or trigger writes; mock two unrelated APIs and Gmail auth-required flow; document protocol/auth limitations honestly.


## Notes

**2026-10-08T12:23:56Z**

Core declarative connector/runtime/storage foundation delivered in cha-d2va. AI produces validated JSON rather than UI code; fixed renderers and collection-to-independent-item navigation; UI approval, OAuth PKCE/refresh, native write confirmation and SQLite persistence now implemented. Preserved built-in OpenCode/Front adapters. Remaining scope includes automatic public documentation discovery, standalone model-first onboarding, richer nested/typed/encoded response mappings, background sync, and real registered provider/client validation. See README compatibility/auth/storage sections; do not imply universal API support or a fresh extended soak pass.
