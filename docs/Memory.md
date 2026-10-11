# Memory

Reusable engineering knowledge for this project: environment quirks, provider/site behavior, automation techniques, recovery procedures and verification traps. It is not a progress log. Each entry has an ID, a date, how it was verified, and the fact. Entries marked **unverified** are prior knowledge to confirm before relying on it. When one is confirmed or disproved, update the entry.

---

### MEM-001 — Authoring-time environment (verified 2026-09-30 by shell)
macOS 15.7.9 (24G830); Node v24.4.1; npm 11.5.2; Xcode Command Line Tools at `/Library/Developer/CommandLineTools`; git and python3 are available via Homebrew; pnpm is not installed (npm is the frozen choice). About 294 GB free. Port 4700 was free. The workspace `~/Workspace/StartupWorkspace` was **not** a git repository (PRQ-ENV-04 must `git init`).

### MEM-002 — The prototype needs HTTP serving and network access to unpkg (verified 2026-09-30)
`Research Workspace.dc.html` uses a "dc-runtime" (`support.js`) that loads React 18.3.1, ReactDOM and Babel standalone from `unpkg.com` (with SRI) and then dynamic-imports `./data.js`. Opening it via `file://` fails because of the dynamic import. Serve the folder with `python3 -m http.server <port>` and open `http://127.0.0.1:<port>/Research%20Workspace.dc.html`. It renders in the Claude desktop browser pane. Template bindings are `{{ }}` values computed in `rv*()` methods of the `Component` class. Reading those methods is the fastest way to learn exact behavior and copy.

### MEM-003 — Prototype structural facts worth remembering (verified by reading source)
- The screen state machine is `state.screen` ∈ inbox | thesis | theses | company | firm | companies | firms | people | sources | reports, plus modals addSource, thought, why, settings, customize, and the palette.
- The feed groups, in order, are: important, companies, theses, sources, firms.
- Saved views are computed (`viewsNav`) but never rendered in the template. The RFC adds M12 for this.
- The Customize modal exists only for company; `customFor()` fakes the result by regex. The real behavior is CUSTOMIZE_VIEW.
- Report creation, source detection and thought organization are all regex fakes in the prototype. Replace them with the RFC AI tasks; do not port the regexes.
- Toasts last 4.5 s. Undo actions are passed to the toast.
- Light-theme tokens live in the helmet `<style>` for `[data-theme=light]` (lines 12–13 are very long).

### MEM-004 — (OBSOLETE: provider switched to OpenAI GPT-6 Luna, see MEM-012) Anthropic model/API facts (verified from the bundled claude-api skill, cached 2026-09-25)
Model IDs are `claude-opus-5-5` and `claude-haiku-4-5` (no date suffix). On Opus 5.5, thinking cannot be disabled and default effort is `medium`, so set `output_config.effort` explicitly. Structured output uses `output_config: {format: {...}}` (the older `output_format` is deprecated). Forced `tool_choice` any/tool returns 400 on Opus 5.5, so use structured outputs instead. Always check `stop_reason === 'refusal'`. Server-side fallback: beta `server-side-fallback-2026-07-01` + `fallbacks: 'default'`. Haiku 4.5 does not accept `effort`. Assistant prefill returns 400 on current models. TS SDK timeouts are in milliseconds.

### MEM-005 — Electron persistence of auth sessions (unverified)
Partitions persist to disk only when the name starts with `persist:`. Call `app.setPath('userData', <dataDir>/electron)` **before** `app.whenReady()`, otherwise partitions land in the default profile and clean-state tests leak sessions. `session.clearStorageData()` is the sign-out and test-expiry tool.

### MEM-006 — better-sqlite3 in Electron (unverified)
It must be rebuilt against Electron's ABI (`npx @electron/rebuild -f -w better-sqlite3`). A mismatch shows up as `NODE_MODULE_VERSION` errors. Mark it `asarUnpack` in electron-builder. FTS5 is compiled into better-sqlite3's bundled SQLite.

### MEM-007 — Playwright + Electron (unverified)
Use `_electron.launch({ args: ['.'], env })`, then `app.firstWindow()`. For the auth window, use `app.waitForEvent('window')`. Offscreen fetch windows are also BrowserWindows, so filter them by title or URL so tests don't grab them.

### MEM-008 — (OBSOLETE: email moved to the Gmail API, DEC-069) IMAP fixtures (unverified)
`imapflow` `client.append(folder, rawBuffer, ['\\Seen'])` inserts a frozen .eml without sending mail. It preserves headers, but Message-ID dedupe then skips re-appends, so tests that need a "new" message must rewrite the Message-ID with a run suffix. Gmail requires IMAP enabled plus an app password (2FA on). Gmail categories are all still visible under INBOX via IMAP.

### MEM-009 — Fixture hostnames via Chromium host-resolver-rules (unverified)
`app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.test 127.0.0.1')` must run before `app.whenReady()`. It maps names only (keep `:4700` in URLs). It affects Chromium networking (session.fetch, BrowserWindows), not Node's `http`/`fetch`, so Node-side tools must send the `Host` header themselves. Verify in PH-01 with a fixture self-request, then mark this verified.

### MEM-010 — Blind evaluators via `claude -p` (unverified)
Headless runs use `claude -p "<prompt>" --model opus --output-format json --allowedTools "Bash(ui:*)"` from an empty temp cwd, so no repo CLAUDE.md or context leaks in. Put the `ui` driver on PATH for that process. Confirm the flag names with `claude --help` during PRQ-EVAL-01.

### MEM-011 — Packaged Electron app exits silently when the asar holds stray files (verified 2026-09-30)
electron-builder's default `files` glob packed spike leftovers (logs, scripts) into `app.asar`. The packaged binary then exited with code 1 before main.js ran, printing nothing. The fix is `"asar": true` with an explicit `build.files: ["main.js","preload.js","index.html","package.json", …]` (for the real app, `out/**` + `package.json`). `electron` and `electron-builder` must be in devDependencies or electron-builder refuses to build. Playwright `_electron.launch({executablePath: '<App>.app/Contents/MacOS/<Name>'})` then works on the installed app; the default fuses keep `EnableNodeCliInspectArguments` enabled. Reference: `prereq/spikes/electron-ui/`.

