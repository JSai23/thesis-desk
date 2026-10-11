# Verification Report — Research Workspace

Final acceptance run **acc-2026-10-08T09-11-31** (RFC §3E), 2026-10-08T09:11:31.907Z → 2026-10-08T10:27:32.525Z. Blocking thresholds met: **yes**.

## Environment
- Git revision tested: `39ccf70c136ac9605d32247d4e709aa125ba44da`
- macOS 15.7.9 · Node 24.4.1 · Electron 44.5.1 · app 1.0.0
- Prototype hash (design/prototype zip, PRQ-DESIGN-01): `de39eebba436f2312788dbd04dfd456dbd60d30cf0a214650e5f78412d7683aa`

## Prerequisites (final status)
| ID | Status | Evidence |
|---|---|---|
| PRQ-ENV-01 | GREEN | macOS 15.7.9, Aqua |
| PRQ-ENV-02 | GREEN | /Library/Developer/CommandLineTools |
| PRQ-ENV-03 | GREEN | node v24.4.1, npm 11.5.2 |
| PRQ-ENV-04 | GREEN | git repo; .env.local ignored |
| PRQ-ENV-05 | GREEN | Playwright drove Electron window (click + screenshot) |
| PRQ-ENV-06 | GREEN | better-sqlite3 in Electron: FTS5 + WAL |
| PRQ-ENV-07 | GREEN | safeStorage round-trip across relaunch, no prompt |
| PRQ-ENV-08 | GREEN | Notification.isSupported() |
| PRQ-ENV-09 | GREEN | 275Gi free |
| PRQ-ENV-10 | GREEN | port 4700 free |
| PRQ-ENV-11 | GREEN | npm registry + unpkg reachable |
| PRQ-AI-01 | GREEN | gpt-6-luna via Codex ChatGPT sign-in: text, json_schema, effort none |
| PRQ-AI-02 | GREEN | 8 parallel OK; weekly used 55% |
| PRQ-AI-03 | GREEN | refresh HTTP 200 / rotated refresh token: true / new access token: true / keys preserved: auth_mode,OPENAI_API_KEY,token |
| PRQ-EVAL-01 | GREEN | claude -p: OK; codex exec fallback: OK |
| PRQ-NET-01 | GREEN | 36/37 sources OK (blogs 18, VC 3) |
| PRQ-FIX-01 | GREEN | 6 live article snapshots with sha256 |
| PRQ-FIX-02 | GREEN | fixtures selftest: 139 passed, 0 failed |
| PRQ-DESIGN-01 | GREEN | prototype hashes match |
| PRQ-DESIGN-02 | GREEN | prototype renders offline from vendored scripts |
| PRQ-SPIKE-01 | GREEN | packaged .app installed, driven via Playwright, removed |
| PRQ-DOC-01 | GREEN | inputs + docs tracked in git |
| PRQ-EMAIL-01 | GREEN | Gmail IMAP login, RW-Fixtures append/search/trash-by-UID, SMTP round trip |
| PRQ-EMAIL-02 | RED | StrictlyVC issue in Gmail (none) |
| PRQ-AUTH-01 | RED | X post via Chrome bridge (verified once at CP-BROWSER; re-run: node x-post-probe.mjs "<Chrome profile>" <url>) |
| PRQ-AUTH-02 | RED | LinkedIn: not signed in to LinkedIn in Chrome (optional) |

## Requirements
127 requirements in the §3D matrix; implemented (≥1 mapped test or structural audit): 127; verified by a passing test in this run: 127/127.

