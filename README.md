# ChatOS · tiles and declarative connectors

An Electron desktop following the unique-resource model in `ChatOS Flows v3.html`, with the declarative connector foundation from `ChatOS Flows v4.html`.
**No fixed chat column. No nested browser tabs. One resource, one tile, one place.**

## Run

```sh
cd /home/aksel/git/chatos
npm install
npm run dev
```

Or `npm run build` then `npm start`.

### First launch (clean install)

1. K opens and asks for one thing: **a model**. Paste a base URL and key for any OpenAI-compatible endpoint (the key is checked as you paste it, and the model list fills in), or choose **Use a local model instead** (e.g. Ollama at `http://localhost:11434/v1`, no key). K's model is independent of every source: a ChatGPT Plus/Pro subscription is not an API key, so use an OpenAI API key (billed separately) or a local model. **Skip for now** is allowed: Browser, Files and Terminal work without a model. Type `model` in K later to set it up.
2. The desktop starts empty. Built in: **Browser**, **Files** (folders, text and images) and **Terminal** (a real shell in any folder, `Super+T` or `terminal` in K). Nothing else is preinstalled, listed or contacted.
3. Everything else is a source you add with K: `add opencode`, `add front`, `add github`, `add slack`, or `add <anything with an API>`. Tab in an empty K walks the sources and ends on **Add source**.

OpenCode is opt-in. `add opencode` finds the CLI and a running background service, and offers to connect to it, start it (`opencode serve --service`, which keeps running for your other OpenCode clients) or connect to a URL. Once connected, it is remembered across restarts. **Settings → Sources → Remove** forgets it; ChatOS never stops the service.

K finds folders and files by name: Spotlight on macOS, and a bounded, background-indexed walk of your home folder elsewhere (hidden folders, `node_modules`, `Library` and build output are skipped).

Electron 44 downloads its executable separately from its npm package. `npm install` now runs that installer explicitly on macOS/Linux/Windows, since `electron-vite` cannot trigger Electron's lazy installation itself. If you see **Electron uninstall**, or npm installation scripts were disabled, run `npm run setup:electron`, then `npm run doctor` and retry. No deletion of `node_modules` is needed. Use Node 22.12+ (prefer a current Node LTS); the platform/architecture is detected by Electron's installer. Startup checks now validate the installed executable on every platform before starting Vite; doctor itself does not download anything.

On Linux, `npm run doctor` checks the installed Electron sandbox helper. If it reports a setup problem, run the exact `sudo chown root:root` and `sudo chmod 4755` commands it prints. Sandboxing stays enabled. Reinstalling Electron can replace the helper and require setup again.

## The tile model

- Sessions, OpenCode project lists/session lists, local folders/files, Front inboxes/conversations, browsers, repository review and custom connector resources use the same tile header.
- **Collection → independent item tile** is the connector contract. Lists do not contain nested tile tabs. Once OpenCode is added, `opencode projects` in K opens the project collection; each project opens its session collection, and each session opens its own conversation. Opening any of these does not create a session.
- One visible tile fills the workspace; two split it; three use a big slot and two stacked slots; four form a grid.
- Promote moves the focused tile to the first/big slot. In a four-tile grid, promotion temporarily enlarges it fullscreen rather than making the neighbours too small; promote again or use fullscreen to return.
- Opening a fifth shelves the least recently focused tile. It keeps running, stays searchable, and can be restored.
- Opening a session or normalized full URL already visible takes you to its owner workspace—even if you request a new workspace. Nothing is copied.
- Give opaque browser resources a stable local name with the header pencil (e.g. **DM Carl**, **Mail · replies to me**). Search matches the name and original title/URL; browser title changes do not overwrite your name.
- Workspace numbers stay stable: removing workspace 1 never turns workspace 2 into workspace 1. Empty workspaces disappear when you leave them.
- Links you open from a session become independent browser tiles linked to that session. Moving or shelving the session takes its previews too. Moving a linked preview also takes its parent; shelving only the preview leaves the session visible.
- **× shelves a tile.** Closing it with Cmd+W (Super+W, or Ctrl+Alt+W) is local too: the OpenCode session continues, its draft remains, and search can reopen it.
- Layout undo restores placement, not old drafts or sent messages. It never undoes server actions.
- Switching workspaces or shelving keeps mounted tile bodies: chat reading position, partial agent answers and repository review state stay intact during the run.

