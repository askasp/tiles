---
id: cha-b5mi
status: closed
deps: []
links: []
created: 2026-10-07T21:38:03Z
type: bug
priority: 0
assignee: aksel
tags: [v0.1, linux, security]
---
# Catch Linux sandbox setup before Electron launch

User hit chrome-sandbox fatal error: helper is aksel:aksel 755. Requires sudo chown root:root and chmod 4755. Add actionable preflight without disabling sandbox. Earlier Playwright smoke launches silently injected --no-sandbox; explicitly set chromiumSandbox:true and use the project's installed Electron executable. Full sandbox test rerun requires user's interactive sudo.

## Acceptance Criteria

npm dev/start diagnose bad helper clearly; no automatic sudo or --no-sandbox; desktop tests run installed Electron with chromiumSandbox:true after user configures helper; docs corrected.


## Notes

**2026-10-07T21:39:09Z**

Added Linux helper preflight to dev/start, npm run doctor, explicit installed Electron executable and chromiumSandbox:true to desktop tests, and corrected verification docs. Earlier Playwright runs silently injected --no-sandbox. Sudo cannot run unattended here; waiting for Aksel to chown root:root and chmod 4755 on the exact helper, then rerun desktop tests.

**2026-10-07T22:20:27Z**

Helper now root:root 4755. Explicit installed-Electron chromiumSandbox:true tests passed for development renderer, live read-only session and v3 messages/browser move/restart workflow. Startup preflight is verified.