## Real-data stage (blocking — RFC §3E step 9b, DEC-087)
79/79 real-data tests passed (real network, real model, real Gmail; first attempt unless noted).
| Test | Result | Minutes | Evidence |
|---|---|---|---|
| create two reports and a briefing in the sheet; Send now → exactly one email with both reports | ✓ | 0.5 | tests/results/acc-2026-10-08T09-11-31/realdata-briefings-ui.json |
| report row "Briefings ▸" tags a report out and back in | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-briefings-ui.json |
| Edit changes the schedule; Pause/Resume; Delete with Undo | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-briefings-ui.json |
| Send now without email set up shows "Set up email in Settings first" | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-briefings-ui.json |
| RD-BRF-01 two reports tagged into one briefing → Send now → exactly one email with both reports | ✓ | 6.4 | tests/results/acc-2026-10-08T09-11-31/realdata-briefings.json |
| RD-BRF-02 the schedule fires once at its time; the report row can be tagged out | ✓ | 0.1 | tests/results/acc-2026-10-08T09-11-31/realdata-briefings.json |
| RD-BRF-03 a briefing whose reports have nothing new sends no email | ✓ | 1.1 | tests/results/acc-2026-10-08T09-11-31/realdata-briefings.json |
| RD-BR-00 a real funding library was built | ✓ | 9.0 | tests/results/acc-2026-10-08T09-11-31/realdata-briefs.json |
| RD-BR-01 custom reports from plain English compile to the ask and run grounded | ✓ | 0.3 | tests/results/acc-2026-10-08T09-11-31/realdata-briefs.json |
| RD-BR-02 editing a report (rename, schedule, add and remove sections) shows in the next run | ✓ | 0.4 | tests/results/acc-2026-10-08T09-11-31/realdata-briefs.json |
| RD-BR-03 the schedule fires once at the scheduled time (no double run, no catch-up repeat) | ✓ | 0.8 | tests/results/acc-2026-10-08T09-11-31/realdata-briefs.json |
| RD-BR-04 alerts compile to what was asked and backtests agree with the library | ✓ | 0.3 | tests/results/acc-2026-10-08T09-11-31/realdata-briefs.json |
| RD-BR-05 a real new funding article read once triggers one notification; cooldown and dedupe hold | ✓ | 1.7 | tests/results/acc-2026-10-08T09-11-31/realdata-briefs.json |
| RD-BR-06 adversarial requests are answered honestly: no crash, no invented rows, no empty email | ✓ | 0.5 | tests/results/acc-2026-10-08T09-11-31/realdata-briefs.json |
| RD-BR-E1 "email me…" puts the report in its own briefing; the briefing's email matches the run rows (DEC-100) | ✓ | 0.3 | tests/results/acc-2026-10-08T09-11-31/realdata-briefs.json |
| RD-BR-E2 "every weekday at 7:30 email me…": the briefing takes the schedule and sends exactly one email; the r | ✓ | 0.8 | tests/results/acc-2026-10-08T09-11-31/realdata-briefs.json |
| RD-BR-E3 an alert with email delivery emails the match once | ✓ | 1.7 | tests/results/acc-2026-10-08T09-11-31/realdata-briefs.json |
| RD-DESC-01 Cua described (what it does, cua.ai) and re-processed: its site, a watch with its words, coverage t | ✓ | 1.7 | tests/results/acc-2026-10-08T09-11-31/realdata-describe.json |
| RD-DESC-02 a note saying a linked article is about a different company: re-process drops that link; Keep resto | ✓ | 8.0 | tests/results/acc-2026-10-08T09-11-31/realdata-describe.json |
| RD-DESC-03 a thesis with a description, re-processed, links facts already stored | ✓ | 0.1 | tests/results/acc-2026-10-08T09-11-31/realdata-describe.json |
| RD-EXT extraction and entity quality on real articles | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-extraction.json |
| RD-HYD-02 firm Sequoia Capital: site, investments with evidence, news watch | ✓ | 3.0 | tests/results/acc-2026-10-08T09-11-31/realdata-hydrate-firms.json |
| RD-HYD-02 firm Andreessen Horowitz: site, investments with evidence, news watch | ✓ | 5.6 | tests/results/acc-2026-10-08T09-11-31/realdata-hydrate-firms.json |
| RD-HYD-02 firm Benchmark: site, investments with evidence, news watch | ✓ | 3.7 | tests/results/acc-2026-10-08T09-11-31/realdata-hydrate-firms.json |
| RD-HYD-02 firm Founders Fund: site, investments with evidence, news watch | ✓ | 3.2 | tests/results/acc-2026-10-08T09-11-31/realdata-hydrate-firms.json |
| RD-HYD-02 firm Precursor Ventures: site, investments with evidence, news watch | ✓ | 1.3 | tests/results/acc-2026-10-08T09-11-31/realdata-hydrate-firms.json |
| RD-HYD-02 firm Titanium Ventures: site, investments with evidence, news watch | ✓ | 2.1 | tests/results/acc-2026-10-08T09-11-31/realdata-hydrate-firms.json |
| RD-HYD-05 chat corrections on hydrated entities: split a wrongly combined name, merge a duplicate | ✓ | 0.1 | tests/results/acc-2026-10-08T09-11-31/realdata-hydrate-firms.json |
| RD-HYD-01 companies Seed → Series E, added by name only, reach the stage their real news states | ✓ | 7.0 | tests/results/acc-2026-10-08T09-11-31/realdata-hydrate.json |
| RD-HYD-03 small company the user added (typed in lower case, with a second name) | ✓ | 1.2 | tests/results/acc-2026-10-08T09-11-31/realdata-hydrate.json |
| RD-HYD-04 adding an entity your sources already surfaced reuses it instead of duplicating | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-hydrate.json |
| RD-LOOK-01 a 3-letter name alone (Cua): a news watch is kept either way; nothing to go on → the page asks for  | ✓ | 0.1 | tests/results/acc-2026-10-08T09-11-31/realdata-lookup.json |
| RD-LOOK-02 the hint (its website) re-runs the lookup: domain, a search with what the site says it does, covera | ✓ | 1.3 | tests/results/acc-2026-10-08T09-11-31/realdata-lookup.json |
| RD-LOOK-03 a name typed as a web address ("cua.ai") is taken as the website and named from its home page | ✓ | 0.2 | tests/results/acc-2026-10-08T09-11-31/realdata-lookup.json |
| RD-LOOK-04 following a firm the library already extracted runs a fresh lookup and gives it sources | ✓ | 1.9 | tests/results/acc-2026-10-08T09-11-31/realdata-lookup.json |
| RD-LOOK-05 a new thesis is matched against facts already stored — links appear without reading anything new | ✓ | 0.3 | tests/results/acc-2026-10-08T09-11-31/realdata-lookup.json |
| RD-ONT-00 the real library starts clean; pick real companies to correct | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-01 entity.create — chat "start tracking …" adds and hydrates a firm | ✓ | 2.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-02 entity.rename — via ontology.apply and chat, each undone | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-03 entity.changeType — company → firm keeps its links; undo brings the same company back | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-04 entity.delete / entity.restore — links removed and put back; chat delete + undo; chat restore | ✓ | 0.1 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-05 entity.split — "Mercury is a different company from Mercury Insurance"; undo merges back; chat merge | ✓ | 0.1 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-06 entity.merge — via ontology.apply; merges are not undoable | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-07 field.set / field.revert — via ontology.apply and chat ("X's stage is Series B"), each undone | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-08 link.attach / link.reject — company ↔ thesis via ontology.apply and chat; Not about on a real articl | ✓ | 0.1 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-09 theses — create, rename, move, archive (each via ontology.apply and chat, undone) and merge | ✓ | 0.2 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-09b entity.repairAliases — unstated source aliases removed via ontology.apply and via chat, each undone | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-11 object.describe — the user's own description via ontology.apply and chat, each undone; it never beco | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-ONT-10 every registry op was exercised through both paths | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ontology-ops.json |
| RD-SRC-01 every automatic source type subscribes to a real site and first-syncs from today | ✓ | 1.7 | tests/results/acc-2026-10-08T09-11-31/realdata-sources.json |
| RD-SRC-02 Sync now on every source is idempotent (no re-ingest, cursor holds) | ✓ | 0.2 | tests/results/acc-2026-10-08T09-11-31/realdata-sources.json |
| RD-SRC-03 Read once fetches a real article on demand and processes it | ✓ | 0.2 | tests/results/acc-2026-10-08T09-11-31/realdata-sources.json |
| RD-SRC-04 Load older posts (7 days) backfills real history inside the window, and only once | ✓ | 1.6 | tests/results/acc-2026-10-08T09-11-31/realdata-sources.json |
| RD-SRC-05 the daily scheduled sync fires for every source and fetches only new posts | ✓ | 0.2 | tests/results/acc-2026-10-08T09-11-31/realdata-sources.json |
| RD-SRC-06 every real document goes through the pipeline to a terminal state with grounded output | ✓ | 14.2 | tests/results/acc-2026-10-08T09-11-31/realdata-sources.json |
| RD-SRC-07 restart keeps sources, cursors and library; the next sync stays incremental | ✓ | 0.2 | tests/results/acc-2026-10-08T09-11-31/realdata-sources.json |
| RD-STORY-01 a funding story: grounded lede and paragraphs, hero with a real image, capital chart from evidence | ✓ | 0.4 | tests/results/acc-2026-10-08T09-11-31/story-reports |
| RD-STORY-02 "as a table" → deal table with Company / Round / Amount / Lead investors / Source; refinements cha | ✓ | 0.4 | tests/results/acc-2026-10-08T09-11-31/story-reports |
| RD-STORY-03 a thesis story: for vs against bar matches the rows | ✓ | 0.5 | tests/results/acc-2026-10-08T09-11-31/story-reports |
| RD-STORY-04 a briefing with two story reports → exactly one email with hero images and chart markup | ✓ | 0.8 | tests/results/acc-2026-10-08T09-11-31/story-reports |
| RD-STORY-05 the in-app report view shows the same story (sandboxed frame) | ✓ | 0.2 | tests/results/acc-2026-10-08T09-11-31/story-reports |
| RD-STORY-06 reports go deeper: a longer lede and section analysis, deep dives from stored facts, all grounded; | ✓ | 0.6 | tests/results/acc-2026-10-08T09-11-31/story-reports |
| RD-TIER-01 companies with big-partner coverage get no partner, product, chip or ticker aliases | ✓ | 3.1 | tests/results/acc-2026-10-08T09-11-31/realdata-tiers.json |
| RD-TIER-02 repair removes a seeded unstated alias, unlinks what it attached, and undo restores | ✓ | 9.8 | tests/results/acc-2026-10-08T09-11-31/realdata-tiers.json |
| RD-TIER-03 following a real firm makes its portfolio Connected within the cap; unfollow removes only orphaned  | ✓ | 4.2 | tests/results/acc-2026-10-08T09-11-31/realdata-tiers.json |
| RD-TIER-04 a followed company: hydration ran, its people and investors are Connected; Pull latest subscribes n | ✓ | 1.8 | tests/results/acc-2026-10-08T09-11-31/realdata-tiers.json |
| RD-TIER-05 Today: Following holds followed/connected items, Your theses holds thesis items, Headlines only ite | ✓ | 3.5 | tests/results/acc-2026-10-08T09-11-31/realdata-tiers.json |
| M3 a followed company whose coverage is queued says it is still reading, with an estimate | ✓ | 0.8 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| M3 Ask says how many articles are still being read | ✓ | 0.4 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| P7 a very long question is clamped to two lines with an expander | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| P5 palette footer shows the real number of documents | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| B1 chat merge of the company whose page is open follows to the surviving company; no white window | ✓ | 0.1 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| B1 split via chat, then a merge while viewing the merged page (the banner path) | ✓ | 0.1 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| B1 a render error shows a recoverable message; ⌘R reloads the window | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| M10 an old article shows its publish date with year; old coverage is not "Changes" or "Important today" | ✓ | 0.7 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| M3 the still-reading line disappears once the coverage is read | ✓ | 6.9 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| M2/P8 Ask citations are numbered densely and open in the reader, even without a visible feed item | ✓ | 0.2 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| P6 single-key shortcuts never fire while a field is focused or the palette is open | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |
| Read once: a dead link is reported in the sheet; an X post link is readable, not "Can’t watch" | ✓ | 0.0 | tests/results/acc-2026-10-08T09-11-31/realdata-ui-fixes.json |