### MEM-012 — GPT-6 Luna via the local Codex ChatGPT sign-in (verified 2026-09-30)
- **Auth:** `~/.codex/auth.json` holds `auth_mode`, `tokens.access_token` (JWT, ~10-day lifetime here), `tokens.refresh_token`, `tokens.account_id`, `last_refresh`. Plan type is in the JWT claim `https://api.openai.com/auth.chatgpt_plan_type` (here: pro).
- **Models:** `~/.codex/models_cache.json` lists `gpt-6-luna` (context 272k; listed efforts low…max). The backend also accepts `reasoning.effort:'none'` and returns 0 reasoning tokens.
- **Calls:** `POST https://chatgpt.com/backend-api/codex/responses` with headers `Authorization`, `chatgpt-account-id`, `originator: codex_cli_rs` and `store:false, stream:true`. A strict `text.format` json_schema works. 8 parallel calls OK; a ~60k-token input OK; latency ~2 s for small calls.
- **Usage headers:** `x-codex-primary-used-percent`, `x-codex-primary-window-minutes` (=10080, weekly), `x-codex-primary-reset-at`, `x-codex-secondary-*`, `x-codex-plan-type`. The weekly window was 47% used at test time.
- **Shared allowance:** the app shares the user's Codex allowance, so keep the usage guard.
- **Not yet verified:** the refresh flow; PRQ-AI-03 must prove that the app can refresh without logging Codex out.

Reference: `prereq/spikes/luna/`.

### MEM-013 — Using the user's signed-in Chrome sessions headless (verified 2026-09-30)
- **Works:**
  1. Read the "Chrome Safe Storage" password via `security find-generic-password -w -s "Chrome Safe Storage" -a Chrome` (Keychain prompt → Allow).
  2. Derive the key: PBKDF2-SHA1(salt `saltysalt`, 1003 iterations, 16 bytes).
  3. Decrypt each `v10` cookie: AES-128-CBC, IV = 16×0x20, strip the leading 32-byte SHA-256(host) prefix (Chrome ≥130).
  4. `context.addCookies` into `chromium.launch({channel:'chrome', headless:true})` with a normal Chrome UA.
  - X home and Gmail inbox both loaded signed in.
- **Does NOT work:**
  - Launching Chrome on a *copied* profile dir: cookies don't decrypt there even with `ignoreDefaultArgs:['--use-mock-keychain']` (Playwright passes that flag by default on macOS).
  - The default headless UA: X rejects "HeadlessChrome" with an HTTP error.
