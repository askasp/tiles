---
id: cha-gdc1
status: closed
deps: []
links: []
created: 2026-10-08T13:05:32Z
type: bug
priority: 0
assignee: aksel
tags: [macos, startup]
---
# Fix fresh macOS Electron installation and cross-platform startup checks

electron-vite bypasses Electron 44 lazy binary installation and throws Electron uninstall when path.txt is absent; current doctor only checks Linux. Install the platform binary during npm install, provide an explicit repair command, and validate binary/path/version before dev startup on every platform without automatic downloads during doctor.


## Notes

**2026-10-08T13:07:25Z**

Confirmed root cause from installed Electron 44.7.0 and electron-vite: Electron package has lazy binary installation rather than a package postinstall, while electron-vite reads path.txt directly and throws Electron uninstall when absent. Added app postinstall and setup:electron explicit installer, read-only cross-platform marker/version/executable checks (including macOS .app path), and documented SSH loopback connection. Verified npm run setup:electron, doctor, production build/typecheck, 86 unit/security tests (5 new simulated macOS/Linux/Windows installation cases), and sandboxed development renderer test. Actual macOS execution requires user verification; no remote OpenCode server changes.