## Suites
| Suite | Passed | Failed | Skipped | Flaky (passed on same-run retry) |
|---|---|---|---|---|
| realdata | 79 | 0 | 0 | — |
| smoke | 15 | 0 | 0 | — |
| e2e-backend | 51 | 0 | 0 | — |
| e2e-product | 47 | 0 | 0 | — |
| live | 42 | 0 | 1 | — |
- Static audit:   ✓ no violations

## Blind evaluations
**Knowledge (BK):** 7/8 passed; BK-Q6 passed; forbidden claims 0; threshold met: true.
| Q | Pass | Judge notes |
|---|---|---|
| BK-Q1 | ✓ | The stored record ar_01M4DDT89XDQ5BWNY4K2NPFJXH (status succeeded) says Northwind Ventures led and the round was expanded to $20M on September 30, 2026. It also says the round was originally reported as $18M, which meets |
| BK-Q2 | ✘ | The stored answer (ar_01M4DDVQVTJXPD2DPSKXC7F6NR) cites the Callhaven ~58% automation ceiling, and doc_01M4DDP257Q5HQJ1YSKBQSRYDK supports that citation. It omits the second reference fact, that two large retailers resto |
| BK-Q3 | ✓ | All three reference items are present and supported. The Stackforge $30M Series B led by Northwind is in doc_01M4DDRR2KA55R0GZZB5MTAKMM. The Lumen Legal Series A is in signalwire doc_01M4DDP259ZXDB9BVYT3AZBAQ9 and vln do |
| BK-Q4 | ✓ | The stored Ask record (ar_01M4DDYHK71XKJB9Q34VXJ4X2D, status succeeded) matches the asker's word-for-word report and cites all 3 reference facts. The CFO hire is supported by doc_01M4DDP256GKFC7A0504E91HMH (signalwire),  |
| BK-Q5 | ✓ | The stored answer record (ar_01M4DE01…) names both Lumen Legal and Quillmate. For Lumen Legal it covers the San Francisco location, commercial contract review, the Series A led by Northwind, and the expansion to $20M, wh |
| BK-Q6 | ✓ | The app's stored Ask record (ar_01M4DE1CN8W55G5MRES9QKDSFE) has status succeeded, insufficient=true and an empty answer array. This matches the asker's report: "I don't have evidence for that in your library." No revenue |
| BK-Q7 | ✓ | The stored record ar_01M4DDE33RXYKFBZGXY9HFK1TMM (status succeeded) matches the asker's report and states both reference facts: Harbor Point Capital closed Harbor Point Fund II at $150M, and it led Claimwise's $9M seed r |
| BK-Q8 | ✓ | The stored answer record (ar_01M4DE4Z9CEGJPEQ5C8JHYZ5JZ) states four reference facts: Forge Agents is a platform for deploying and operating AI agents, it uses usage-based pricing, Stackforge was founded in Berlin, and i |