- **Where sessions live on this machine:** a Chrome profile (the maintainer's personal Google account) holds the X and working Google sessions; a Chrome profile (a work account) showed the Google account chooser instead. a Chrome profile has LinkedIn cookies but no `li_at`, so the user is not signed in to LinkedIn there.
- **Non-cookie session state** (localStorage/IndexedDB tokens) is not covered by the cookie injection alone; §1B.8.9 adds a snapshot of those stores.
- **Cleanup:** never leave profile copies on disk.

Reference: `prereq/spikes/browser-session/`.

### MEM-014 — Gmail API for a personal desktop app (unverified; confirm at CP-EMAIL)
Use a Desktop OAuth client with loopback redirect `http://127.0.0.1:<random port>` + PKCE. While the consent screen is in "Testing", only listed test users can sign in and refresh tokens expire after 7 days. Restricted scopes (`gmail.modify`) work in Testing without verification. `users.messages.insert` (not `import`) puts a raw RFC 822 message into a label without sending; use `internalDateSource=dateHeader` for stable dates.

### MEM-015 — Chromium mock keychain for deterministic bridge tests (unverified)
With `--use-mock-keychain` (Playwright's default on macOS), Chrome encrypts cookies with a key derived from the mock password `"mock_password"` instead of the real Keychain key. Same derivation as MEM-013: PBKDF2-SHA1 with salt `saltysalt`, 1003 iterations, 16 bytes. So a throwaway profile created that way can be decrypted without any Keychain prompt. Verify in PH-07b (E2E-BRIDGE-01). If the password differs, read it from the Chromium source for the pinned Chrome version.

### MEM-016 — Readability `textContent` glues paragraphs (verified 2026-09-30)
`new Readability(doc).parse().textContent` concatenates blocks with no separator ("Capital.Harbor"). That breaks shingle near-duplicate scores (0.52 instead of ≥0.8) and quote boundaries. Build text from `.content` HTML by inserting `\n\n` after `</p|h1-6|li|div|blockquote>` and then taking textContent. The fixture self-test uses exactly this.

### MEM-017 — Setup-time source facts (verified 2026-09-30 by `prereq/sources-probe.mjs`)
- **Sequoia:** `/articles/` returns 404. Articles live at `/article/<slug>`; feed `https://sequoiacap.com/feeds/stories` (50 items).
- **Paul Graham:** no RSS; use `paulgraham.com/articles.html` (233 links).
- **a16z:** `/feed/` returns HTML; `news-content/` as a web listing works (83 links).
- **Tomasz Tunguz:** the feed holds only 2 items.
- **Sifted:** the article needs browser mode for clean extraction.
- **Google News RSS article links:** stay on news.google.com over HTTP; a headless Chrome load resolves them to the publisher.

### MEM-018 — Codex token refresh specifics (verified 2026-09-30)
- **Request:** `POST https://auth.openai.com/oauth/token` with JSON `{client_id:'app_EMoamEEZ73f0CkXaXp7hrann', grant_type:'refresh_token', refresh_token, scope:'openid profile email'}`. The client id is the ID token's `aud`.
- **Rotation:** the response ROTATES the refresh token. Write `id_token`/`access_token`/`refresh_token` + `last_refresh` back atomically (temp + rename, keep mode 600) under the `auth.json.rw-lock` lock. Codex stays logged in afterwards.
- **Checking login:** `codex login status` prints to STDERR.
- **Reference:** `prereq/codex-refresh-probe.mjs`.

### MEM-019 — Evaluator CLIs (verified 2026-09-30)
`claude -p ... --output-format json` returns `{result, is_error}`. When its OAuth expires it returns is_error with "OAuth session expired" until the user re-logs in. `codex exec --skip-git-repo-check -m gpt-6-luna -s read-only --output-last-message <file> "<prompt>"` works headless (≈9k tokens of overhead per call).

### MEM-020 — Google OAuth token lifetime for a personal app (unverified)
In Testing status, refresh tokens expire after 7 days. My understanding is that publishing to "In production" without verification is allowed for personal use: the developer's own account, under 100 users, with an "unverified app" screen. Refresh tokens then last until revoked, or after 6 months unused. Confirm at CP-EMAIL. If restricted Gmail scopes are refused, fall back per DEC-074.

### MEM-021 — Gmail app password + X bridge facts (verified 2026-09-30)
- **Gmail:**
  - The app password works for both IMAP and SMTP (spaces in the displayed password are ignored).
  - Trash is `[Gmail]/Trash` (`specialUse \\Trash`).
  - IMAP `search({header:{'message-id': …}})` finds appended or sent mail; a self-sent message reached INBOX within about 5–10 s.
  - The app-passwords page says "not available for your account" when 2-Step Verification isn't set up suitably.
- **X:**
  - An `/i/status/<id>` URL redirects to `/<handle>/status/<id>`, so `framenavigated` counts 2–3 for one goto.
  - X "Article" or media-only posts have no `[data-testid="tweetText"]`.
  - Reference scripts: `prereq/email-probe.mjs`, `prereq/x-post-probe.mjs`.

### MEM-022 — Build-time facts from PH-01 (verified 2026-09-30)
- The Codex backend rejects `max_output_tokens` with HTTP 400 `Unsupported parameter: max_output_tokens`; omit it.
- Usage headers seen: `x-codex-primary-used-percent`, `-reset-at`, `-reset-after-seconds`, `-window-minutes`, the same for `secondary`, plus `x-codex-plan-type`, `x-codex-active-limit`, `x-codex-credits-*`.
- `~/.codex/auth.json` has `auth_mode: "chatgpt"` (lowercase); plan is `id_token` claim `https://api.openai.com/auth`.chatgpt_plan_type; the email is the `email` claim.
- better-sqlite3 13 ships N-API prebuilds (`prebuilds/darwin-arm64.node`); it loads in Electron 44 without `@electron/rebuild` producing a `build/` dir.
- Electron vibrancy follows macOS appearance, not the page: set `nativeTheme.themeSource` from the app theme or a dark UI sits on a light sidebar material.
- Playwright: the main window is the one whose URL ends with `renderer/index.html`; `app.process().on('exit')` reliably detects a `SIGKILL` crash.

### MEM-023 — Strict json_schema traps (verified 2026-09-30)
- A JSON-Schema keyword filter must not filter keys inside `properties`: dropping `title` (schema metadata) also silently dropped the model's `title` fields, so every output then failed zod with "received undefined".
- Validate model JSON as-is first; convert `null`→`undefined` only as a fallback. Strict mode returns `null` for every optional field, and `.nullable()` zod fields reject `undefined`.

### MEM-024 — Electron session persistence traps (verified 2026-09-30, SMK-07)
- Session cookies (no Expires/Max-Age) are dropped when the app restarts, even in a `persist:` partition. The Ledger fixture uses `Max-Age` like real "remember me" cookies.
- `app.exit()` skips Chromium's normal shutdown, so call `session.cookies.flushStore()` for every partition before exiting or recent cookies may never reach disk.
- Playwright sees `WebContentsView` pages in `electronApp.windows()`; find the sign-in view by URL.

### MEM-025 — Electron `session.fetch` hides the final URL after redirects (verified 2026-09-30, SMK-07b)
With `redirect: 'follow'` the response body is the redirect target but `res.url` stays the original URL, so canonical URLs and the publisher of Google-News-style links are wrong. `redirect: 'manual'` on `session.fetch` returns an opaque response with no `Location` either. Use `net.request({ redirect: 'manual' })`, whose `redirect` event gives each target URL, and call `followRedirect()` (≤5 hops).

### MEM-026 — Don't let one optional detail fail a whole extraction (verified 2026-09-30, SMK-08)
GPT-6 Luna sometimes invents field keys (e.g. `fund_name`) even when told the allowed keys. Rejecting the whole EXTRACT output for that failed the document after two attempts. Validate only what makes the output unusable; ignore unknown optional entries deterministically at persistence time.

### MEM-027 — Model quotes come wrapped in quotation marks (verified 2026-09-30, SMK-10)
ANSWER_QUERY often returns quotes as `“…”`. Strip surrounding quote marks and leading/trailing ellipses before the verbatim-substring check, or correct facts get dropped by grounding.

### MEM-028 — Gmail IMAP SUBJECT search tokenizes punctuation (verified 2026-09-30, SMK-11)
`SEARCH SUBJECT "Thesis Deals & Contradictions"` finds nothing even though the message exists. Search a fixed, punctuation-free prefix ("Research Workspace") and compare envelope subjects client-side. Read-only lookups only; never act (move/delete) on search results.

### MEM-029 — Grouped catalog entries make component choice a coin flip (verified 2026-09-30, SMK-09)
A catalog line "funding_table, investors, latest_round — company funding" let the model answer "funding history first" with `latest_round` in some runs. Give every component its own line saying what it shows plus the user phrases that map to it; bump promptVersion.

### MEM-030 — Readability misses "By Name ·" bylines in a meta paragraph (verified 2026-10-01, E2E-ENT-02)
`<p class="meta">By Priya Raman · <time>…</time></p>` gives `article.byline = null`. Without a byline the model attributes first-person opinions ("We believe…") to "The authors" — or echoes the prompt's own wording ("the byline author"). Fall back to author meta tags / byline-ish elements / a leading "By Name" line, pass the byline to EXTRACT, and normalize generic holders to the byline deterministically.

### MEM-031 — A crash rewinds a test-mode fake clock unless it is persisted continuously (verified 2026-10-01, E2E-JOB-01)
The fake clock restarts at max(RW_TEST_NOW, persisted last). Persisting only on tick/quit means a SIGKILL'd app restarts *earlier* than queued jobs' `run_after`, so `drain` reports idle while work is pending. Persist the fake clock every second in test mode.

### MEM-032 — `claude -p` with only the Read tool cannot list a directory (verified 2026-10-01, VIS-01)
A judge told "the files are in the current directory" guesses filenames and gives up. Put every absolute file path in the prompt.

### MEM-033 — Models echo descriptive placeholders from the prompt as values (verified 2026-10-01, E2E-ENT-02)
Instructions like "attribute to the byline author" / "the site's organization" came back verbatim as `attributedTo`. Never phrase a fallback as a quotable noun phrase; refer to an input field by its label ("the person on the Byline line") and back it with a deterministic normalizer for generic holders.

### MEM-034 — Planner filters must narrow, never empty, retrieval (verified 2026-10-01, BK-Q7)
PLAN_QUERY mapped "What did X announce?" to `kinds: ["other"]` and also typed a firm as a company; either alone made Ask answer "insufficient" although the library had both facts. Treat model-produced filters as hints: drop catch-all values ("other"), fall back to the unfiltered set when a filter leaves nothing, and resolve entity names across all entity types before giving up.

### MEM-035 — "YYYY-MM-DD" strings parse as UTC midnight (verified 2026-10-01, BK-Q4)
`new Date('2026-09-27')` is UTC midnight, i.e. Sep 26 in America/Los_Angeles, and `toISOString().slice(0,10)` turns a PDT evening into the next day. Blind judges flag the resulting off-by-one source dates as unsupported claims. Produce calendar dates with local getters (`localDay()` in main/clock.ts) and parse date-only strings with `new Date(y, m-1, d)`.

### MEM-036 — news.ycombinator.com refuses Node's fetch (HTTP 419 "Sorry") but serves curl and Chromium (verified 2026-10-01, PRQ-NET-01)
Browser headers don't help: the block is on Node's (undici) client, not the UA. The app is unaffected (Electron `net` = Chromium stack, live smoke 38/38). Node-side probes retry refused requests (403/419/429) with `curl`. Also: stop the fixture server before `node prereq/run.mjs`, or PRQ-ENV-10 (port 4700) and PRQ-FIX-02 fail.

### MEM-037 — Real-data brief/alert testing traps (verified 2026-10-01, RD-BR)
- Alert emails are titled "Alert · <rule name>" — they don't contain "Research Workspace", so `imapHasSubject` never finds them; use `imapFindMessages(subject, since, 'Alert')` (read-only, harness/imap.ts).
- Playwright restarts the worker after a failed test, so module-level result objects reset; merge into the results file on save.
- One real funding article can yield 15–20 funding/investment facts (one per investor); alerts then write one notification row per fact (all but one `cooldown`) and deal sections need per-(company, round) dedupe.
- The library build for RD-BR (3 sources + 7-day Crunchbase backfill, 39 docs, ~620 facts) took ~24 min; reuse it with a fixed `RW_RUN_ID` (preparedLibrary cache in $TMPDIR/rw-corpus-<run>-realdata-briefs).

### MEM-038 — Evidence quote offsets are UTF-16 code units (verified 2026-10-01, adversarial review)
`quote_start/quote_end` index the document text the way JavaScript strings do (UTF-16 code units), and every consumer (main, renderer) slices in JS, so they are correct. Python `str` slicing and SQLite `substr()` count code points, so a quote after an astral character (𝛽, emoji) looks "off by one" per astral char — the "10 of 1,170 offsets off by one" finding was this (all 10 sat after a `𝛽` in Anthropic's robots paper; 0 mismatches when sliced as UTF-16). Verify offsets with JS `text.slice(s, e)` or Python `text.encode('utf-16-le')[2*s:2*e]`.

### MEM-039 — normalizeName() is for entity matching, not for comparing a name to web pages
`normalizeName` drops corporate words ("Capital", "Ventures", "Inc"), so "Sequoia Capital" → "sequoia" and "Titanium Ventures" → "titanium". Using it to verify a website made sequoia.com (an HR company) and titanium.com (a metals distributor) "match". For any check against external text (page titles, domains) use the literal name, letters and digits only. Trace candidate checks into the job result (`siteCheck`) — the bug was invisible until each tried domain and title was recorded.

### MEM-040 — Real-site traps the fixtures never had
- Paywalled pages (The Information, FT) parse to the site menu or the cookie banner; identical menus across articles then dedupe real headlines away. Detect menu/consent text (many short paragraphs, none > 160 chars; consent phrases) and fall back to the feed's headline + summary as `partial`.
- VC sites put long legal disclaimers on every post (a16z) that outweigh a short podcast description in Readability: strip disclaimer blocks before parsing.
- Many sites publish the date only as JSON-LD `datePublished` (a16z).
- HN `topstories` is a 500-id ranked list: a regular sync must only consider the current top, or each sync digs deeper into old stories.
- HN's window is submission time; the linked article's own date may be years older.
- Google News RSS returns ≤100 results; `when:Nd` in the query is the window, so a backfill must rewrite it.

### MEM-041 — `object.get` can answer `{ redirect }`; Playwright ⌘R never reaches Electron's menu (verified 2026-10-01, RD-UI)
`object.get` returns `{ redirect: { type, id } }` for a merged (or person→org) id. Storing that as `companyPage` made every `pg.x.length` throw → React unmounted the whole root (white window). The renderer must follow redirects (`Controller.loadPage`) and is wrapped in an error boundary (`main.tsx`). Synthetic key events (Playwright `keyboard.press('Meta+r')`, the ui-driver) don't trigger Electron menu accelerators, so the renderer handles ⌘R itself (`location.reload()` in a capture keydown listener). Test helpers can reach the Controller instance through the root's `__reactContainer$…` fiber (see `tests/realdata/ui-fixes.spec.ts` CTL).

### MEM-042 — Don't share log file names in the session scratchpad (verified 2026-10-01)
Several agents in one session share the scratchpad directory; another agent's `> run1.log` replaced my running spec's log mid-run. Use a task-specific log name and rely on the run's own `tests/results/<RW_RUN_ID>/` JSON for evidence.

### MEM-043 — Replaying stored extractions offline to tune entity guards (verified 2026-10-01, DEC-092)
`agent_runs.output_json` keeps every EXTRACT_DOCUMENT value (plus `annotateRun` extras: `dropped`, `rejectedEntities`, `sharedEvidence`); `agent_runs.job_id → jobs.payload_json.documentId` gives the document. A library DB is WAL — copy `research.sqlite*` before opening with sqlite3 (`-readonly` on the original fails). `ingest/entity-guards.ts` only imports `normalizeName`/`resolveDeterministic` from `entities/resolve`, so it can be bundled with esbuild for Node with a plugin that swaps `entities/resolve` for a stub (copy `normalizeName`, `resolveDeterministic → null`), then run over every stored output in seconds — no Electron, no model calls. Real-data check: `npx playwright test -c tests/playwright.config.ts --project=realdata extraction` (~10 min, 18 Read-once URLs, HN parked with `processing.daily_cap: 0` since Read once is exempt from the cap).

### MEM-044 — Iterating on report/email visuals without the app (verified 2026-10-01, DEC-093)
`app/src/main/reports/render.ts` imports only types, so `npx esbuild app/src/main/reports/render.ts --bundle --platform=node --format=esm --outfile=<scratch>/render.mjs` gives a plain-Node renderer; feed it rows read from a cached library with `sqlite3 -json <corpus>/research.sqlite "…"` (raw HTML for lead images is under `<corpus>/content/<doc>/v1.raw.html`). Playwright's bundled Chromium is **not installed** on this Mac — `chromium.launch({ channel: 'chrome' })` (system Chrome) works for screenshots; inside tests use an Electron `BrowserWindow` via `rw.app.evaluate` + `rw.app.waitForEvent('window')`. Check `document.documentElement.scrollWidth` at 390 px: a 5-column deal table with `white-space:nowrap` cells overflowed to 466 px until nowrap was removed. Gmail clips HTML over ~102 KB; a 4-section story run is ~50 KB.

### MEM-045 — Testing while another run owns app/out; demo-library smoke for ontology ops (verified 2026-10-01, DEC-094)
The harness launches `<ROOT>/app/out/main/index.js` with ROOT = two levels above the spec file, so an rsync copy of the repo (excluding `node_modules`, `app/out`, `tests/results`, `.git`, zips) with `node_modules` symlinked to the real one can `npx electron-vite build` and run Playwright **in the copy** without touching the live `app/out` (better-sqlite3 is already rebuilt for Electron in the shared node_modules). Results land in the copy's `tests/results/<RW_RUN_ID>/`. The fixture server (127.0.0.1:4700) is shared, so don't run fixture suites from the copy while an acceptance run is using it. `test.seedDemo` + `ontology.apply` + `test.ontology.invariants` exercises every ontology op with no model calls in ~2 s — the first thing to run after touching `entities/ops`. The invariants checker found that a textual id replace on change-type left `companyId` holding a firm id; payload keys are typed (`companyId`/`firmId`/`personId`, `subjectType`, firm-only investor lists).

### MEM-046 — Tests run the app in America/Los_Angeles; the host may not be
The harness sets `TZ=America/Los_Angeles` for the app, but the test process uses the Mac's zone (EDT here). Computing "7:30 tomorrow" or "Jun 9" in the test gave a time 3 h off and a date one day off. Use `APP_TZ` from tests/harness/app.ts for expected dates, or read the app's own values (e.g. `schedules.next_run_at`) instead of recomputing them.

### MEM-047 — VC home pages have almost no readable text
Checking a firm's candidate site for investor words (venture, portfolio, fund) rejected a16z.com, sequoiacap.com, benchmark.com, foundersfund.com, precursorvc.com and ti.vc — their home pages are logos, links and script — while an HR platform's marketing page passed. Identify a site by its title naming the entity, by coverage linking to it, and by coverage published on it; not by page prose.

### MEM-048 — "Unseen" isn't "new" for ranked or sampled lists (HN top, Google News)
HN's first sync stopped at its 30-item cap but marked only those 30 as seen, so the next Sync now ingested ranks 31–60 (+24 "new" stories). Google News returns a shifting ≤100-result subset, so unseen ≠ newly published. Mark everything considered as seen, and for search take only results published since the cursor's newest (monotonic) minus a day. Instrument per-source additions before theorising — the first guess (Google) was wrong; the data said HN.

### MEM-049 — A thesis with only a title gets few links under grounded thesis linking
With links required to quote the thesis' own words (interpret-4, after DEC-092), "AI replacing outsourced support labor" alone did not link an insurance-claims-intake partnership (0/3); adding a one-line description naming "insurance claims intake" linked it 3/3 at 0.85–0.91. Fixture theses that tests rely on for links need a description; in the product, the thesis sheet's description line matters.

### MEM-050 — Electron 44 installs its binary on first launch: never let parallel workers race it
After `npm ci`, node_modules/electron has no dist/ until the first launch downloads it. Four acceptance lanes launching at once downloaded into the same folder and corrupted it (path.txt read "Electron.app/Contents/MacOS/ElectronElectron.app"; every launch failed with "Electron failed to install correctly"). Run `npx install-electron --no` once before parallel work (tests/acceptance.mjs does) and check path.txt.

### MEM-051 — Remapping *.test to another port is not invisible to the app
Chromium `--host-resolver-rules=MAP *.test 127.0.0.1:<port>` lets a parallel worker use its own fixture server, but URLs the app derives after relative redirects (e.g. sign-in → Location: /home) carried the remapped port (stackforge.test:4710 instead of :4700), failing SMK-05/07b. macOS has no 127.0.0.2+ without sudo, so fixture suites stay serial on :4700; only real-data suites (no fixture content) run on parallel workers.

### MEM-052 — A fetch timeout that is cleared when headers arrive does not cover the body
provider.ts aborted after 120 s only until `fetch` resolved; `res.text()` on the SSE stream then had no limit. When the Codex stream stalled after its headers, Ask sat on "Composing the answer…" past 5 min (run #11, RD-UI M3) and earlier a compile stalled 15 min (RD-BR-06), which I wrongly called upstream variance. The stream is now read chunk by chunk with an idle limit (90 s without bytes) and a total cap (6 min); an abort is retried like a network error. Lesson: a "stall nobody can reproduce" is a missing timeout until proven otherwise.

### MEM-053 — Never ask the model to copy a ULID: give it short handles
Theses created in one burst got ids sharing the prefix `th_01M3Z7Q7V…`; CREATE_REPORT, asked for "my fintech thesis", returned the AI-infrastructure id — valid, so the "unknown id" check passed it (run #13, RD-BR-01). Every task that picks entities from a list (CREATE_REPORT, REFINE_REPORT, CREATE_ALERT, ORGANIZE_NOTE, SUGGEST_THESES) now sees `T1/F2/C3/P4/N5` handles (ai/handles.ts) and code maps them back. An existence check cannot catch a wrong-but-valid id; only removing the copying step can.

### MEM-054 — The grounding check exempted every date, so a publish date could become an event date
groundingCheck skipped years and "Month D" days so extraction could turn "today" into an event date. In Ask, that let "Brightdesk hired Tomas Berg on September 27, 2026" pass although the quote had no date — Sep 27 was the article's publish date shown beside the context item (run #14, BK-Q4 forbidden claim). User-facing prose (Ask facts, report bullets/story, object summaries) now runs with `strictDates`: a specific day must appear in the cited text. ANSWER_QUERY also says the date after a source is the publish date, and to keep the quote's tense ("now pays" ≠ "began paying" — the other BK-Q4 forbidden claim).

### MEM-055 — Real funding roundups break three assumptions at once
One Crunchbase "biggest rounds" article (run #15, RD-STORY-01) gave: (1) "European AI-focused startups raised $23 billion" → a *company* that topped the capital chart — names ending in a lowercase plural class noun ("… startups", "… companies") are descriptions, not names (entity-guards COLLECTIVE); (2) "Saronic secured $1.75 billion … in March" with no eventDate → a March round in a 30-day story — ingest/event-date.ts takes the month from "in <Month>[ year]" in the quote when the model leaves it empty; (3) the compiler emitted two sections with the identical query → every row and chart twice — toDef keeps the first. Roundup articles are the normal case for funding news, not an edge case. Two more from the reproduction: the model wrote bare month names into eventDate ("July", "August") — the window SQL reads 4 characters as a year and ignored them — so a non-ISO eventDate is now dropped and the quote's month applies (eventDateOf); and COMPOSE_STORY failed validation twice on "sentences ≤4 items", losing the whole narrative — runTask now cuts an over-long list to its schema maximum (trimTooLong) instead of failing, for every task.

### MEM-056 — Hydration must survive one unreadable article and a parked .com
Adding "Pixxel" (run #16, RD-HYD-01): SELECT_COVERAGE picked 1 of 10 results, that article could not be read, and the company ended with no coverage; its guessed site pixxel.com was a parked page titled "pixxel.com - pixxel Resources and Information." (the real one is pixxel.space). An unreadable pick now keeps its search headline and summary as a partial document (the RSS fallback), and "Resources and Information" is a parked-page title.

### MEM-057 — A late search result wiped the palette's correction proposal
The palette's debounced `search.query` and the "Correct: …" `correct.parse` run concurrently; while hydration writes, the search lands *after* the proposal and `runSearch` replaced `pResults` wholesale, so "Merge AWS into Amazon Web Services?" (returned in 3 s, recorded in agent_runs) never showed (run #17, RD-UI B1). The proposal now carries `forQuery` and survives a result for the same text. When a UI step "never appears", check agent_runs before blaming the model.

### MEM-058 — A source alias that is another company's name corrupts identity silently
Run #18 (RD-ONT-02): the alias "Stripe" (origin source_fact) belonged to Mercury — the model listed it as Mercury's other name (roundups say "Mercury, the Stripe of …"). The aliases PK is (entity_type, alias_normalized), so renaming Stripe could not keep its own old name, and later mentions of "Stripe" would resolve to Mercury. Now: addAlias refuses a source_fact alias that is another live entity's name, and the extraction guards drop an alias that names another entity listed in the same document (grounded "X (ABBR)" abbreviations still fold). Identity across entities is the user's call (merge), never a source's.

### MEM-059 — Read acceptance.json, not the console: a blocking step can fail silently
The static audit (blocking) failed in runs #11–#19 — two test-mode switches were never listed (RW_REAL_SEARCH, RW_FIXTURE_PORT) — while every console banner said "passed", because audit runs in step 1 and only acceptance.json records it. Run `node tests/audit-static.mjs` before launching, and judge a run by `acceptance.json` (`blockingPassed`, every step) plus the coverage line, never by the suite banners alone.

### MEM-060 — "Mentioned near X" is not "another name of X": aliases need the name's shape or the text's word
Hydration's SELECT_COVERAGE "otherNames" and extraction's per-company aliases put AMD, NVIDIA, NVDA, NVIDIA's, Tenstorrent, H100s and the products MakoraGenerate/MakoraOptimize on Makora; every NVIDIA article then resolved to Makora (31 articles, 86 links, 8 field values in the user's library). The fix had to be tuned on that real library: "only if the text states it" alone would have stripped a16z (Andreessen Horowitz), BVP, NEA, "Hamad Obaid Al Mansoori", "Conway Research", "Red Hat/RedHat". Rule (entities/aliases.ts): accept when shaped like the same name — legal form, initials, numeronym, possessive, generic company words (Systems, Group, Platforms, Research…), same spelling without spaces, for people same first+last name — or stated ("formerly", "now", "rebranded as", "also known as", "X (Y)"). A specific extra word (Cloud, Eats, Bedrock, V3.2) is a product or division. Pages show `inactive` source facts, so a repair must mark wrong links `rejected` (which also stops a re-read re-attaching them). Audit before repairing: `ontology.aliasAudit`.

### MEM-061 — The model's importance scores skew high without theses
In a library with no theses, ~60% of read articles scored ≥0.8 importance (the model rates general relevance). A plain score cut-off would make "Headlines" half the feed; the bar is a reported deal/event (novel funding, acquisition, fund raise, investment fact) at ≥0.7, or ≥0.9 for anything. Re-check the distribution (`json_extract(metadata_json,'$.interpret.importance')`) before tuning any importance threshold.

### MEM-062 — Fan-out multiplies first syncs: a watch for every neighbour must start at "now"
Following 3 real companies plus a firm made ~75 connected entities; each new news watch's first sync took today + its 5 newest results, so the AI queue grew by hundreds of articles and RD-TIER-02's drain hit its 45-minute limit (run "verify-tiers3"). Watches created in bulk for things the user didn't ask about directly (connected tier) are `forwardOnly`: the first sync records the cursor and ingests nothing. Any feature that creates sources per entity needs this question asked: how many sources × first-sync items does one click create?

### MEM-063 — A capped "top N by activity" set drifts as data arrives: make membership sticky
Connected entities were the 25 most active neighbours of each followed entity. Activity changes with every article read, so the set changed between syncs without any new link: entities moved in without a watch (Doorstead, Bird) and others' watches were created and then removed (8 inactive in one run). Membership is now sticky — entities that already have their watch keep their places; activity only fills free places — so after any sync every place is watched and the set only grows when a new link (which triggers a sync) appears.

### MEM-064 — "Unseen" is not "new" for website listings either
After a restart, Sync now on a16z's /news-content/ page ingested 15 podcast episodes dated Sep 20–Oct 4: the listing had started showing older posts the source had never seen (RD-SRC-07, run #21). Search sources already took only results newer than the cursor's last date (MEM-044 family); web listings now do the same — a regular sync takes an unseen post only if it is newer than the source's newest known post less a day (cursor.lastPublishedAt; for older cursors, last success − 7 days), and older unseen posts wait for Load older posts. Seen URLs are still re-read so updated articles are detected.

### MEM-065 — Stopping an acceptance run: kill the runner by its real command line first
The runner and suites run as `node tests/acceptance.mjs` and `node tests/run-suite.mjs <suite>` (relative paths), so `pkill -f "StartupWorkspace/tests/acceptance.mjs"` matched nothing; killing only the children made the still-alive runner start the next step (and its retries), so leftovers kept reappearing, held port 4700 and overlapped the next run's clean step. Stop order: `pkill -f "node tests/acceptance.mjs"; pkill -f "node tests/run-suite.mjs"`, then playwright, fixture servers and Electron; confirm with `pgrep` and `lsof -iTCP:4700` before launching. Keep the launcher script in the session scratchpad — /tmp copies get cleaned.

### MEM-066 — Working rule: test:quick per fix, test:area per item, accept once per iteration
Every fix in iteration 1 ran the full acceptance (~2 h 40 min) four times over. Now (TestPlan.md, DEC-098): run `npm run test:quick` while fixing (it picks tests from the changed files via tests/areas.mjs and remembers the last passing commit in tests/results/.last-quick), `npm run test:area` when a backlog item is done, and `npm run accept` once at the end of an iteration, before installing. A new spec file must be added to `SPECS` in tests/areas.mjs (the static audit fails otherwise). Fixture tests replay recorded answers from tests/ai-cache (delete the folder to re-record everything); real-data tests never replay. If a quick run passes but you changed something the map doesn't cover (it falls back to "everything" for unknown paths), say so.

### MEM-067 — "Headless" has to cover every window, not just the main one
DEC-097 hid the main window and one of the two sign-in windows; the per-source sign-in window (auth.ts `signIn`) was still created visible, so the ledger.test sign-in popped up over the user's screen during runs. Links clicked in tests also went to `shell.openExternal` — the user's real browser. Fix: `show: !HEADLESS` on every BaseWindow/BrowserWindow and `openExternal()` (window.ts) that only logs in headless runs; the static audit now fails any window constructor without `show: false`/`!HEADLESS` and any `shell.openExternal` outside window.ts. Lesson: enforce a property like "nothing on screen" with a check over all call sites, not by fixing the instance you saw.

### MEM-068 — A test that waits for "everything" hides what the next test depends on
M10 drained the whole job queue (~30 min) before checking one article's date; the next test, "M3 the still-reading line disappears", passed only because of that drain. When M10 started waiting for its own article, M3 failed — it had never waited for Homeward's coverage itself. Each test now waits for exactly what it checks (`rw.settle(documentIds)`, `rw.sourceDocs(sourceId)`). Lesson: when a long wait is removed, look at the tests after it in a serial file for a borrowed precondition.

### MEM-069 — One unexplained hang under parallel fixture workers (watch for a repeat)
During the first parallel recording run (iteration 2), E2E-SRC-04 sat idle for 27+ minutes: its app's last log line was a fetch at 20:15, and its worker's fixture server (port 4710) never got the test's `epoch 2` call. Alone, and in the next full parallel run, it passed in ~36 s. Not reproduced; if a fixture test hangs again under `test:area`, capture the worker's fixture server state (`curl -H 'Host: control.test:4700' 127.0.0.1:<port>/__control/state`) and the app log before killing it.

### MEM-070 — A sleeping Mac looks like crashed apps: keep it awake for long runs
In the first full real-data run of iteration 2, seven tests failed at once with "Target page, context or browser has been closed", "fetch failed" and "Couldn't reach the AI provider (TypeError)", all between 21:57 and 21:58; the test apps' own logs then went silent until 22:31 (LEASE_EXPIRED), and the session's clock jumped ~50 min between short commands. The apps hadn't crashed (they logged on afterwards): the Mac had idle-slept. Before a long run, hold the machine awake (the session's keep-awake request); when many unrelated tests fail in the same minute with network/closed-target errors, check the clock and the app logs for a gap before debugging code.

### MEM-071 — Hiding a window from the user also hides it from the blind tester
Making the per-source sign-in window headless (MEM-067) failed blind UX-08: the ui-driver listed only windows macOS reports visible, so the agent pressed Sign in and "no window opened". In headless runs the app now tags windows a user would see (`rwUserFacing`, sign-in windows) and the driver counts them as on screen by their views' URLs. Lesson: when a test-mode switch changes what is "visible", check every consumer of visibility — tests, drivers, judges — not just the screen.

### MEM-072 — A job that dedupes on "queued or running" loses edits made while it runs
MATCH_THESIS used one idempotency key: creating a thesis queued a match, and a description saved while that match was already running joined the running job — which had read the title only — so RD-DESC-03 matched 0 facts in acceptance. `queueMatch` now queues a follow-up when one is running (a waiting one still picks up the latest words). Same shape as MEM-063: a dedupe rule must say what happens to work that arrives mid-run.

### MEM-073 — A never-shown window can stop painting; "invisible" beats "hidden" for test runs
Under acceptance load, the first click after launch sometimes timed out with "waiting for element to be visible, enabled and stable" (SMK-01, SMK-02, UI-DESC-01) — even with CSS animations off. A window created with `show: false` and never shown may produce no frames, and Playwright's stability check needs them. Headless runs now show the main window inactive at opacity 0, click-through (`setIgnoreMouseEvents`) and unfocusable, with the Dock icon hidden: nothing visible, nothing that takes a click, but it paints like a shown window. Retry passes like these count as flaky in acceptance, so the fix had to remove the cause, not the symptom.

### MEM-074 — Every wait needs a limit that names what it waited for
Three hangs in iteration 2 looked alike (a test idle until its 20-min timeout, nothing in the app log): a reload waiting on "load", a `page.evaluate` bridge call with no limit, and `email.configure` waiting on Gmail with nodemailer's minutes-long defaults. The harness now limits bridge calls (`IPC <command> got no answer in N s`), reloads through `reloadApp` (DOM, 60 s, one fallback), Playwright navigations have a 90 s limit, Gmail connects/verifies are capped at 20–45 s, and installEmail retries a slow Gmail three times. Previews and thesis matches requested while one runs queue a follow-up (MEM-072's shape again). Lesson: an unbounded wait turns a slow dependency into a mystery; bound it and say what it was.

### MEM-075 — The waits MEM-074 missed: page scripts, first paint, and quitting
Acceptance acc-2026-10-07T08-39-29 had three retry passes, all waits with no limit. (1) RD-HYD-01: one hydrate went silent for 16 min while reading its 11th article. `renderPage` bounded the page load but not the final `executeJavaScript` that reads the DOM, and a page whose script hangs never answers it. Page steps are now bounded (`pageStep`, also in restricted.ts). (2) UI-DESC-01 stalled again on "visible, enabled and stable" right after launch. The headless window was shown on `ready-to-show`, which itself waits for a first paint a never-shown window may not make, so it is now shown, transparent and inactive, at creation. (3) UI-FEED-02 passed every check and then idled out its 20 min. Everything else in it is bounded, and its DB was left with a WAL (never closed cleanly), so the stall was `app.close()`. The harness now limits close to 60 s, saves a `sample` of the app to `tests/results/<run>/slow-close-<pid>.txt` and kills it. The cause of that quit stall is not yet known: check for those files after a run. Lesson: when a hang leaves nothing in the logs, list every await on the path and check which has no limit. Leftover `-wal` files tell you whether the app ever closed.

### MEM-076 — Look in the dead run's libraries before blaming the model
Run acc-2026-10-07T11-52-00 was spoiled by a 2-hour lid-close sleep (keep-awake can't stop a closed lid on battery: check `pmset -g log` for Sleep/DarkWake gaps first). The failures from before the sleep looked like "live model variance". Each one turned out to be our own code rejecting a reasonable answer:
- UI-FEED-02: `bearsOnThesis` dropped a verbatim 13-word thesis quote (limit 8), so a 0.9 contradiction vanished. It now allows up to 20 words, still verbatim.
- UI-OBJ-02: firm commentary credited to "Northwind" didn't match "Northwind Ventures" (the match only checked one direction). A short form of the firm's name now matches, and the byline author is shown.
- RD-STORY-01: one lede sentence citing a background fact failed the whole COMPOSE_STORY validation, so the report had no lede. That one sentence is now dropped instead.
- E2E-AL-04: the evaluator read "meaningful" as "settles it alone". The prompt now defines qualitative words.

Lesson: when a live-AI test flips, open the failed test's library (`rw-test-*` by birth time, copy the DB with its WAL, then read `agent_runs`), compare the model's raw answer with what we stored, and look for the filter in between. The harness's double `close()` crash (blind setup) was also mine: `this.app.process()` throws after the app has closed.

### MEM-077 — Judge an acceptance retry by its logs, not by its label
acc-2026-10-07T15-15-53 had 8 retry passes. Six were external, shown by each test's own library: an AI provider outage at 11:55–11:56 (`searchError: Couldn't reach the AI provider` in the HYDRATE results, `PROVIDER_ERROR` on COMPILE_REPORT), Google News 403s, and SaaStr's feed returning 403. Two were ours:
- UI-VIEW-03: the layout model sometimes puts a tracked field in its own section rather than the header, and a section row couldn't open the field's source. Rows of tracked fields now open the same popover as the header chip.
- M2/P8: the test picked a source row by its index in the raw citations array, but the Sources list is in display order (first use).
Per goal rule, only provider/network retries are acceptable. Classify each one with evidence from its library before calling a run clean.

### MEM-078 — Check the result, not just the shape: four guards from acc-2026-10-07T17-11-52
- **Layout.** CUSTOMIZE_VIEW returned a valid patch that moved a company page's only main section to the rail, while its summary claimed "moved funding to the top". The view now must keep a main section, and an instruction that names funding history must leave a funding_table on the page.
- **Story JSON.** COMPOSE_STORY wrote a complete answer, then stray text after it. `parseLeadingJson` keeps the leading object; the schema still checks it.
- **JS-only pages.** Tech in Asia's no-JS shell ("Please enable JavaScript" plus JSON-LD) passed as a 1,400-char article. `notArticle` now flags it as 'script', which triggers the rendered fetch.
- **Palette corrections.** A correction proposal now lives in its own state (`pCorrection`, keyed by its text) instead of inside the search results, which a late or failed search could replace.

Two of the run's six retries were provider errors, shown in their own libraries.

### MEM-079 — Lid closed on power is still dark wake; tier syncs run one at a time
- acc-2026-10-07T23-06-43 ran mostly in DarkWake (lid closed, then plugged in at 19:06). Test windows disappeared mid-test ("Target page … closed"), clustered at the DarkWake→FullWake flips in `pmset -g log`. With the lid open the same files passed. The harness now prints `[harness] … main window renderer crashed|closed` when a window goes away on its own. Before a long run, check `ioreg -r -k AppleClamshellState` and `pmset -g batt`.
- RD-TIER-03 had two bugs in one. A follow-up tier sync used a fixed key (`maint:sync_tiers:next`), so it deduped against a running follow-up and a link made one second later (M13 → Bird) never got its watch. The fix is a unique key per follow-up. Unique keys then let two syncs run side by side, and each removed the other's fresh watches as orphans. `syncTiers` now runs one at a time (a promise chain). Lesson: "queue a follow-up while one runs" also needs "never two at once".

### MEM-080 — A cleanup pass must judge on fresh state; firms are known by their deals
- syncTiers took its tier snapshot at the start, made watches (slow, network), then removed "orphans" using that old snapshot. Founders Fund was followed mid-sync and its new watch was deleted (RD-HYD-02). The orphan pass now recomputes the tiers and only removes sources that existed when the sync began.
- Precursor Ventures' 12 picked articles were all interviews, so the firm had no portfolio at all. Firm hydration now also searches `"<firm>" (led OR backed OR participated) round`, and SELECT_COVERAGE (select-coverage-4) puts deals first for firms. On live data: Benchmark 20 investments, Founders Fund 12, a16z 7, Sequoia 3.
- A mute applies to the thesis the user saw (`feed.muteTopic` takes thesisId). The stored primary thesis can be mid-recompute.

### MEM-081 — One backlog item, one commit (or more), named in its Done entry
Iteration 2 asked each Now item to be "moved to Done with commits", but items 2–5 (Following hydrates, Describe first / Re-process, Reports vs briefings + Reading first + Refine + deeper, Daily limit) were built and committed together as 42245a5. Later fixes have their own commits, and the Backlog Done entries name all of them. The user accepted the combined commit (2026-10-08: "just commit it all together I don't care"); history stays as it is. Rule from now on: finish an item, run test:area, commit it alone with the item's name in the subject, and only then start the next. Do not batch items into one commit.