V1/V2 browser-local state migrates automatically into main-process SQLite, preserving drafts and unique browser URLs. Old `chatos.workspace.v1` / `chatos.desktop.v2` entries remain untouched as migration sources; they are no longer updated. Browser duplicates in old stage tabs become one tile. Screenshot attachments are intentionally not persisted.

Browser views have no desktop preload, Node access or app tokens. They use a shared, persistent desktop web profile so sign-ins survive workspace moves. Moving/hiding a tile during a run retains the actual page; restarting reloads its saved URL. Different URLs—including different fragments or queries—remain different resources.

## Keyboard workflow

“System” means **Cmd on macOS**, **Super on Linux**, or **Ctrl+Alt** if i3 captures Super. Shortcuts are app-local; ChatOS does not take over your window manager’s global bindings.

| Action | Shortcut |
| --- | --- |
| Find or open anything (K) | Ctrl+K / System+K / System+Space |
| Choose a result in K | ↑↓ / Ctrl+J or Ctrl+N down / Ctrl+K or Ctrl+P up |
| K: open here, or go to the existing tile | Enter |
| K: move here, with linked tiles / in a new workspace | Shift+Enter / Ctrl+Enter or Cmd+Enter (also with a click) |
| K: other actions for a result / back | → or Ctrl+L / ← or Ctrl+H |
| K: narrow to a source, then Add source | Tab (Backspace in an empty K widens again) |
| **Window keys (vim): Ctrl+W, then…** | h j k l focus · H J K L swap · w / W next / previous · o fullscreen · x promote · − shelf · = restore · q close |
| Inside a list (files, sessions, inbox, rows) | j / k down / up · l open · h back |
| Files: open here / beside / new workspace | Enter / Ctrl+Enter / Ctrl+Shift+Enter |
| Files: back / forward / up / refresh | Backspace or h or Alt+← / Alt+→ / - / r |
| Files: actions on this folder | t terminal · s OpenCode sessions · n new session |
| Rename focused tile | F2 |
| Empty desktop / workspace 1–9 | System+0 / 1–9 |
| Move tile and linked tiles to a workspace | System+Shift+1–9 |
| Focus / swap with System keys | System+arrows or H/J/L · System+Shift+arrows |
| Promote / fullscreen | System+Enter / System+F |
| Shelf / restore last shelved tile | System+− / System+= |
| Close tile | Cmd+W (System+W) / Ctrl+W q |
| Restore last closed tile | Ctrl+Shift+T |
| Workspace and shelf overview | System+Tab |
| Go to what is waiting on you | System+U |
| Undo arrangement | System+Z |
| Cycle tiles | Ctrl+Tab / Ctrl+Shift+Tab |
| Terminal in the focused folder (home if none) | System+T, or K → Tab to Terminal → Enter |
| New item like the focused tile: a session next to a session, a terminal in a terminal's folder, a page in a browser | System+N |
| Settings | System+, |
| Browser address / new browser tile | Ctrl+L, Alt+D or F6 / Ctrl+T |
| Selection or page as context to another tile (never sends) | Ctrl+. |

Buttons are icons that show their key; the key does the same thing. Ctrl+W shows a short hint while it waits for its second key (1.5 s), in a page too.

While a **terminal** has focus, plain Ctrl keys (Ctrl+W, Ctrl+L, Ctrl+K…) belong to the shell, so vim in a terminal keeps its own Ctrl+W; use System or Ctrl+Alt chords to manage tiles from there. While a dialog such as K is open, plain Ctrl keys belong to it. In web pages, Ctrl+K opens K and Ctrl+W starts the window chord. Text undo remains Ctrl+Z; Ctrl+Z in an **empty launcher** undoes an arrangement.

### Appearance

Settings → Appearance: System (follows the OS, live), Light or Dark. The choice is saved, applied before the first frame, and also sets Electron's theme so web pages in Browser tiles follow it. Light mode uses a darker desktop so white tiles stand out; dark mode lifts tiles off a near-black desktop. All colours are tokens in `src/renderer/styles.css`.

### Finding folders and paths