**UX:** 11/11 goals succeeded; mean dead ends 0.82; crashes 0; threshold met: true.
| Goal | Attempt | Pass | Actions | Dead ends | Judge notes |
|---|---|---|---|---|---|
| UX-01 | 1 | ✓ | 22 | 1 | The state dump satisfies every judge check. The source src_01M4DEBM4PJ1WT03ACNXCZAQVH has kind "web" and locator "http://vln.test:4700", which matches /vln/. Its mode is "custom", its instruction read |
| UX-02 | 1 | ✓ | 61 | 4 | Report rp_01M4DEDJPMGM1C307QHRQR43QY is enabled with schedule {kind:weekly, weekday:1, at:08:00}. Its section 'seed-dev-infra' filters stages:["Seed"] and theses:[th_01M4DE5WWD673YBE4F16669GFP] (AI-na |
| UX-03 | 1 | ✓ | 9 | 0 | The state dump has note nt_01M4DEHXGM63H3G9MZJZCRESZ2 with the exact goal text, kind "counterpoint", anchor_type "thesis" and anchor_id th_01M4DE5WW7WWFM0WP2A3WQGC1Q (Legal AI). A matching user relati |
| UX-04 | 1 | ✓ | 26 | 0 | The judge check passes. field_values row fv_01M4DEJZ64MD6FYJSCW5H0SYD7 for Claimwise (co_01M4DE67CNC0ZVQ1YD8GFPR07E) has field_key=stage, value="Series A", origin="user" and status="current", and the  |
| UX-05 | 1 | ✓ | 13 | 0 | The state dump has exactly one view_definitions row (vd_01M4DEMT1FA4WEARFTCH80DM56) scoped to object co_01M4DE6PWBFH8HVSSSH3CTW0MW (Lumen Legal). Its main[0] is component 'funding_table', and its head |
| UX-06 | 1 | ✓ | 25 | 1 | The state dump shows a new alert rule al_01M4DEP4QYXH946BT6EKPGQX81 with enabled=1, status active, and filters investorFirms=[fm_01M4DE6PWBQKRWW6R7PAW062GE] (Northwind Ventures) and investorRole="lead |
| UX-07 | 1 | ✓ | 4 | 1 | Evidence ev_01M4DE6PWJ2XB4TTQ91DGTJY22 ('Lumen Legal raised an $18 million Series A led by Northwind Ventures', payload leadInvestors=['Northwind Ventures']) has kept=1. Relationship rel_01M4DE6SX30YJ |
| UX-08 | 1 | ✓ | 28 | 1 | Both judge checks pass. The Ledger source (src_01M4DERKJR8X97W0RFPXG1E5P7) has auth_state "authenticated" with an auth_profile present, and feed item fi_01M4DESFN10V1ZKC8QYGV6NWAZ exists for the lates |
| UX-09 | 1 | ✓ | 11 | 1 | History row hi_01M4DETHWRC91A4YQXEN1FRXKN records action source.reset on src_01M4DE5WXJ8DYK2FXBSD7PFY4M (signalwire) with after {documents:5}, so the reset check is satisfied. Note nt_01M4DEADFD03YHJV |
| UX-10 | 1 | ✓ | 6 | 0 | The state dump has a new view_definitions row (vd_01M4DEVW13PQ57V58XD4D3TGHZ) with objectType 'feed' and spec.groupBy 'thesis'. A matching history entry records view.changed from groupBy 'section' to  |
| UX-11 | 1 | ✓ | 24 | 0 | All three judge checks are met. The state dump has src_01M4DEX0WPVJQEA247KNW96DEN, kind "search", with query "AI legal startups raising money" and freq "daily". It also has doc_01M4DEX9RS3PGS014DQGJD4 |

## VIS-01 design parity
| State | Layout | Placement | Typography | Color | Density |
|---|---|---|---|---|---|
| 01-today-reader-inspector | 5 | 4 | 4 | 5 | 4 |
| 02-today-review | 5 | 5 | 5 | 5 | 4 |
| 03-theses-list | 5 | 5 | 5 | 5 | 5 |
| 04-thesis-overview | 5 | 5 | 5 | 5 | 4 |
| 05-thesis-evolution | 5 | 5 | 5 | 5 | 5 |
| 06-company-overview | 5 | 5 | 5 | 5 | 4 |
| 07-firm | 5 | 4 | 5 | 5 | 4 |
| 08-sources-expanded | 5 | 4 | 5 | 5 | 4 |
| 09-reports | 5 | 5 | 4 | 5 | 4 |
| 10-palette-open | 5 | 5 | 5 | 5 | 5 |
Screenshots and judge output: tests/results/acc-2026-10-08T09-11-31/vis/

## Live smoke (non-blocking)
38/38 starter sources produced a processed document.

## Known non-blocking limitations
- See live smoke failures above (external sites).

## Unresolved blocking issues
None.

## Decisions recorded (Decisions.md)
- DEC-001 — Desktop stack: Electron + React + TypeScript, electron-vite, electron-builder, npm
- DEC-002 — One SQLite (better-sqlite3, WAL, FTS5); no vector store
- DEC-003 — (SUPERSEDED by DEC-061) Anthropic as the only model provider; models `claude-opus-5-5` (main) and `claude-haiku-4-5` (fast)
- DEC-004 — (PARTLY SUPERSEDED by DEC-061/067/069: only the Gmail OAuth token is a stored secret) Secrets are stored with Electron `safeStorage`, whose key lives in the macOS Keychain
- DEC-005 — Product name "Research Workspace"; data dir `~/Library/Application Support/Research Workspace/`
- DEC-006 — (AMENDED by DEC-063/064) v1 source adapters frozen: rss, web, hn_api, email, manual (+ auth capability on web)
- DEC-007 — (SUPERSEDED by DEC-063/067) Browser authentication: app-owned persistent session only (Mechanism A); no share/browser extension in v1
- DEC-008 — (SUPERSEDED by DEC-069) Email via IMAP/SMTP with an app-specific password; one mailbox
- DEC-009 — No SMS/text channel in v1
- DEC-010 — Remove the Dictate button; no PDF/file ingress
- DEC-011 — AI evidence→thesis links remain suggestions; thesis columns show only accepted links
- DEC-012 — One `field_values` mechanism for built-in fields, custom fields and corrections
- DEC-013 — One feed item per document (not per evidence)
- DEC-014 — Deterministic synthetic corpus plus local fixture server; live sources used for prerequisites and non-blocking smoke
- DEC-015 — Live model calls in all gates; the response cache is for development iteration only
- DEC-016 — Scheduler catch-up policy
- DEC-017 — "Real-time" frequency means polling every 15 minutes
- DEC-018 — Minimal UI additions M1–M17
- DEC-019 — Privacy copy (exact)
- DEC-020 — People have no page; they exist only attached to a company or firm
- DEC-021 — Export "Copy link" becomes "Copy as Markdown"
- DEC-022 — "Start tracking “X”" creates a company by name without web search
- DEC-023 — The library location is fixed (not user-movable in v1)
- DEC-024 — Relationship-shaped suggestions live in `relationships` (status `suggested`); other proposals in `suggestions`
- DEC-025 — A triage gate (fast model) before extraction, plus a daily processing cap
- DEC-026 — Ambiguous entity matches become a new entity plus a merge suggestion
- DEC-027 — Blind evaluations use Claude Code subagents through a `ui-driver` CLI and a separate judge
- DEC-028 — Source removal: soft delete, immediate hiding, 30-day purge of unreferenced data
- DEC-029 — Mute for a week keeps polling and alerts; it only hides feed items
- DEC-030 — Polled web fetches honor robots.txt; manual Read once does not
- DEC-031 — No onboarding wizard; the starter pack and report templates are opt-in
- DEC-032 — Window chrome adaptation
- DEC-033 — Design parity via `test.seedDemo` and a judged screenshot comparison
- DEC-034 — Alert caps: per-rule cooldown 6 h; email ≤3 per day; in-app uncapped but deduped per (rule, evidence)
- DEC-035 — "Today" means items surfaced in the last 24 hours
- DEC-036 — Report and alert requests are persisted drafts compiled by durable jobs
- DEC-037 — Monitoring runs only while the app runs; no background daemon
- DEC-038 — Explicit evidence supersession on new document versions
- DEC-039 — Relationships have many supporting evidence rows (`relationship_evidence`)
- DEC-040 — Deterministic grounding check beyond citation ids
- DEC-041 — Removal keeps user-referenced items visible; one `isUserReferenced` predicate
- DEC-042 — The clean-state command preserves only the git-ignored credential file
- DEC-043 — Distinguish an entitlement wall from session expiry
- DEC-044 — Smaller fixes from the same pass
- DEC-045 — Reset never deletes; it re-processes every stored document of the source
- DEC-046 — Purge unwinds dependents in order; notifications become snapshots
- DEC-047 — One hostname per fixture site (`*.test` via Chromium host-resolver-rules); a single "covers" definition
- DEC-048 — Blind evaluators and judges run as `claude -p --model opus` processes
- DEC-049 — AI thesis links are written per evidence row
- DEC-050 — Store only reader-visible text when a wall is detected
- DEC-051 — Other fixes from the same review
- DEC-052 — Inputs are committed; the clean step also excludes zips
- DEC-053 — Rejections are keyed on (document, target), not on evidence rows
- DEC-054 — Field-value provenance stays consistent through purge and restatement (re-pointing part superseded by DEC-058)
- DEC-055 — Auth checks use up to 5 walled candidate URLs; the first one that passes is pinned
- DEC-056 — Ledger fixture articles live under `/articles/` with a third, unwalled filler
- DEC-057 — Generation-only reprocessing is never "new"
- DEC-058 — One `resolveCurrent` rule for field values; restatements add rows (supersedes DEC-054's re-pointing)
- DEC-059 — Syncs re-fetch still-listed items; auth syncs check the session first
- DEC-060 — Never replace full text with walled text
- DEC-061 — AI = OpenAI GPT-6 Luna only, through the ChatGPT sign-in already on the Mac (Codex CLI)
- DEC-062 — Email uses the user's own Gmail, not a dedicated mailbox (transport: DEC-069)
- DEC-063 — X/LinkedIn: never polled or scraped; only URLs the user sends
- DEC-064 — Free sources first: an expanded starter pack and saved searches
- DEC-065 — Blind evaluators and judges stay on Claude Code (build-time tooling)
- DEC-066 — Agent operation of the desktop app is proven before product code exists
- DEC-067 — Chrome session bridge: use whatever the user is signed into in Chrome
- DEC-068 — Four source tiers, each validated live; mid-build human checkpoints
- DEC-069 — (SUPERSEDED by DEC-075) Gmail via the Gmail API with Google OAuth
- DEC-070 — (AMENDED by DEC-072: invalid offsets → pending capture, page text discarded) Tier-4 fallback extraction stores only verbatim page text
- DEC-071 — Pivot hygiene fixes
- DEC-072 — Checkpoint and fallback consistency fixes (review round 7)
- DEC-073 — Tier-4 pages leave no page HTML on disk; pending captures have a home
- DEC-074 — (SUPERSEDED by DEC-075) Prefer a "published" personal Google OAuth app so the Gmail sign-in is permanent
- DEC-075 — Gmail via IMAP/SMTP with a Gmail app password (supersedes DEC-069/074)
- DEC-076 — The app never reads `prereq/.env.local`; every account has an in-app flow
- DEC-077 — X checkpoint completed during setup
- DEC-078 — PH-01 foundation choices: pinned versions, IPC payload shape, renderer port method
- DEC-079 — Sidebar glass is painted by the page, not native vibrancy
- DEC-080 — PRQ-EMAIL-02 reopened: the saved StrictlyVC message was a subscription confirmation
- DEC-081 — Test-only IPC hooks beyond the §1B.3 list
- DEC-082 — Raw email artifacts are stored with per-recipient tokens removed; SEC-01 greps the Gmail app password
- DEC-083 — Live smoke stops each source after its first processed document
- DEC-084 — Blind UX setup details
- DEC-085 — A new source starts "from today"; older posts load on request (user-directed)
- DEC-086 — The live-StrictlyVC assertion of SMK-06 is non-blocking until a real issue exists (user-authorized)
- DEC-087 — Live real-source verification is the primary acceptance gate; fixture suites become regression checks (user-directed)
- DEC-088 — Hydrate a company or firm the user adds (user-directed)
- DEC-089 — Split an entity through a chat correction (user-directed)
- DEC-090 — Report and alert requests that can't be built faithfully are answered, not approximated; empty runs aren't emailed
- DEC-091 — Email is built from reports: briefings (user-directed)
- DEC-092 — Extraction guards: which names become entities, grounded roles and stages, one row per claim
- DEC-093 — Story reports: article pictures, a grounded narrative, deterministic charts, chosen layouts, one renderer for app and email (user-directed)
- DEC-094 — One ontology-operations layer: a registry of ops, one dispatch path, undo, invariants (user-directed)
- DEC-095 — Acceptance runs in two parallel lanes (user-directed)
- DEC-096 — Three tiers decide what syncs and what matters; Today in three sections; aliases only when the text says so (user-directed)
- DEC-097 — Test runs are headless (user-directed)
- DEC-098 — Fast development tests; full live acceptance unchanged as the bar (user-directed, amends DEC-015)
- DEC-099 — The user's layer on every object; following always looks it up; Re-process anything (user-directed)
- DEC-100 — Reports are deep dives read in the app; only briefings send; reading first, Refine on top (user-directed)
- DEC-101 — The daily reading limit is the user's, and off by default (amends DEC-025)

## Artifacts
- `app/dist/Research Workspace-1.0.0-arm64.dmg` sha256 `6b39e5082353c13ca64d897eea6f6b14e6b2e713239552127d23345ebea98db4`
- `app/dist/mac-arm64/Research Workspace.app` (executable sha256 `162fe72650b08169dfcea0370f9815973b88bb7bc23dd33a718c163b27622f90`)
- Run artifacts: `tests/results/acc-2026-10-08T09-11-31/`
