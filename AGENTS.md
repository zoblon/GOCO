# GOCO – project notes for coding agents

GOCO transfers Google Calendar entries (secret iCal address) to MOCO time tracking. It is a macOS app: an AppleScript applet starts a bundled Node.js server (no npm dependencies) that serves a single-page web UI on `127.0.0.1:3457`. UI language is German; code, comments and docs are English (README.de.md and docs/GOCO-Anleitung.md are German on purpose).

## Layout

- `src/goco-standalone.js` – launchd hand-off, HTTP server, ICS/RRULE parser, OpenAI matching and the whole web UI as one template literal (`APP_HTML`).
- `src/goco-sync-core.js` – pure reconciliation and booking-plan logic; runs in the browser (global `GOCO_SYNC_CORE`) and in Node.
- `src/goco-sync-server.js` – MOCO adapter, bulk booking, per-day lock, operation journal.
- `src/goco-workflow.js` – browser-side daily workflow; loaded after `APP_HTML`'s script and overrides some of its functions.
- `app/` – `main.applescript` (launcher), `Info.plist` (bundle id, version, build), `applet.icns`.
- `scripts/build-app.sh` – builds `build/GOCO.app` and `dist/GOCO-<version>[-x64].zip`. No Node binary is stored in git.
- `test/` – `node:test` suites. `docs/releases/v<version>.md` – release notes used by the release workflow.

## Commands

```bash
npm run check                  # node --check for src/*.js
npm test                       # node --test test/*.test.js
scripts/build-app.sh           # build + ad hoc sign + codesign --verify + zip (macOS only)
GOCO_FOREGROUND=1 PORT=3999 GOCO_TEST_FIXTURES=1 GOCO_JOURNAL_DIR=$(mktemp -d) node src/goco-standalone.js
```

`GOCO_TEST_FIXTURES=1` serves synthetic calendar/MOCO answers and never contacts Google, MOCO or OpenAI. `OPENAI_API_URL` redirects the AI call (tests use a local stub). Never test against real MOCO accounts or with `launchctl` services of a real install.

## Pitfalls

- **Template literal escaping:** everything inside `APP_HTML` is a JS template literal, so every backslash that must reach the browser has to be doubled (`\\s`, `\\b`, `\\d`, `\\n`). A single `\s` silently becomes `s`. `test/standalone.test.js` guards this; also keep new client code free of backticks and `${`.
- **Version in three places:** `APP_VERSION` in `src/goco-standalone.js`, `CFBundleShortVersionString` (+ increment `CFBundleVersion`) in `app/Info.plist`, `version` in `package.json`. A test checks they match. Release notes go to `docs/releases/v<version>.md`.
- **Port in two places:** `PORT` default in `goco-standalone.js` and the URL in `app/main.applescript`.
- **launchd:** the first start hands the server to `launchd` (label `io.github.zoblon.goco.server`); a second start reuses the running service, so changed server code only takes effect after `launchctl remove io.github.zoblon.goco.server`. Do not add `kill -9`/`kickstart -k` to the normal start path (causes a throttled restart gap and `ERR_CONNECTION_REFUSED`). Use `GOCO_FOREGROUND=1` for development.
- **Gatekeeper translocation:** a quarantined app runs from a read-only copy; edits to the original are not seen. `xattr -dr com.apple.quarantine GOCO.app`.
- **Signing:** any change inside the bundle requires re-signing (`codesign --force --deep --sign - --identifier io.github.zoblon.goco`). Do not put extra files next to `Contents`. The build script does all of this.
- **Booking safety:** never book blindly. Sync state is bound to MOCO account, user and date; unclear POST results are re-read, never re-sent. Keep the server-side check that only `calendar` items are booked.
- **AI exclusion:** the setting `aiExcludeTerms` (comma-separated, case-insensitive "name contains") is enforced on the server (`buildAiCandidates`, `normalizeMatches`); excluded terms are never sent to OpenAI. The AI cache key includes the setting.
- **Data locations:** settings in browser localStorage (`goco-settings`, `goco-mappings`, `goco-sync-ledger`, `goco-drafts`, `goco-ai-cache`), journal in `~/Library/Application Support/GOCO-Desktop`.
- Keep the repository free of personal or company-specific data (names, customers, internal paths, keys). Use neutral sample data such as "Beispielprojekt".