K finds files and folders by name (Spotlight on macOS, falling back to an index of your home folder when Spotlight returns nothing) and completes paths like a shell: `~/git`, `~/git/ch`, `/Users/me/…`. Narrowed to Terminal, a name or path offers a terminal there; with nothing typed, a terminal in the focused folder or at home.

### How sources plug in

Every source (Browser, Files, Terminal, generated connectors, Front, Slack, GitHub, OpenCode) implements one renderer interface, `Source` in `src/renderer/sources/types.ts`: search results, slower async search, commands such as “start session in …”, → actions it offers on any resource, its tiles, status chips, attention, shortcuts, context targets, its `add …` setup panel and its Settings row. The core desktop, K and Settings know no source by name.

Optional sources are listed in exactly three registries: `src/shared/registry.ts` (+ `registry-api.ts` for its API namespace), `src/main/registry.ts` and `src/renderer/sources/registry.ts`. OpenCode lives entirely in `src/shared/sources/opencode/`, `src/main/sources/opencode.ts` and `src/renderer/sources/opencode/`; deleting those and its one line in each registry still builds. Its API is namespaced (`window.chatos.opencode.*`, IPC `chatos:opencode.*`) and its live events arrive as `{ type: 'source', source: 'opencode' }`.

### A long day stays bounded

Shelved tiles stay live (pages keep scroll and logins) up to 8; older ones close, releasing their page while keeping identity, name and draft, and K reopens them in place. Terminals are never closed automatically. The 200 most recent closed tiles are remembered (any with an unsent draft or context always are). Workspaces are capped at the nine reachable with System+1–9; Ctrl+Enter beyond that opens in the current one. The desktop is saved within 100 ms of a change even while pages and sessions keep updating. `tests/desktop/developer-day.spec.ts` simulates a day (Slack DMs, tagged Front mail with a comment and a reply, 3 sessions in each of 2 projects, heavy open/move/shelf/close, a restart) and checks that live pages match live tiles and what's saved matches the screen; set `DAY_PASSES=12` for a longer day. `tests/desktop/real-e2e.spec.ts` (`CHATOS_REAL_E2E=1`, optional `CHATOS_MODEL_URL`) runs a fresh install against real services on the machine: a local OpenAI-compatible model, K building a connector for a public API and reading it, the running OpenCode service with one throwaway session in a temp folder, Files navigation and window keys.

K's model may be small and local. K states the connector rules explicitly, maps harmless near-misses (`items: "."`, `view: "detail"`), and sends a rejected proposal back to the model with the exact validator error (twice at most); errors name the operation or recipe. `<think>` blocks are ignored.

### Sources, resources and actions

The launcher searches all known tiles (visible, shelved and closed), project folders and server session titles. Every result shows **source · resource type · action**, plus its path or existing owner. Searching `chatos` (or `open chatos`) offers separate **Files · Folder · Browse files** and **OpenCode · Project · Show sessions** results. Neither creates a session. Equally relevant resources you used recently rank higher; their action remains visible.

Search everywhere by default, or press Tab to narrow to a source (Tab again moves to the next, then to **Add source**). Typing `OpenCode` and pressing Enter enters that source's search without opening a tile. Empty Backspace returns to all sources. Source scoping is optional navigation, not a nested tile container. You can also use prefixes (`opencode chatos`, `files chatos`, `web example.com`, `mail …`, `slack …`, `github …`). Short `dm …` / `pr …` commands request provider discovery but retain universal local matches, so a session named **PR cleanup** or a renamed **DM Carl** tile stays findable.

- `browse the chatos files` / `browse files in chatos`: find the local folder tile.
- `open the chatos sessions in OpenCode`: find the OpenCode project/session list.
- `start an OpenCode session in chatos` / `new session`: explicit session creation; an unknown project name does not fall back to an unrelated directory.
- `files /absolute/path`: open a local folder or text-file preview, with errors kept visible in the launcher.
- `just Consent reload` / `hide everything but Consent reload`: shelve other tiles.

These built-in commands use explicit local patterns. Custom sources also participate in universal search and have source chips. **Ask AI to find…** translates a free-form request into approved collection searches, without tools or write actions. Multiple matches remain candidates; AI does not silently pick or open one. OpenCode's SDK still handles its specialized session UI and streaming.

### Add a service without application code changes

