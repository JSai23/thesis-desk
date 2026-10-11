# Test plan — layout and commands (target state, agreed 2026-10-06)

Why: every fix used to run the full acceptance (~2 h 40 min: clean rebuild, 172 tests, live accounts, blind agents),
though most fixes touch one area. Goal: minutes per fix while developing, the same final bar before anything is
installed. This amends RFC §3E (how acceptance is run), not what it requires.

## Rules
- **Everything headless.** Every process a test starts — the app, sign-in windows (ledger.test and other fixture
  sites), hidden browser windows, the ui-driver daemon, the installer check — stays off the screen and out of the
  Dock (RW_HEADLESS, DEC-097); links clicked in tests never open the real browser, and OS notifications are counted,
  not shown. `RW_HEADED=1` is the only way to show windows. The static audit fails: a test that launches the app
  outside the harness, a browser launched without `headless: true`, an app window created without
  `show: false`/`!HEADLESS`, and `shell.openExternal` outside window.ts (MEM-067).
- **Real data decides.** Real-data tests always ask ChatGPT live and are the blocking gate (DEC-087).
- **Fixture tests replay AI answers.** Tests on fake websites and saved articles record each AI answer once, keyed by
  task name + instruction (prompt) version + exact input hash, and replay it. A changed prompt or input misses the
  cache and asks live (then records). `accept` ignores the cache and asks live. A fixture test that relies on the model
  answering differently on a re-read (UI-FEED-03's re-rolls) launches with `liveAi: true`. Recordings live under
  `tests/ai-cache/` (git-ignored; no secrets, article text only from fixtures).
- **Isolation allows parallelism.** Each test has its own data dir and fixture port; fixture stages run 4 workers.
- **Shared real library.** Real-data tests that need a built library get a copy of one built once
  (`preparedLibrary` in tests/harness/app.ts): once per run in `accept`; in quick/area it is reused for the rest of
  the day while the builder code is unchanged (`RW_LIBRARY_REUSE=1`). Tests wait for the documents they check
  (`rw.settle`, `rw.sourceDocs`), never for the whole background queue.
- **No giant tests.** A test over ~5 min is split or made to wait only for what it checks (M10 waits for its one
  article; RD-HYD-01 gives each company its own app, three at a time; RD-TIER-02 waits for its source's articles).
  Tests whose job is to read a whole real library (RD-SRC-06, RD-BR-00's build) stay long by nature.
- **Every spec file has area tags** in `tests/areas.mjs` (`SPECS`: ingest, ai, extraction, sources, auth, mail,
  reports, alerts, briefs, query, views, feed, objects, theses, ontology, hydrate, tiers, shell, settings, security,
  ui, vis; install / live / blind / quality run only in accept or on request), checked by the static audit.

## Layout

```
tests/
├─ 0 · Static audit ───────────── every command · <1 min · no app launched
│    no secrets in code/logs · banned settings · every launch headless · every test tagged
│
├─ 1 · Fixture tests ─ fake websites (ledger.test, fixture feeds, IMAP), saved articles
│  │   AI replayed (live in accept) · 4 workers · headless
│  ├─ smoke/ (15) ── each core feature works once
│  │    ph01 launch + empty library · ph02 add RSS source · ph03 read + extract facts · ph04 Today
│  │    ph05 company/firm pages · ph06 theses + links · ph07 web + sign-in (ledger.test)
│  │    ph07b email newsletters · ph08 search/Ask · ph09 alerts · ph10 reports · ph11 briefings
│  │    ph12 settings + undo · ph13 installer builds, installed copy launches [accept only]
│  ├─ e2e-backend/ (50) ── the engine, no clicking
│  │    @ingest pipeline, duplicates, daily limit, re-read on correction
│  │    @ai extraction, quote grounding, dates, entity matching, aliases
│  │    @sources RSS/web/HN/email adapters, probe, cursors · @auth sign-in sessions, expiry
│  │    @reports report/alert compile + run, citations, email caps · @query views, filters, Ask
│  │    @security untrusted text can't steer the AI; no secrets on disk
│  └─ e2e-product/ (38) ── clicking the real interface
│       @feed Today sections, reasons, dismiss/save · @objects pages, Follow, Pull latest, tier line
│       @reports create/refine/run reports + briefings · @sources add/edit/remove, modes, sign-in
│       @shell settings, ⌘K, navigation, undo · @tiers · @vis screenshot rubric (light + dark)
│
├─ 2 · Real-data tests ─ live sites, real companies/firms, live ChatGPT ← blocking gate
│  │   shared library built once per run, copied per test · headless
│  ├─ @sources real feeds sync; no old re-ingest; every doc reaches a terminal state
│  ├─ @extraction facts from real funding news, correct and quoted
│  ├─ @hydrate add company/firm by name → site, news watch, articles (one test per company)
│  ├─ @tiers follow → connected watches; unfollow → orphans removed; alias repair
│  ├─ @ontology merge/split/rename/delete/undo on real entities
│  ├─ @briefs real funding library → briefing content, one notification
│  ├─ @reports story reports, grounded, independent judge
│  └─ @ui-fixes past real-data UI bugs stay fixed (date checks split small)
│
├─ 3 · Live [accept only] ─ Gmail send/arrive · X/LinkedIn single-page reads · StrictlyVC
├─ 4 · Blind [accept only] ─ blind-knowledge (judged answers) · blind-ux (~11 tasks, clicks, dead ends)
└─ 5 · Coverage matrix ─ every RFC requirement has a passing test (tests/coverage.mjs)
```

## Changed files → areas (`tests/areas.mjs`)

| Changed | Areas |
|---|---|
| `main/reports/*`, `ai/tasks/reports.ts`, report screens | reports, briefs |
| `main/objects/hydrate.ts`, `objects/tiers.ts`, `objects/pages.ts` | hydrate, tiers, objects |
| `main/ingest/*`, `ai/tasks/document.ts` | ingest, ai, extraction, hydrate |
| `main/sources/*` | sources, auth |
| `main/entities/*` | ontology, ai, objects |
| `main/feed/*` | feed, tiers |
| `renderer/*` | `ui`: every product test + vis + the real-data UI files (the renderer is one template, so no per-screen split) |
| `main/db|jobs|ipc/*`, `shared/*`, `env.ts`, `index.ts`, harness, fixtures, package files | everything |
| `*.md`, `prereq/`, test tooling (`areas.mjs`, `dev.mjs`, audit) | nothing beyond the static audit |
| anything not matched | everything (safe default) |

A new or changed test always runs in `test:quick` regardless of the map.

## Commands

| Command | Runs | AI | Target time | Use |
|---|---|---|---|---|
| `npm run test:quick` | 0 + changed areas from 1 and 2 + new/changed tests | replay (fixture) · live (real data) | 2–15 min | every fix |
| `npm run test:area` | 0 + all of 1 + changed areas from 2 | same | ~30 min | a backlog item is done |
| `npm run accept` | 0 → 5, clean rebuild, installer, no cache | all live | ~1 h | end of an iteration, before installing |

Results: `tests/results/<run>/` as today (`quick-…`/`area-…` runs write `summary.json`); `acceptance.json` stays the
verdict for `accept`. Options: `--since <rev>` (default: the last commit a passing run of the same command tested),
`--specs a,b` (run named spec files), `--no-build`. Delete `tests/ai-cache/` to re-record every AI answer.

## Done when
- The three commands exist and match this file; README/Memory.md record the working rule (quick per fix, area per
  item, accept once per iteration).
- A one-line fix's `test:quick` finishes under 15 min; `accept` finishes in ~1 h with blocking passed, coverage 100%,
  no flaky passes, and nothing appearing on screen or in the Dock during any command.