1. In K, type `add <service>` and press Enter. K asks your model (never OpenCode) for a connector. It may ask follow-ups; reply in K, or paste a link to the public API docs, which ChatOS fetches once (GET, HTTPS, bounded, converted to inert text) and passes on as data.
2. K shows **Resource → Opens as → Actions**. **Keep** saves it, **Adjust** opens the JSON editor. For hand-written connectors use **Settings → Write a connector by hand**.
3. Inspect **Resource → Opens as → Row opens / actions**, and edit the JSON. **Keep mapping** validates it and asks for native approval of destinations, auth and write capabilities. No API requests run just because a model produced a proposal.
4. Authenticate with a scoped bearer token, or a registered native OAuth client. Open a collection to check the API and field mapping. Rows open separate detail/child-collection tiles; **Open filtered list** gives a distinct collection identity.
5. Reopen the mapping from a tile's **Mapping** button. **Version history → Preview v… → Keep** creates a new approved revision rather than destroying history.

Recipes use a fixed renderer set: **List, sortable Table, chronological Timeline, Record, Document, Conversation, Diff**. Conversation messages have fixed **message / internal note / tool-call / event** kinds, optional author/time mappings; fields support text/number/date/badge kinds. Documents render Markdown with raw HTML disabled and remote images omitted. Other HTML is converted to inert text; diff text stays literal. Links require a click and open an independent browser tile. No generated React, scripts, iframes or arbitrary executable components are accepted.

Collection rows specify `itemRecipe`. `idField`, `titleField`, optional `subtitleField`, `textField`, `fields`, and message mappings use simple dotted JSON paths. `items: ""` selects a root array; `items: "data"` selects an envelope. `parentField` preserves channel/container context from search results. Item recipes can use `identityScope: "parent"` for IDs that are only unique within a container, such as Slack thread timestamps. Alternate item recipes can share an `identity` namespace to avoid duplicate tiles. Keep identity namespaces stable when adjusting presentation. Use separate connector IDs for separate accounts (e.g. `gmail-work` and `gmail-personal`).

Operations use a fixed relative path, optional `{id}` / `{parent}` path parameters, and string-valued query/JSON-body mappings with `{query}`, `{cursor}`, `{draft}`. Cursor/page-number pagination uses `{cursor}` and a recipe's `nextField`. For services returning pagination URLs, declare `pagination: "next-url"`: only the **same origin and exact operation path**, with explicitly declared query keys, are accepted. There is no arbitrary URL following.

Only **GET** is classified as read-only. Every POST/PUT/PATCH/DELETE must declare `effect: "write"`, be registered as a tile action, and receive **a separate native confirmation showing the exact URL, method and JSON body**. Duplicate pending actions are suppressed. Failed/ambiguous writes are never automatically retried; check the service before explicitly retrying. Cancelling preserves drafts. Successful reply actions clear only the draft they consumed, not later edits; unrelated actions keep the draft. Layout undo does not undo API changes. A service must honor HTTP conventions; a misbehaving GET endpoint is not made safe by a schema.

The broker allows HTTPS APIs and explicitly configured loopback HTTP APIs. Remote private/link-local addresses, credentials in URLs, arbitrary headers, dynamic hosts, redirects and DNS rebinding are blocked. Reads are bounded to 1 MB responses, 100 items/messages per page, explicit pagination, and 8 collection searches per launcher request. Rate limits back off; hidden tiles do not poll. Tokens never enter model prompts, recipes or renderer status responses. The text you paste into the AI documentation/request fields **does** go to your selected model: do not paste secrets or private responses.

**Compatibility is deliberately bounded:** HTTPS JSON REST APIs with these mappings are supported, not literally every service. Nested/typed write bodies, custom signatures, GraphQL, IMAP/SMTP, binary/media, multi-request response joins, advanced calendar/board UIs, webhook/background sync and offline API-content caching need additional audited capabilities. Timeline is chronological, not a full calendar time grid. Existing OpenCode and Front renderers remain optimized built-in adapters, not falsely labeled AI-generated recipes. Automatic documentation discovery and a standalone model-first onboarding flow remain follow-ups.

### OAuth for custom connectors

`auth.type: "oauth-required"` intentionally blocks requests until a client is configured. It never accepts an app password as a substitute for Gmail REST OAuth. To use the broker, configure a **registered native/public client**:

```json
{
  "type": "oauth2",
  "oauth": {
    "clientID": "YOUR_REGISTERED_NATIVE_CLIENT_ID",
    "authorizationURL": "https://accounts.example.com/authorize",
    "tokenURL": "https://accounts.example.com/token",
    "scopes": ["tickets:read"],
    "offline": true
  }
}
```

This replaces the connector's `auth` object. **Sign in with OAuth** approves the authorization, token and API destinations/scopes, then opens the system browser. Authorization Code + PKCE and random state use `http://127.0.0.1:PORT/oauth/callback`; configure `callbackPort` if your provider needs a fixed registered port. `offline` requests `access_type=offline` where supported. If a provider's native client requires a client secret, supply it in the separate password field—not JSON. Access/refresh tokens and that secret remain in the main process. Refresh happens before expiry, with serialized refreshes and rotation support. Missing/expired/rejected refresh credentials require sign-in again; writes are not replayed after an auth failure. Registration, consent configuration and scope approval are still your/provider responsibilities. Device grants, confidential web-app clients and arbitrary OAuth variants are not supported. OAuth has fixture coverage, not a claim of real Google/Slack/Front account verification.

### Durable local storage

`chatos.sqlite` lives under Electron's **user-data directory** (`CHATOS_USER_DATA` overrides it for isolated tests). No new SQLite package/native rebuild is needed: Electron's Node runtime provides `node:sqlite`.

- A single app instance per profile and main-process writer use **WAL, FULL synchronous commits, transactions, a busy timeout and schema versioning**.
- Tables separate desktop state, bounded desktop snapshots, connector definitions, revision history and OS-encrypted credential blobs. Desktop saves include layout, resource references, tile titles and drafts—not loaded response/file bodies, browser cookies or screenshot attachments.
- Desktop writes are coalesced over 100 ms, then synchronously flushed on normal window unload. Sudden process/power failure can lose the most recent unsaved edits; prior committed transactions remain recoverable.
- Legacy browser-local state and `services.json` settings/ciphertext migrate once, retaining the original sources. SQLite becomes authoritative; corrupt/newer databases are **not silently reset**. Save errors are visible and keep the previous committed save.
- Retains 10 prior desktop snapshots (at most one per minute) and 20 revisions per connector. Changing an API/auth destination atomically removes its stored credential before the new mapping can use it.
- Existing-profile startup creates an online backup at most daily. **Connections → Create database backup** creates one explicitly; only the latest five timestamped backups are retained under `backups/`. SQLite backups are consistent even while WAL is active.
- Database/backup permissions are `0600`; newly created storage/backup directories are `0700`. Tokens are ciphertext protected with Electron `safeStorage` and its OS-backed secret store, not plaintext database fields. Linux `basic_text` is rejected; without secure storage, credentials stay in memory only. Layouts/drafts are not encrypted by ChatOS—use OS disk encryption for whole-profile protection.

Backups contain private drafts and may retain earlier **encrypted** credentials. Treat them as private; forgetting a local credential is not provider-side revocation. To recover a full backup, quit ChatOS, preserve the current database **and its WAL/SHM files** elsewhere, then copy the chosen backup to `chatos.sqlite` without stale sidecars. Do not replace a live SQLite database. Mapping revisions can be restored directly through the UI without replacing the database.

### Files tiles

Folders and files are independent native resources, not OpenCode projects or sessions. **Enter navigates the tile in place** (into a subfolder, or into a file), Ctrl+Enter opens beside, and each Files tile has its own Back/Forward history; if the target is already open in another tile, Enter goes there instead. Folder rows support ↑/↓ and Enter, and their filter matches the loaded folder's names. Opening a child or parent goes to its own unique tile; LRU shelving keeps the desktop bounded. Folder tiles offer **Open terminal here**, and, once OpenCode is a source, **Show OpenCode sessions** and **Start OpenCode session here**. OpenCode project tiles offer **Browse files**. Image files (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG up to 25 MB) open in an image viewer; SVG renders as an image, so scripts never run.

Terminal tiles run your login shell in a real pseudo-terminal via `@lydell/node-pty` (prebuilt N-API binaries for macOS, Linux and Windows, so nothing is compiled for Electron; packaged builds unpack it from the asar). If it can't load, Linux falls back to the system `script` command; macOS's BSD `script` cannot work without a terminal on its input. Shelving keeps the shell running; closing the tile ends it. After a restart the tile comes back and starts a fresh shell in the same folder. While a terminal has focus, plain Ctrl chords (Ctrl+W, Ctrl+L, Ctrl+K…) go to the shell; Super / Ctrl+Alt chords still manage tiles.

Local file access is read-only, through the main process. Symlink targets resolve to canonical identities before opening. Directory listings are bounded at 1,000 entries; text previews at 256 KiB. Binary/non-UTF-8 files and system pseudo-files are not previewed. HTML/scripts are displayed as inert text, not executed. File content is not stored in desktop persistence; paths and tile ownership survive restart, then contents reload. **Files are local to the desktop machine**; an OpenCode server's remote-only path may not exist locally. This is a navigator/text reader, not a file editor or recursive indexed filesystem search.

## Accounts and authentication

Click **Settings** (gear) for OpenCode connection settings, Slack, Front and GitHub accounts, and shortcut help.

- **Browser sign-in:** save your HTTPS workspace/home URL and open it as a unique tile. Use the service’s normal login or SSO. Some identity providers may restrict embedded Chromium sign-in; API tokens do not log you into a browser page.
- **API-token fallback:** paste a scoped token, save it, then explicitly Verify. Verification only reads account identity; it sends no messages, changes no PRs and reads no inboxes.
- Tokens live in Electron’s main process. With a working OS secret store they are encrypted on disk. Without one—including Linux `basic_text`—they stay only in memory for this run. No plaintext tokens are saved or returned by the status API; password inputs clear after saving.
- Remove token deletes the API credential. It does not log out a web browser; use the provider’s own Sign out control for that.
- Built-in Slack/Front/GitHub provider app OAuth is **not configured yet**. Custom JSON connectors can use the PKCE/refresh broker above when you supply a compatible registered client. No real provider credentials/client registrations have been supplied.

Front supports **API-native inbox and conversation tiles**. Slack/GitHub bodies are still browser-backed, with read-only API discovery in the launcher when you supply tokens:

- `dm Carl` discovers an **existing** Slack DM by display/real name. It never creates a DM. A workspace-scoped **user** token needs `users:read` + `im:read`.
- `slack mentions` and `slack search terms` use message search with `search:read`.
- `mail from:address@example.com`, `mail subject words` or `front ...` open a native Front list using its documented conversation-search syntax and `conversations:read`. Select a conversation to read its messages directly; that also needs `messages:read`.
- `pr reviews` finds open PRs requesting your review; `pr repo:owner/repo words` supports GitHub search qualifiers. Your token must have access to those repositories.

Requests use fixed HTTPS provider endpoints with bearer tokens in headers only, redirect rejection, bounded results, short-lived caches and rate-limit backoff. Missing tokens/scopes are visible. Search never sends messages, opens a new DM, marks mail read or changes a PR. Results use the same unique tile registry; labels survive generic page-title updates. Front native reading needs only the token, not a browser login. Browser cookies are independent and only needed for web fallback.

### Native Front workflow

1. In K, type `add front`, paste your scoped API token and press Enter. It is checked, and Front becomes a source. `front` / `mail` in K open the inbox; **Settings → Sources → Front** has the token, filters and **Open Front API inbox**.
2. Optionally save **your email, Front teammate ID and tag ID** under Personal mail filters. The native inbox then provides **Addressed to me**, **Assigned to me**, **Mentions**, **Tagged**, and **Replies to my mail** buttons. Front needs `tea_…` and `tag_…` IDs rather than names.
3. Select a conversation with the mouse, or use ↑/↓ and Enter in the list. Its native message tile shows sender/recipients, message text, status, tags and attachment names. No Front web view is loaded.
4. Each query is its own unique, persistable tile. Reopen `mail to:you@example.com`, `mail mention:tea_YOUR_ID`, `mail tag:tag_TAG_ID` or `mail author:tea_YOUR_ID is:unreplied` to go to that list. Use the shared pencil to give it a short name, e.g. **Mail · replies**.
5. Use **Refresh**, **More conversations**, or **Older messages** to fetch more data. Hidden Front tiles do not poll the service. Loaded content stays in memory, not desktop localStorage; restart reloads through the API.

“Replies to my mail” means conversations you authored whose latest message is inbound—not a precise “new replies since last seen” feed. The API token must have access to the inboxes you want; private inboxes may need an administrator to allow API access.

Email HTML is converted to plain text in the main process before rendering. Scripts, iframes, remote images/tracking pixels and automatic attachment downloads are excluded. Reading uses only GET requests and never marks mail read, archives or assigns. **Open in Front / reply** switches the same conversation tile to its web presentation; **Use Front API** switches back without creating another copy. **Comment** (internal, team only) and **Reply** (to the people on the conversation) are native: each opens a native confirmation showing the exact text and the Front API URL, posts once, and is never retried automatically. Your teammate ID from the Front settings is sent as the author. The draft lives on the tile, so it survives moves and restarts. Attachment downloads still use the web fallback. Merged-conversation redirects are not followed with credentials; the error points you to web fallback.

Front archive/assign actions and continuous provider notifications are not implemented. API reads and discovery have been verified with mocked responses and sandboxed desktop fixtures, **not real account credentials**. Slack DM directory scans are bounded to 2,000 users/conversations; launcher source results are limited to 20. Front native lists/messages fetch 25 items per page with explicit pagination. You can always open full URLs manually. The workday fixture uses private resources, not your accounts.

Select text in a browser and use **Ctrl+.** to add only that selection to its linked session’s draft, or choose a destination session for an unlinked tile. Password fields are excluded. Nothing is sent until you explicitly send the session draft. The page toolbar’s Attach action adds page context instead of just the selection.

## OpenCode connection

Add it with `add opencode` in K. Automatic discovery keeps local service credentials in the main process. A manual URL is remembered; its token is stored with OS encryption (memory only without a secure store). Remote services require HTTPS. Environment overrides: `CHATOS_SERVER_URL`, `CHATOS_SERVER_TOKEN` and `CHATOS_DIRECTORY`.

Existing managed Basic-auth services should use auto-discovery rather than a bare manual URL. Browser tiles remain usable when OpenCode is disconnected.

For SSH forwarding, choose **Connect to a server URL** in `add opencode` and enter `http://127.0.0.1:LOCAL_PORT`. HTTP is allowed for loopback; SSH encrypts the remote hop. Server authentication still applies. Example: `ssh -N -L 4096:127.0.0.1:4096 user@server` when OpenCode listens on port 4096 on the remote machine. Adjust both ports as needed; the server can stay bound to its loopback interface.

## Checks

```sh
npm run doctor
npm run typecheck
npm test
npm run check:server          # Read-only live-service check
xvfb-run -a npm run test:desktop
```

Desktop tests use **the installed Electron executable with `chromiumSandbox: true`**, isolated temporary profiles, and private fixture servers. Only the live-session smoke test reads the real OpenCode server; it never prompts or changes a session. On a desktop display, omit `xvfb-run -a`.

The unit workday scenario simulates eight hours with 960 resource opens/switches. The desktop scenario exercises five sessions across two projects and repeated DM/mentions/inbox/replies/PR interruptions. These are accelerated simulations, not claims of eight hours of elapsed testing.

For actual sustained operation, first build, then opt into the workflow soak:

```sh
CHATOS_SOAK_HOURS=3 xvfb-run -a npm run test:soak
```

The soak continuously opens/focuses/moves private fixture resources, verifies draft/ownership invariants, responds to fixture permissions and restarts periodically. Trace recording is disabled to avoid enormous three-hour traces. Metrics and final outcomes go to `/tmp/opencode/chatos-soak-results/`. It is not part of the normal test duration. A soak run is **not a pass until its completion result is recorded**.

## Remaining scope

Integrated terminal/editor, specialized native Slack/GitHub bodies, built-in Front write actions/comments/downloads, agent control of browser tiles, broader AI-backed launcher commands, background provider sync, real provider-account verification and macOS packaging validation remain follow-up work. Custom recipe actions and OAuth are available as described above; they do not imply the built-in Front adapter has gained those capabilities. Review is read-only against the repository’s default base. `npm run pack` / `npm run dist` provide packaging entrypoints; build macOS packages on macOS.

Work is tracked by `tk` in `.tickets/`, with V3 epic `cha-85ms` and execution-loop task `cha-6nlg`. No Git repository or commits have been created automatically.
