# Decisions

Consequential decisions and deviations for Research Workspace. Each entry: ID · Date · Status · Context · Decision · Alternatives · Reason · Consequences · Affected RFC sections. The build agent appends entries (DEC-036 onward) and edits the affected RFC section in place with `(See DEC-###)`. Status values: `Accepted` (frozen before kickoff), `Superseded by DEC-###`.

All entries below: **Date 2026-09-30 · Status Accepted** (RFC authoring, before kickoff).

---

### DEC-001 — Desktop stack: Electron + React + TypeScript, electron-vite, electron-builder, npm
- **Context:** The handoff baseline recommends Electron. The prototype is a web-rendered React-style page.
- **Decision:** Electron (latest stable major at kickoff, pinned exactly), React 18, strict TypeScript, electron-vite for builds, electron-builder for dmg/app (ad-hoc signed), npm with a committed lockfile. The pinned Electron version is recorded here when PH-01 starts.
- **Alternatives:** Tauri (Rust backend; the Node libraries we rely on such as Readability, imapflow and better-sqlite3 would need replacements). Swift/SwiftUI (would mean rewriting the approved web prototype).
- **Reason:** Fastest faithful port of the approved prototype, and one language across UI and backend.
- **Consequences:** Larger binary; the native module needs `@electron/rebuild`.
- **Affected:** §1B.1, §1B.2, PRQ-ENV-05/06.

### DEC-002 — One SQLite (better-sqlite3, WAL, FTS5); no vector store
- **Context:** Baseline requires one relational DB; semantic search is optional.
- **Decision:** A single `research.sqlite` database with FTS5 for lexical search. There are no embeddings in v1.
- **Alternatives:** sqlite-vec, or embeddings stored in a BLOB column.
- **Reason:** The query planner expands search terms with the model, which covers most lexical gaps. The chosen provider has no embeddings API, and a second provider would add a prerequisite.
- **Consequences:** Revisit only if BK evaluations fail because of recall misses. Adding embeddings then requires a DEC and a migration.
- **Affected:** §1B.4, §1B.16.

### DEC-003 — (SUPERSEDED by DEC-061) Anthropic as the only model provider; models `claude-opus-5-5` (main) and `claude-haiku-4-5` (fast)
- **Context:** One provider interface is required. The environment is Claude-native.
- **Decision:** `@anthropic-ai/sdk` is used only in `ai/provider.ts`. `main` uses Opus 5.5 with explicit `output_config.effort` (low for most tasks, medium for query/customization) and server-side refusal fallbacks. `fast` uses Haiku 4.5 for triage, entity ambiguity and alert checks. Structured output uses `output_config.format` with JSON Schema, then zod re-validation.
- **Alternatives:** Sonnet 5.5 as the main model (cheaper), or multiple providers.
- **Reason:** Opus 5.5 is the current default recommended model. Grounding quality matters most for extraction and answers.
- **Consequences:** Cost is about $0.05–0.10 per processed document. A daily processing cap (default 150) bounds it. Switching models means editing one constant in `ai/models.ts` and adding a DEC entry.
- **Affected:** §1B.12, PRQ-AI-01/02.

### DEC-004 — (PARTLY SUPERSEDED by DEC-061/067/069: only the Gmail OAuth token is a stored secret) Secrets are stored with Electron `safeStorage`, whose key lives in the macOS Keychain
- **Context:** The handoff requires Keychain storage, not plaintext.
- **Decision:** Secrets are encrypted with `safeStorage` (Keychain-held key) into `secrets.bin` in the data dir. They are never stored in SQLite, logs or model inputs.
- **Alternatives:** Individual Keychain items via keytar (deprecated), `@napi-rs/keyring` (another native module), or the `security` CLI (the secret would be exposed in process arguments).
- **Reason:** Built-in, needs no extra native dependency, and is Keychain-backed.
- **Consequences:** Secrets do not appear as separate items in Keychain Access. PRQ-ENV-07 verifies availability.
- **Affected:** §1B.6.

### DEC-005 — Product name "Research Workspace"; data dir `~/Library/Application Support/Research Workspace/`
- **Context:** The prototype title is "Research Workspace"; the handoff calls the project "VC Research OS".
- **Decision:** Display name is Research Workspace, bundle id `com.local.researchworkspace`. `RW_DATA_DIR` overrides the data dir for tests.
- **Alternatives:** Use the prototype's `~/Research Library` as the data dir.
- **Reason:** Standard macOS location. Clean-state tests need an overridable path.
- **Consequences:** Settings shows the path and a "Show in Finder" button.
- **Affected:** §1B.5, §1B.21.

### DEC-006 — (AMENDED by DEC-063/064) v1 source adapters frozen: rss, web, hn_api, email, manual (+ auth capability on web)
- **Context:** The prototype seed shows X accounts, podcasts and YouTube. The handoff says constrained sources must not be assumed.
- **Decision:** X, LinkedIn, Product Hunt, YouTube, podcast audio and Spotify/Apple Podcasts locators return an `unsupported` probe result with product copy. Read once of such URLs is attempted as an ordinary web page. Podcast RSS feeds work as plain RSS (show notes only). The Add-source example chips `@karpathy` and `stratechery.com/feed` are replaced by HN, a16z, TechCrunch feed and StrictlyVC.
- **Alternatives:** Build an X API adapter, or transcribe audio.
- **Reason:** Access terms, cost and brittleness. None of these sources is needed to prove the ingestion architecture.
- **Consequences:** Adapters can be added later through the same `SourceFetcher` contract.
- **Affected:** §1A.2, §1B.8.2, §1A.7-M15.

### DEC-007 — (SUPERSEDED by DEC-063/067) Browser authentication: app-owned persistent session only (Mechanism A); no share/browser extension in v1
- **Context:** The handoff offers Mechanism B as optional.
- **Decision:** Only Mechanism A ships: a sign-in window with a `persist:auth:<domain>` partition. Read once on a domain that has a session uses that session.
- **Alternatives:** A Safari share extension or a Chrome extension.
- **Reason:** Extensions need separate signing and distribution, plus their own automation for tests.
- **Consequences:** One-off pages from the user's normal browser must be pasted in as a URL.
- **Affected:** §1A.2, §1B.8.5.

### DEC-008 — (SUPERSEDED by DEC-069) Email via IMAP/SMTP with an app-specific password; one mailbox
- **Context:** Newsletter ingress and report/alert delivery need a mail account, and there is no central backend.
- **Decision:** Use `imapflow`, `mailparser` and `nodemailer` against a single user-configured account (Gmail, iCloud or Fastmail app password). Deterministic tests use IMAP APPEND of frozen .eml files into `RW-Fixtures`.
- **Alternatives:** Gmail OAuth (needs app verification for restricted scopes), a transactional email API (needs a shared or user secret plus sender verification).
- **Reason:** Works with any provider, runs directly from the Mac, and can be verified mechanically.
- **Consequences:** The user must create an app password (PRQ-EMAIL-01).
- **Affected:** §1B.8.2, §1B.19, PRQ-EMAIL-01/02.

### DEC-009 — No SMS/text channel in v1
- **Context:** The prototype shows "Text" delivery, "Texts go to…" and "Texts are capped at three a day".
- **Decision:** Channels are in-app (plus macOS notification) and email. Text rows are removed from Settings. The Alerts caption becomes "High-signal only. Email alerts are capped at three a day."
- **Alternatives:** Twilio with a user-owned account, or iMessage via AppleScript.
- **Reason:** SMS needs user-owned provider credentials and phone verification, or fragile automation. The handoff forbids shipping a shared secret.
- **Consequences:** This is a copy-level deviation from the prototype.
- **Affected:** §1A.2, §1A.7-M15, §1B.18.

### DEC-010 — Remove the Dictate button; no PDF/file ingress
- **Context:** The prototype's Dictate button simulates speech. Voice and PDF are "later" in the handoff.
- **Decision:** The thought sheet has no Dictate button. macOS system dictation still works in any text field. There is no file/PDF import.
- **Alternatives:** Web Speech API (not functional in Electron without Google keys), or recorded audio plus a transcription provider.
- **Reason:** No reliable local API, and it would add a second provider.
- **Consequences:** Minor visual deviation (VIS judge informed).
- **Affected:** §1A.2, V-THOUGHT.

### DEC-011 — AI evidence→thesis links remain suggestions; thesis columns show only accepted links
- **Context:** The handoff says inferred thesis relationships remain suggestions unless policy promotes them. The prototype shows stance chips on every card.
- **Decision:** AI links are always `suggested`. They are shown as interpretation (card chip, inspector, Recent changes, Review, alerts "may challenge"). Supporting/Contradicting columns and Related theses show only user-accepted links.
- **Alternatives:** Auto-accept links above a confidence threshold.
- **Reason:** Keeps user belief separate from AI interpretation (LAW-04).
- **Consequences:** Thesis evidence grows only through user curation (Keep, Confirm, Attach, highlight).
- **Affected:** §1B.13.2, §1B.14.

### DEC-012 — One `field_values` mechanism for built-in fields, custom fields and corrections
- **Context:** Corrections need history and precedence. Custom fields need values with provenance.
- **Decision:** Mutable attributes (stage, HQ, founded, tagline, website, custom fields) live in `field_values` with origin, evidence and status. Entity tables hold only identity.
- **Alternatives:** Columns plus a separate corrections table plus a custom-values table.
- **Reason:** One precedence rule, one history, one provenance path.
- **Consequences:** Stage filters join `field_values` (cheap at this scale).
- **Affected:** §1B.4.2, §1B.13.3, §1B.15.

### DEC-013 — One feed item per document (not per evidence)
- **Context:** The prototype cards are article-level.
- **Decision:** `feed_items.document_id` is unique. Newsletter issues are one item containing many evidence rows.
- **Alternatives:** Per-evidence cards.
- **Reason:** Matches the prototype and avoids flooding.
- **Consequences:** Novelty is computed from evidence and aggregated to the item score.
- **Affected:** §1B.14.

### DEC-014 — Deterministic synthetic corpus plus local fixture server; live sources used for prerequisites and non-blocking smoke
- **Context:** Live sites are unstable and model memory can leak into answers.
- **Decision:** A fictional-entity corpus (Appendix A) is served on 127.0.0.1:4700 and includes an auth-gated "Ledger" site. Frozen live snapshots are used for extraction smoke. Live subscriptions are non-blocking in acceptance.
- **Alternatives:** Test only against live sites.
- **Reason:** Deterministic, answerable and grounding-sensitive.
- **Consequences:** The setup phase authors the corpus (PRQ-FIX-02).
- **Affected:** §3, Appendix A, Section 0.

### DEC-015 — Live model calls in all gates; the response cache is for development iteration only
- **Decision:** `RW_LLM_CACHE=off` in every gate and acceptance run. Assertions check fixture facts, not AI wording. One re-run is allowed only for provider/network errors.
- **Alternatives:** Recorded cassettes in CI.
- **Reason:** Verifies real product behavior.
- **Consequences:** Every gate run costs money (PRQ-AI-03).
- **Affected:** §2.0, §3.0.

### DEC-016 — Scheduler catch-up policy
- **Decision:** Missed polls run once, staggered. Missed reports run once if ≤24 h late (`late=1`, "(Delayed)" subject); older occurrences are skipped. Maintenance runs once.
- **Alternatives:** Replay every missed occurrence, or never catch up.
- **Reason:** Avoids bursts of stale reports while keeping the daily brief useful.
- **Affected:** §1B.11.3.

### DEC-017 — "Real-time" frequency means polling every 15 minutes
- **Context:** The prototype offers Real-time. There is no push without a server.
- **Decision:** Real-time = 15 minutes (email too; no IMAP IDLE).
- **Alternatives:** IMAP IDLE / WebSub.
- **Reason:** Simplicity and politeness.
- **Affected:** §1B.11.2.

### DEC-018 — Minimal UI additions M1–M17
- **Context:** Prototype gaps listed in the RFC request.
- **Decision:** Additions are exactly those in RFC §1A.7, each built from existing prototype components.
- **Alternatives:** New screens (notifications center, onboarding wizard, person page).
- **Reason:** No redesign.
- **Affected:** §1A.7.

### DEC-019 — Privacy copy (exact)
- **Context:** The prototype says "nothing you write is sent to us" and implies on-device processing.
- **Decision (revised 2026-09-30 after the OpenAI/Gmail/Chrome pivot; the earlier Anthropic text is superseded):** Local Data box, exact text: "Your library is stored on this Mac, in a folder you can open and back up. Research Workspace has no server of its own. Sources are fetched directly from this Mac. To summarize, organize and answer questions, article text, your notes, theses and questions are sent from this Mac to OpenAI using the ChatGPT sign-in you already have in Codex, and count toward your ChatGPT plan's usage. Newsletters are read from, and reports and alerts are sent through, your Gmail account. When you send a link from a site like X or LinkedIn, Research Workspace opens just that page using your Chrome sign-in for that site; it never stores your passwords." Notes badge: "Stored on this Mac". Reports footer: "Built on this Mac from your sources, theses and notes." (unchanged). Add-source idle copy "…Checks run from this Mac." (unchanged).
- **Alternatives:** Claim on-device AI (false).
- **Reason:** LAW-11.
- **Affected:** §1A.4, §1A.7-M15, P-SET-005.

### DEC-020 — People have no page; they exist only attached to a company or firm
- **Context:** In the prototype, clicking a person opens their organization.
- **Decision:** Keep that behavior. Extraction creates a person only when their org resolves.
- **Alternatives:** A person page.
- **Reason:** The Person primitive is lightweight (not a CRM).
- **Affected:** §1A.3, §1B.13.1.

### DEC-021 — Export "Copy link" becomes "Copy as Markdown"
- **Reason:** A local app has no shareable URL.
- **Affected:** §1A.5 FLOW-G, §1B.19.

### DEC-022 — "Start tracking “X”" creates a company by name without web search
- **Context:** The prototype subtitle promises to find the company's site and funding history.
- **Decision:** Create a followed company by name. Subtitle: "I'll watch your sources for it. Add its site to follow it directly."
- **Alternatives:** Model web search tool.
- **Reason:** Retrieval must come from the user's sources (P-OBJECT-004). Avoids an extra tool surface.
- **Affected:** P-OBJECT-007, §1A.7-M15.

### DEC-023 — The library location is fixed (not user-movable in v1)
- **Decision:** The Local Data copy drops "move". Show in Finder, Export and Reindex remain.
- **Affected:** §1B.5, DEC-019 text.

### DEC-024 — Relationship-shaped suggestions live in `relationships` (status `suggested`); other proposals in `suggestions`
- **Reason:** Avoids two representations of the same link.
- **Affected:** §1B.4.2, §1B.13.

### DEC-025 — A triage gate (fast model) before extraction, plus a daily processing cap
- **Decision:** Sources in `relevant` or `custom` mode (non-primary) run TRIAGE_DOCUMENT first. The cap defaults to 150 documents per day, overflow waits until local midnight, and a banner is shown.
- **Alternatives:** Extract everything.
- **Reason:** Cost and noise control (for example HN).
- **Affected:** §1B.9.

### DEC-026 — Ambiguous entity matches become a new entity plus a merge suggestion
- **Reason:** Silent merges corrupt research; a split entity plus a banner is recoverable.
- **Affected:** §1B.13.1, M8.

### DEC-027 — Blind evaluations use Claude Code subagents through a `ui-driver` CLI and a separate judge
- **Reason:** The agent environment provides fresh subagents, and the CLI gives them a generic, label-agnostic way to operate the app.
- **Affected:** §3C, PRQ-EVAL-01.

### DEC-028 — Source removal: soft delete, immediate hiding, 30-day purge of unreferenced data
- **Reason:** Undo is safe, user-referenced state is never destroyed, and disk is eventually reclaimed.
- **Affected:** §1B.8.4.

### DEC-029 — Mute for a week keeps polling and alerts; it only hides feed items
- **Reason:** Alerts are explicit user intent. Muting is about attention.
- **Affected:** §1B.8.4, P-SOURCE-006.

### DEC-030 — Polled web fetches honor robots.txt; manual Read once does not
- **Reason:** Politeness and legitimacy for automated polling. A single page the user requested is user-initiated.
- **Affected:** §1B.8.6.

### DEC-031 — No onboarding wizard; the starter pack and report templates are opt-in
- **Decision:** First run shows the Today banner (no key), Today's empty state with "Add a source", and Sources ▸ Suggested with 8 starter cards. Report templates and default alerts are inserted disabled.
- **Reason:** LAW-02 (nothing forced) and no new screens.
- **Affected:** §1A.7-M14, §1B.8.7, §1B.17, §1B.18.

### DEC-032 — Window chrome adaptation
- **Decision:** Native hidden-inset traffic lights, sidebar vibrancy, no painted wallpaper, no outer padding. Everything inside the window follows the prototype.
- **Reason:** The prototype draws a fake desktop window.
- **Affected:** §1A.6, VIS-01.

### DEC-033 — Design parity via `test.seedDemo` and a judged screenshot comparison
- **Reason:** A mechanical guard against redesign drift without pixel-perfect brittleness.
- **Affected:** §3B VIS-01.

### DEC-034 — Alert caps: per-rule cooldown 6 h; email ≤3 per day; in-app uncapped but deduped per (rule, evidence)
- **Affected:** §1B.18.

### DEC-035 — "Today" means items surfaced in the last 24 hours
- **Context:** The prototype uses a seed flag `day: 'today'`.
- **Decision:** A rolling 24-hour window. "All" includes everything not dismissed.
- **Reason:** Deterministic, and robust to late-night reading.
- **Affected:** §1B.14.5, P-FEED-001.

---

## Review round 1 (2026-09-30) — fixes to guarantees flagged by external review

### DEC-036 — Report and alert requests are persisted drafts compiled by durable jobs
- **Context:** LAW-07 promised persistence before model calls, but CREATE_REPORT/CREATE_ALERT wrote only after a successful compile.
- **Decision:** `reports.status` ∈ draft/active/failed with `prompt_text` and `pending_refinement`; `alert_rules.status` ∈ draft/compiled/active/failed. New job types `COMPILE_REPORT` and `COMPILE_ALERT`. Failures keep the text and offer Retry / Edit text. Customize and NL-correction instructions stay in their open input only (explicitly not persisted).
- **Alternatives:** Synchronous compile with an inline error (loses text on crash or quit); a generic "intents" table (one more table for two users).
- **Reason:** Makes LAW-07 true with the existing jobs mechanism.
- **Consequences:** Two nullable columns and two job types. UI rows gain draft/failed states.
- **Affected:** §1A.4 LAW-07, FLOW-G/H, §1B.3, §1B.4.2, §1B.10, §1B.12.3, §1B.17, §1B.18, §1C, E2E-REP-05, E2E-AL-05.

### DEC-037 — Monitoring runs only while the app runs; no background daemon
- **Context:** The scheduler lives in the Electron process, and the product copy said "continuously".
- **Decision:** State the operating limit (LAW-14): background-when-window-closed, catch-up on launch/wake, and an explicit first-run offer to turn on Open at login (default off, user consent).
- **Alternatives:** A launchd agent running a headless scheduler (a second process sharing SQLite, a duplicate backend and more failure modes); forcing the Mac awake (hostile).
- **Reason:** Honest promise with the least machinery.
- **Consequences:** Reports and alerts can be late when the Mac sleeps or the app is quit. The catch-up policy (DEC-016) bounds this.
- **Affected:** §1A.1, LAW-14, M14, P-SET-006, UI-SET-01.

### DEC-038 — Explicit evidence supersession on new document versions
- **Context:** A new version created new evidence without retiring the old; tests expected `superseded`.
- **Decision:** §1B.9.7: unkept AI evidence from earlier versions is superseded; kept/highlight evidence is re-anchored or marked orphaned; relationships lose support rows and become `inactive` when unsupported; novelty and "Updated" feed behavior are defined; all read paths use active evidence only.
- **Alternatives:** Keep all versions' evidence active (duplicate and contradictory facts); delete old evidence (loses user anchors and history).
- **Affected:** §1B.9.7, B-INGEST-004, E2E-ING-03, E2E-VER-01.

### DEC-039 — Relationships have many supporting evidence rows (`relationship_evidence`)
- **Context:** The unique (from, rel, to) row carried one `evidence_id`, so repeated or confirming evidence overwrote provenance.
- **Decision:** `relationships.evidence_id` is removed. A `relationship_evidence(relationship_id, evidence_id, status)` join table is added. `relationships.status` gains `inactive`. Firm investment lists derive rows from supporting evidence fingerprints.
- **Alternatives:** Drop the unique key (duplicate edges, harder queries).
- **Affected:** §1B.4.2, §1B.13.2, §1B.15 component rules, E2E-REL-01.

### DEC-040 — Deterministic grounding check beyond citation ids
- **Context:** Answers were only checked for citation existence, so a valid citation could accompany an invented claim.
- **Decision:** `groundingCheck` (numbers, names, verbatim quotes) is applied to evidence claims, answer items (with required `quotes[]`), composed report bullets, object summaries and document summaries / why-it-matters. Failing facts or sentences are removed (with one retry for answers). Evidence claims that fail fall back to the verbatim quote.
- **Alternatives:** An LLM entailment judge (non-deterministic, extra cost, still needs a check of its own); labelling everything "unverified" (shifts the burden to the user).
- **Reason:** Cheap and deterministic, and it catches the highest-risk fabrications (wrong amounts, wrong names). It does not prove full entailment. Residual risk: paraphrase-level distortions with correct numbers and names; the BK blind evaluation remains the backstop.
- **Affected:** LAW-05, §1B.9.8, §1B.12.3, §1B.16, E2E-GRD-01/02/03, B-AGENT-007.

### DEC-041 — Removal keeps user-referenced items visible; one `isUserReferenced` predicate
- **Context:** Remove hid a saved item whose only source was removed, contradicting E2E-SRC-02.
- **Decision:** A single predicate (§1B.8.4) is used by Remove, Purge, Reset and supersession. User-referenced items stay visible after removal.
- **Affected:** §1B.8.4, E2E-SRC-02.

### DEC-042 — The clean-state command preserves only the git-ignored credential file
- **Decision:** `git clean -xfd -e prereq/.env.local`, then assert the file exists and `git status --porcelain` is empty. Live snapshots and fixtures are committed and therefore unaffected.
- **Affected:** §3E step 1.

## Author's own adversarial pass (2026-09-30)

### DEC-043 — Distinguish an entitlement wall from session expiry
- **Context:** Sifted mixes free and Pro content. A free account hitting a Pro wall would have flipped the source to `expired` and stopped ingestion.
- **Decision:** On a wall, re-run the auth check against the known-accessible `checkUrl`. If it fails, the session has expired. If it passes, store the article as `access='partial'` with an entitlement label and keep going.
- **Affected:** §1B.8.5, Appendix A (D14p), E2E-AUTH-04.

### DEC-044 — Smaller fixes from the same pass
- Grounding name-rule exemptions (thesis titles, source names, question text, dates, product name) prevent false drops.
- Report run snapshots are self-contained and no longer count as "user-referenced". Otherwise daily briefs would block every purge.
- The daily cap counts EXTRACT runs only.
- Per-document/per-source job serialization; obsolete PROCESS jobs exit cleanly; Reset returns CONFLICT while a fetch is running.
- Merges require a confirm sheet and are irreversible.
- `test.seedDemo` maps prototype-only source types to `web` for the parity check only.
- Setup mode explicitly allows authoring the prereq scripts and the fixture corpus/server.
- **Affected:** §1B.8.4, §1B.9, §1B.9.8, §1B.10, §1B.13.4, §1B.17, §1B.3, Goal Prompt.

## Review round 2 (2026-09-30) — independent Opus adversarial review

### DEC-045 — Reset never deletes; it re-processes every stored document of the source
- **Context:** Reset deleted AI rows that foreign keys still referenced (field values, relationship support, notifications). It also relied on supersession that only triggers on new versions, and permanently stripped evidence from documents outside the refetch window.
- **Decision:** Reset bumps `ai_generation`, clears the cursor, re-runs PROCESS_DOCUMENT for every stored document from its stored text, and also refetches for new items. §1B.9.7 supersession triggers on a generation change as well as a version change.
- **Affected:** §1B.8.4, §1B.9.7, E2E-SRC-01.

### DEC-046 — Purge unwinds dependents in order; notifications become snapshots
- **Decision:** Purge proceeds in order: supersede and recompute field values, remove support rows and recompute relationship status, keep rejected tombstones, and null the notification's evidence and document ids while keeping its title and body. Only then are the document rows deleted.
- **Affected:** §1B.8.4, `notifications` schema, E2E-SRC-02.

### DEC-047 — One hostname per fixture site (`*.test` via Chromium host-resolver-rules); a single "covers" definition
- **Context:** All fixtures sat on 127.0.0.1:4700, which broke domain-keyed features (firm writing, domain entity resolution, auth partitions, source coverage, politeness).
- **Decision:** `/<site>/<path>` ≡ `http://<site>.test:4700/<path>`. The server routes by Host header. In test mode the app sets `host-resolver-rules="MAP *.test 127.0.0.1"`. A source covers an entity iff `site_domain` equals the entity domain. Politeness is keyed by host:port, and probes are exempt.
- **Affected:** Appendix A, §1B.8.4, §1B.8.6, tests throughout.

### DEC-048 — Blind evaluators and judges run as `claude -p --model opus` processes
- **Context:** A Node npm script cannot call an agent's Agent tool, so the eval gate could not run mechanically.
- **Decision:** `tests/blind/run.mjs` spawns fresh `claude -p` processes in empty temp dirs. The asker and UX agents get only ui-driver Bash access; judges get no tools (VIS: Read only). PRQ-EVAL-01 verifies the CLI is present and signed in.
- **Affected:** §3C, §3B VIS-01, PRQ-EVAL-01.

### DEC-049 — AI thesis links are written per evidence row
- **Decision:** INTERPRET returns `evidenceIds` for each thesis link. Both document→thesis and evidence→thesis suggested links are written, with the same stance. Alerts, `thesis_contra` and stance filters read the evidence-level links.
- **Affected:** §1B.12.3, §1B.18, §1B.17.

### DEC-050 — Store only reader-visible text when a wall is detected
- **Context:** Readability and outerHTML can capture text a site hides behind a paywall, which would store and send content the user isn't entitled to (LAW-13).
- **Decision:** Browser mode extracts visible `innerText`. In any mode, text at or after the first wall element or phrase is dropped before storage and before any model call.
- **Affected:** §1B.8.6.

### DEC-051 — Other fixes from the same review
- **Crash recovery and test clock:** crash recovery requeues all `running` jobs at start. The fake clock persists across relaunch. Jitter is off in test mode.
- **Fault injection:** a `provider_error` fault replaces the ambiguous "unavailable" (`AI_UNAVAILABLE` is reserved for a missing key). `drain` semantics are defined.
- **Fixture listings and names:** fixture listings have ≥3 article links, and Northwind has Portfolio/Investments navigation. Entity-alias variants were added to the fixtures.
- **Answers:** answers are no longer streamed; progress events stream instead, and the answer appears only after the grounding check.
- **Payload ids:** evidence payloads carry resolved entity ids for alert matching.
- **Re-gating:** documents are re-gated when a new source (Read once / `mode='all'`) sees an already-stored document.
- **Stale jobs:** PROCESS jobs re-check version and generation inside the write transaction.
- **Auth:** only presses of Done count toward `blocked`. PRQ-AUTH-01 re-verifies from the saved partition. The live-auth smoke is best-effort.
- **Privacy/AI toggle:** the AI toggle also gates SUGGEST_THESES, and its copy mentions Ask.
- **Fields:** built-in fields arrive only with verbatim quotes and pass the grounding check. Superseded field provenance is labelled.
- **Alert tests:** they assert "exactly one delivered", and the cooldown case uses `/alerts/burst-*`.
- **Banners and routing:** `app.status.banners` is added. Report→alert routing emits `alert.needsConfirmation`.
- **Merges:** a user value on the merged-from entity beats a source value on the target.
- **Feed ordering:** the relevance sort is novel-first.
- **New tests:** UI-OBJ-04, UI-SET-02, E2E-FEED-01, plus a Not-interested step in UI-EMPTY-01. UI-EMPTY-01 uses the HN fixture instead of live HN.
- **Smaller corrections:**
  - `notes.kind_origin` added.
  - Funding table deduplicates by (company, round).
  - Grounding exempts years and matches names case-insensitively as whole tokens.
  - D14 is ≥400 words.
  - Prototype CDN scripts are vendored for VIS-01.
  - SMK-13 runs without secrets.
  - Stale job and fault names are fixed.
  - The fourth report template is labelled as added.

## Review round 3 (2026-09-30) — blocking-only conceptual review (Opus)

### DEC-052 — Inputs are committed; the clean step also excludes zips
- **Context:** `git clean -xfd` would have deleted the untracked input archives. PRQ-DESIGN-01 would then fail, and the only recovery would be to ask the human.
- **Decision:** PRQ-DOC-01 requires the input zips, `design/prototype/` and `design/prototype-vendor/` to be tracked, and §3E adds `-e '*.zip'` as a belt-and-braces exclusion.
- **Affected:** §0.2 PRQ-DOC-01, §3E step 1.

### DEC-053 — Rejections are keyed on (document, target), not on evidence rows
- **Context:** Evidence ids change on reset and new versions, so evidence-level suggested links re-appeared after the user rejected them (LAW-06).
- **Decision:** `link.reject` and `link.rejectEntity` reject the document-level pair and every evidence-level row of that document. The AI writer and every read path honour rejected document pairs.
- **Affected:** §1B.13.2.

### DEC-054 — Field-value provenance stays consistent through purge and restatement (re-pointing part superseded by DEC-058)
- **Decision:** Purge deletes non-user `field_values` rows that cite doomed evidence, after recomputing the current value; `history` keeps the audit trail. When the same value is restated by newer or equal active evidence, the current row's `evidence_id` is re-pointed to it.
- **Affected:** §1B.8.4 Purge, §1B.13.3, E2E-SRC-02.

### DEC-055 — Auth checks use up to 5 walled candidate URLs; the first one that passes is pinned
- **Context:** Logged out, a single probed URL could be a paid-plan-only article, which would mark entitled free accounts `blocked`.
- **Decision:** The profile keeps `checkCandidates` (≤5). A sign-in passes if any candidate passes, and that URL is pinned as `checkUrl`. `blocked` only when all candidates fail on three Done presses. In the fixture listing, D14 comes before D14p. The UX goals use `*.test` URLs.
- **Affected:** §1B.8.3, §1B.8.5, Appendix A, §3C.2.

## Review round 4 (2026-09-30) — final blocking-only review (Opus)

### DEC-056 — Ledger fixture articles live under `/articles/` with a third, unwalled filler
- **Context:** Under DEC-047, Ledger's article paths had one segment and only two links, so the probe returned `unsupported` and every auth gate failed.
- **Affected:** Appendix A; all Ledger test references.

### DEC-057 — Generation-only reprocessing is never "new"
- **Context:** Reset and retries re-extract with model-dependent fingerprints. Items went back to unread and alerts fired again, contradicting Reset's "state untouched" promise.
- **Decision:** With the same version and a new generation, all evidence has `is_novel=0`, nothing resurfaces, and alerts are not re-evaluated. E2E-SRC-01 asserts that `read_at`/`surfaced_at` are unchanged and no new notifications are created.
- **Affected:** §1B.9.7, E2E-SRC-01.

### DEC-058 — One `resolveCurrent` rule for field values; restatements add rows (supersedes DEC-054's re-pointing)
- **Context:** Re-pointing one row to the latest restating evidence lost the other supports. Purging one source could then erase a value another live document still supports.
- **Decision:** Every supporting evidence has its own `field_values` row. The current row is the user row, otherwise the newest row with active evidence, otherwise the latest row labelled "From an earlier version". The same function is used on insert, supersession, revert and purge.
- **Affected:** §1B.13.3, §1B.9.7, §1B.8.4.

### Smoke-test correction (no DEC needed)
SMK-03 now asserts Priya Raman partner_at Northwind (present in D7), not Dana Okafor (only in D1).

## Review round 5 (2026-09-30)

### DEC-059 — Syncs re-fetch still-listed items; auth syncs check the session first
- **Context:** Fetch only retrieved unseen items, so a changed article (same URL) was never refetched and versioning never ran. On an auth source, an expired session went unnoticed when the listing had no new links. This blocked E2E-ING-03, E2E-VER-01, E2E-REL-01, BK-Q1/Q5, SMK-07 and E2E-AUTH-02.
- **Decision:** `web` and `rss` syncs re-fetch every already-seen item still present in the listing or feed (bounded by `maxItemsPerSync`). Unchanged items stop at the hash check with no model call, so E2E-ING-02 still sees 0 EXTRACT runs. A sync of an authenticated source runs `authCheck(checkUrl)` before fetching articles. The §1C reset diagram now matches DEC-045 ("nothing deleted").
- **Alternatives:** HTTP conditional GET only (it doesn't help sites without ETags); periodic full recrawls (more requests).
- **Consequences:** More requests per sync (still bounded, and polite per host).
- **Affected:** §1B.8.2, §1B.8.4 Sync now, §1B.8.5, §1C.2.

### DEC-060 — Never replace full text with walled text
- **Context:** With DEC-059 re-fetching seen items, a metered or soft paywall, or a lost entitlement, would create a truncated "new version". That would supersede evidence and orphan the user's highlights even though the content never changed.
- **Decision:** In dedupe step 4a, a walled re-fetch of a document whose stored version is `full` is treated as unchanged (touch `last_seen` and stop).
- **Affected:** §1B.9 step 4a.


## Product-owner direction (2026-09-30): OpenAI-only AI, free sources, user's own accounts

### DEC-061 — AI = OpenAI GPT-6 Luna only, through the ChatGPT sign-in already on the Mac (Codex CLI)
- **Context:** The user wants OpenAI only, the Luna model, no reasoning models, no paid API key, and authentication through their existing ChatGPT subscription.
- **Decision:** One model, `gpt-6-luna`, with `reasoning.effort:'none'`. Calls go to `https://chatgpt.com/backend-api/codex/responses` using the token from `~/.codex/auth.json` (headers: Bearer, `chatgpt-account-id`, `originator: codex_cli_rs`). The app detects the sign-in automatically and stores no key. Refreshed tokens are written back atomically. A usage guard pauses background AI work at 85% of the weekly allowance shown in the `x-codex-*` headers.
- **Verified 2026-09-30 (live):** text, strict json_schema, effort none (0 reasoning tokens), 8 parallel calls, ~60k-token input. Recipe: MEM-012, `prereq/spikes/luna/`.
- **Alternatives:** OpenAI API key (paid, rejected by the user); OpenAI's documented "Sign in with ChatGPT" token-sharing (open-source apps only; the user chose not to publish).
- **Risks:** The endpoint is undocumented. Reusing the Codex sign-in isn't clearly sanctioned by OpenAI and can break without notice. Usage shares the user's Codex allowance.
- **Affected:** §1A.2, LAW-11, M11, M14, §1B.1, §1B.3, §1B.6, §1B.12, PRQ-AI-01..03, §3.0, SMK-01, E2E-AI-01.

### DEC-062 — Email uses the user's own Gmail, not a dedicated mailbox (transport: DEC-069)
- **Context:** The user can authorize their own mailbox but can't create a separate one for the app.
- **Decision:** All email runs against the user's own Gmail. Deterministic tests write only into label `RW-Fixtures` and clean up after themselves (the user agreed).

### DEC-063 — X/LinkedIn: never polled or scraped; only URLs the user sends
- **Context:** The user prioritizes safety on these platforms and wants them read through their own browser profile.
- **Decision:** Profile and feed URLs are refused for watching. Read once, the bookmarklet (`researchworkspace://add?url&text`) and drag-and-drop each cost at most one headless page load through the Chrome session bridge (DEC-067). No scrolling, clicking or challenge solving.
- **Supersedes:** DEC-006's X exclusion (on-demand X is now in scope) and the interim plan to poll social feeds on a budget.
- **Affected:** §1A.2, §1B.8.2, §1B.8.8, PH-07b, E2E-SENT-*, UX-11.

### DEC-064 — Free sources first: an expanded starter pack and saved searches
- **Context:** The user wants free sources (newsletters, news sites, famous startup blogs with RSS, YC/HN) plus recurring searches and deal/funding headlines.
- **Decision:**
  - Starter pack of 30 entries in four groups: News, Startup & VC blogs, Searches, Newsletters (§1B.8.7). Feeds were live-checked on 2026-09-30.
  - Paul Graham has no RSS feed, so his essays use the web listing at `paulgraham.com/articles.html`.
  - New source kind `search`: Google News RSS by default, with HN Algolia as an option. Result links are resolved to publisher articles.
- **Affected:** §1B.8.2, §1B.8.7, §1B.4.2 sources.kind, P-SOURCE-016, PH-07b, E2E-SRCH-01.

### DEC-065 — Blind evaluators and judges stay on Claude Code (build-time tooling)
- **Decision:** The "OpenAI only" rule applies to the app. Test harness evaluators (`claude -p`) are build tooling and never ship. Can be swapped to `codex exec` with a one-line change in `tests/blind/run.mjs` if desired.

### DEC-066 — Agent operation of the desktop app is proven before product code exists
- **Decision:** Playwright `_electron.launch` drives both the dev build and the installed packaged `.app` (`executablePath`), with optional CDP attach. PRQ-SPIKE-01 was verified live (MEM-011). One gotcha is recorded: asar packaging needs an explicit `files` list.
- **Affected:** §3.0.1, PRQ-SPIKE-01.

### DEC-067 — Chrome session bridge: use whatever the user is signed into in Chrome
- **Context:** The user wants the app to reuse their existing browser sign-ins (not just cookies), headless. This overrides the handoff's "do not import browser cookies" rule at the product owner's explicit direction.
- **Decision:** With Keychain consent:
  - decrypt the chosen Chrome profile's cookies, plus local/IndexedDB session tokens, for the target domain only, in memory;
  - inject them into a temporary headless Chrome context (`channel:'chrome'`, normal user agent).
  - Used only for Tier 4 (user-sent URLs).
- **Verified 2026-09-30:** X home and the Gmail inbox loaded signed in, headless. A copied profile directory does NOT work. Recipe: MEM-013, `prereq/spikes/browser-session/`.
- **Risks:** Hardware- or device-bound sessions may not transfer. Reading the Chrome Safe Storage key is sensitive, so it is kept in memory only and the prompt repeats each launch.
- **Affected:** LAW-13, LAW-15, §1B.8.8, §1B.8.9, M11, PRQ-AUTH-01/02.

### DEC-068 — Four source tiers, each validated live; mid-build human checkpoints
- **Decision:**
  - LAW-15 tiers, highest that works first: (1) feeds; (2) official APIs with first-class auth; (3) other first-class retrieval (search/aggregator feeds, public web); (4) browser fallback for user-sent URLs only, after an extraction-learning step.
  - §0.6 tracks one live validation per tier.
  - Prerequisites needed only by a later phase become named checkpoints (§0.5: CP-EMAIL before PH-06, CP-BROWSER before PH-07b). The build agent pauses there for that setup action and nothing else. This is the only change to the "no questions after kickoff" contract.
- **Affected:** Abstract items 1–2, §0.5, §0.6, LAW-15, Goal Prompt.

### DEC-069 — (SUPERSEDED by DEC-075) Gmail via the Gmail API with Google OAuth
- **Context:** The user's tier-2 rule says use the official API with first-class auth for email.
- **Decision:**
  - The user creates a free Google Cloud project with a Desktop OAuth client.
  - Loopback + PKCE sign-in with scopes `gmail.modify` and `gmail.send`; the refresh token is stored via safeStorage.
  - Reading uses `users.messages.list/get` (raw) with `historyId` for incremental sync; sending uses `users.messages.send`; test fixtures use `users.messages.insert` into `RW-Fixtures`.
- **Known limit:** While the project is in Google's "Testing" status, refresh tokens expire after 7 days. The app warns 2 days ahead and offers "Sign in again". Publishing the app to production for restricted Gmail scopes would require Google verification, which is out of scope.
- **Alternatives:** IMAP with an app password (no weekly re-sign-in, but not the official API and needs 2-Step Verification); the Chrome session bridge (tier 4, not allowed when tier 2 exists).
- **Affected:** §0 env/PRQ-EMAIL-01/CP-EMAIL, §1B.1, §1B.3, §1B.6, §1B.8.2, §1B.19, §1B.21, PH-06, §3 harness and tests.


## Review round 6 (2026-09-30) — blocking review after the pivot

### DEC-070 — (AMENDED by DEC-072: invalid offsets → pending capture, page text discarded) Tier-4 fallback extraction stores only verbatim page text
- **Context:** Letting Luna "extract the post" would have stored model-written text as a source fact.
- **Decision:** A new task, `LOCATE_POST`, returns only character offsets into the page's visible text. The stored text is the verified slice; if the offsets are invalid, the full visible text is stored as `partial`. Author and time from the model are metadata, never evidence.
- **Affected:** PH-07b, §1B.12.3.

### DEC-071 — Pivot hygiene fixes
- **Static audit:** scoped by integration. Codex strings may appear only in `ai/`, Chrome-cookie strings only in `sources/bridge.ts`, and `codex-auth.ts` may write `auth.json`.
- **Gmail cleanup:** uses `users.messages.trash` on exactly the ids the tests created (never delete, never by search).
- **Test token storage:** the test Gmail refresh token lives in `prereq/.env.local` and is installed per profile with `test.secrets.set`.
- **Codex token refresh:** a cross-process lock file around refresh; app suites run with `workers: 1`.
- **E2E-SEC-01:** now greps for the real current secrets (Codex, Google, bridge-decrypted values, JWT pattern).
- **E2E-BRIDGE-01:** a new test that exercises the bridge deterministically with a throwaway mock-keychain Chrome profile.
- **Fixture skeleton:** "structure-only" is defined and checked for the user's identity before writing.
- **Leftovers removed or retargeted:** `live-auth.json`, API-key wording, `RW_ANTHROPIC_API_KEY`, and Sifted-based live auth are gone. Tests use `RW_CODEX_HOME=<empty dir>` for "no AI configured".
- **Affected:** §0, §1A.8, §1B.12.1, §3, §3D.

### DEC-072 — Checkpoint and fallback consistency fixes (review round 7)
- **StrictlyVC fixture:** the frozen StrictlyVC `.eml` is produced only at CP-EMAIL. It is no longer a kickoff requirement.
- **Gmail renewal (new checkpoint CP-EMAIL-RENEW):** a Google re-sign-in whenever the Testing-mode Gmail token has fewer than 3 days left or fails. The Goal Prompt now also allows the §0.1 step 5 "regressed prerequisite" exception.
- **LOCATE_POST input and failure:** it receives only the page's main/article landmark text. If it fails, the item stays a pending capture and the signed-in page text is discarded, so the user's own account chrome never gets stored or sent to the model.
- **Live smoke:** it no longer runs the real-Chrome bridge, which would need a Keychain click. The real bridge is verified at CP-BROWSER; E2E-BRIDGE-01 covers the code path.
- **Stale text aligned:**
  - X/LinkedIn profile URLs → `unsupported`.
  - The P-SOURCE-017 wording.
  - The `email.account` description.
  - LAW-15 tier references.
  - Appendix C risks.
  - The env-var list.
  - The static audit is scoped to `app/src/**`.

### DEC-073 — Tier-4 pages leave no page HTML on disk; pending captures have a home
- **Decision:** For bridge/tier-4 fetches the raw artifact is only the extracted post text (`v<n>.raw.txt`); signed-in page HTML or visible text is never written. A user-sent URL waiting for sign-in or retry is stored as a document with `status='pending_capture'` (text may be empty), so nothing the user sent is lost (LAW-07).
- **Affected:** §1B.4.2 documents.status, §1B.8.9, §1B.9 step 1, E2E-SENT-01.

### DEC-074 — (SUPERSEDED by DEC-075) Prefer a "published" personal Google OAuth app so the Gmail sign-in is permanent
- **Context:** The user asked for permanent OAuth. With the consent screen in Testing status, refresh tokens expire after 7 days (DEC-069).
- **Decision:** At CP-EMAIL the user publishes their own consent screen to "In production" without submitting for verification. This is personal use by the developer's own account, and Google then shows an "unverified app" interstitial once. The refresh token should then not expire on a 7-day clock.
- **Verification:** CP-EMAIL-RENEW stays as the fallback. The harness records the token's issue date and checks it still refreshes after 8 days.
- **Uncertainty:** This rests on Google's published policy as I understand it (MEM-020, unverified). If Google blocks restricted Gmail scopes for an unverified production app, we fall back to Testing plus weekly renewal, or to IMAP with an app password (also permanent), and record that as a new DEC.
- **Affected:** PRQ-EMAIL-01, DEC-069.

### DEC-075 — Gmail via IMAP/SMTP with a Gmail app password (supersedes DEC-069/074)
- **Context:** The user wanted Gmail without a Google Cloud project, as a normal user.
- **Decision:** Use imapflow, nodemailer and mailparser against imap.gmail.com:993 and smtp.gmail.com:465 with a 16-character app password. It is permanent until revoked and needs no weekly renewal (CP-EMAIL-RENEW removed). Test cleanup moves only the UIDs it created to `[Gmail]/Trash`.
- **Verified 2026-09-30:** IMAP login, label `RW-Fixtures`, APPEND/SEARCH/move-by-UID, SMTP send round trip, and a real StrictlyVC issue (sender `connie@strictlyvc.com`) saved as `fixtures/email/strictlyvc-live.eml`.
- **Note:** The app-passwords page first showed "not available for your account" until the user's 2-Step Verification setup allowed it.
- **Affected:** §0 env/PRQ-EMAIL/CP-EMAIL, §1A.2, LAW-15, M11, §1B.1/1B.3/1B.6/1B.8.2/1B.19/1B.21, PH-06, harness.

### DEC-076 — The app never reads `prereq/.env.local`; every account has an in-app flow
- **Context:** The user wants `.env.local` used only by the build agent and test harness.
- **Decision:**
  - Gmail (Settings ▸ Accounts ▸ Gmail), ChatGPT (detected Codex sign-in) and Chrome sign-ins (Allow access) are connected only through their in-app flows.
  - The harness injects test credentials per profile with test-only commands.
  - The static audit fails if app code references `.env`, `dotenv` or `RW_EMAIL_`.
- **Affected:** §3D code audit, M11, §1B.21.

### DEC-077 — X checkpoint completed during setup
- **Verified 2026-09-30:** One user-style X post (`x.com/<handle>/status/<id>`) was read headless through the Chrome bridge (a Chrome profile), with author, 277 characters of text, time and permalink extracted.
- **Saved:** selectors in `app/resources/platforms/x.json`; a structure-only skeleton in `fixtures/social/x-skeleton.html`, checked to contain none of the user's identity.
- **Edge case:** an X "Article" or media post has no `tweetText`. LOCATE_POST or a pending capture must handle it.
- **Still open:** LinkedIn (optional) remains RED until the user signs in to LinkedIn in Chrome.

## Build (2026-09-30 onward) — decisions recorded by the build agent

### DEC-078 — PH-01 foundation choices: pinned versions, IPC payload shape, renderer port method
- **Date:** 2026-09-30 · **Status:** Accepted
- **Context:** DEC-001 asks for exact versions at kickoff; §1B.3 lists commands with positional arguments; the prototype is a dc-template + logic class; the RFC body for the model call includes `max_output_tokens`.
- **Decision:**
  - Pinned: Electron 44.5.1, electron-vite 5.0.0 with Vite 7.3.6 and @vitejs/plugin-react 5.2.0 (plugin 6 needs Vite 8, which electron-vite 5 does not support), React 18.3.1, TypeScript 5.9.3, better-sqlite3 13.0.3 (N-API prebuilds load in Electron without a rebuild), zod 4.6.5, Playwright 1.63.0.
  - JSON Schema for model output comes from zod 4's built-in `z.toJSONSchema` plus a small strict-mode converter (every property required, optional → nullable, unsupported keywords dropped); `zod-to-json-schema` is not added (one dependency fewer).
  - IPC payloads are named objects (`source.update {id, patch}` instead of `(id, patch)`); the command names are exactly §1B.3. Added: `report.list` (the Reports screen needs the list), `note.retry` (the "Not organized yet · Retry" state needs a command), and the renderer-only event `app.deeplink`.
  - `max_output_tokens` is **not** sent: the Codex backend returns HTTP 400 "Unsupported parameter: max_output_tokens" (verified live 2026-09-30). Output size is bounded by the task schemas.
  - The renderer is a one-time mechanical conversion of the prototype template to TSX (`app/scripts/convert-prototype.mjs` → `view/Template.tsx`, hover styles → classes) plus a port of the prototype's `Component` logic (`Controller.tsx`, `vm/*`) with `data.js` replaced by IPC data. RFC additions live in `view/Additions.tsx`.
- **Alternatives:** Hand-writing JSX screens (drift risk against VIS-01); shipping the dc-runtime (needs Babel + `unsafe-eval`, which the CSP forbids).
- **Consequences:** Visual parity is structural; the template is now hand-maintained.
- **Affected:** §1B.1, §1B.3, §1B.12.1.

### DEC-079 — Sidebar glass is painted by the page, not native vibrancy
- **Date:** 2026-09-30 · **Status:** Accepted
- **Context:** DEC-032 asked for `vibrancy: 'sidebar'`. With a transparent page over native vibrancy, the sidebar's look depended on window focus and on how screenshots composite transparency (light grey in Playwright captures), which makes VIS-01 and blind UX screenshots non-deterministic.
- **Decision:** The window has an opaque base color (#16171c dark, #e9eaef light) and the sidebar keeps the prototype's own translucent `sideBg` + `backdrop-filter`, driven by the Glass setting. Native traffic lights (hidden-inset) stay.
- **Alternatives:** Native vibrancy (non-deterministic captures).
- **Consequences:** The desktop no longer shows through the sidebar; the Glass slider still changes sidebar/sheet translucency over the base color.
- **Affected:** §1A.6 window chrome (DEC-032).

### DEC-080 — PRQ-EMAIL-02 reopened: the saved StrictlyVC message was a subscription confirmation
- **Date:** 2026-09-30 · **Status:** Accepted
- **Context:** SMK-06 extracted 0 evidence from `fixtures/email/strictlyvc-live.eml`. Its subject is "Confirm your StrictlyVC subscription": the setup probe saved the newest message from the sender, which was the double-opt-in mail, not an issue. A mechanical IMAP re-check on 2026-09-30 found no other StrictlyVC message.
- **Decision:** The probe now ignores confirmation/verify/welcome/subscription mails when looking for an issue. PRQ-EMAIL-02 is RED again and checkpoint CP-EMAIL is reopened (§0.1 step 5). PH-06's StrictlyVC assertion waits for a real issue; every other phase continues.
- **Consequences:** The human must confirm the StrictlyVC subscription (link in that email) and wait for one issue; then `node prereq/email-probe.mjs` re-saves the fixture and the PH-06 gate is re-run.
- **Affected:** §0.2 PRQ-EMAIL-02, §0.6, PH-06.

### DEC-081 — Test-only IPC hooks beyond the §1B.3 list
- **Date:** 2026-10-01 · **Status:** Accepted
- **Context:** E2E-GRD-01/GRD-03 must check facts with the app's own `groundingCheck`, and E2E-AL-03 needs "cooldown 0" — no product surface sets a rule's cooldown (the 6 h default is fixed by §1B.18).
- **Decision:** Add `test.groundingCheck({text, supports})` and `test.alerts.setCooldown({id, minutes})`, gated like every `test.*` command (RW_TEST_MODE only; production returns Unknown command).
- **Alternatives:** Re-implement grounding in the harness (would test a copy, not the app); a user-facing cooldown setting (scope creep, not in the prototype).
- **Consequences:** No product behavior change. **Affected:** §1B.3 test commands, §3A E2E-GRD-01/03, E2E-AL-03.

### DEC-082 — Raw email artifacts are stored with per-recipient tokens removed; SEC-01 greps the Gmail app password
- **Date:** 2026-10-01 · **Status:** Accepted
- **Context:** E2E-SEC-01 found JWT-shaped strings in stored `.eml` files: newsletter `List-Unsubscribe` headers carry the subscriber's unsubscribe token (a credential for the user's subscription). Gmail is connected with an app password (DEC-075), so there are no Google OAuth tokens to grep for.
- **Decision:** `content/<doc>/v<N>.raw.eml` is the fetched message with `eyJ…` tokens replaced by "[token removed]"; the committed live fixture was scrubbed the same way. SEC-01 greps for the Gmail app password instead of Google OAuth tokens.
- **Alternatives:** Keep raw mail verbatim and exempt `.eml` from SEC-01 (stores a credential on disk).
- **Consequences:** Raw email is byte-exact except for those tokens; extracted text is unaffected. **Affected:** §1B.5 raw artifacts, §3A E2E-SEC-01.

### DEC-083 — Live smoke stops each source after its first processed document
- **Date:** 2026-10-01 · **Status:** Accepted
- **Context:** §3E step 9 subscribes every starter source in a clean profile and needs ≥1 processed document each. Processing every item of 38 live feeds would spend a large share of the shared ChatGPT allowance (PRQ-AI-02).
- **Decision:** One clean profile per source; the app is closed as soon as one document from that source is processed (or screened out by triage). Outcomes are appended to `tests/results/<run>/live-smoke.jsonl`. The harness also aborts any suite when plan usage exceeds 80% (§3.0).
- **Consequences:** Same pass criterion, bounded cost. **Affected:** §3E step 9.

### DEC-084 — Blind UX setup details
- **Date:** 2026-10-01 · **Status:** Accepted
- **Context:** BK-SETUP signs in to the Ledger, which would make UX-08 ("add the Ledger and get its article") trivially true; blind agents can only run `ui`, so they can't open a "goal file".
- **Decision:** UX-08 starts from BK-SETUP without the Ledger source; its password is given inline in the goal text (and written to goal.txt). Other UX goals start from BK-SETUP plus an in-app X sign-in (UX-11). Blind agents run with `--setting-sources project` so no user-level Claude settings or memory leak into them.
- **Consequences:** Goals stay verbatim apart from the harness-only pre-state notes. **Affected:** §3C.2 UX-08, UX-11.

### DEC-085 — A new source starts "from today"; older posts load on request (user-directed)
- **Date:** 2026-10-01 · **Status:** Accepted (requested by the user)
- **Context:** The first sync took up to 30 of a source's latest items regardless of age, so a new feed filled Today with weeks-old posts and spent model allowance on them. The user asked that the app start loading data from the day it is set up, with a per-source option to load more history.
- **Decision:** A source's initial sync ingests items published in the last 24 hours, topped up with its newest items to at least 5 so a new source never looks empty (undated listing pages stop at the first post older than the window once 5 are in). Each source row has **Load older posts ▾** (Last 7 / 30 / 90 days): one `FETCH_SOURCE {trigger:'backfill', days}` that ingests everything the source still lists within that window (≤100 items), deduped by the normal pipeline; a toast reports how many were added. Scheduled syncs are unchanged (new items only); source reset keeps re-ingesting what was captured before.
- **Alternatives:** Keep the 30-latest rule (old items flood Today); a global history setting (less control per source).
- **Consequences:** New IPC `source.backfill`; backfill reaches only what the source still publishes (feeds rarely list more than 20–50 items). Tests: E2E-SRC-06, UI-SRC-05; fixture `archive.test` (12 posts, one every 3 days).
- **Affected:** §1A FLOW-A, §1B.8 source lifecycle (Create, new Backfill row), §1B.3 IPC, §3A, §3B, Appendix A.

### DEC-086 — The live-StrictlyVC assertion of SMK-06 is non-blocking until a real issue exists (user-authorized)
- **Date:** 2026-10-01 · **Status:** Accepted (the user allowed skipping RFC checks that block progress without serving a purpose)
- **Context:** CP-EMAIL needs a real StrictlyVC issue in the mailbox; the subscription is confirmed but no issue has arrived, which blocked the final acceptance run on an external newsletter schedule.
- **Decision:** SMK-06 keeps every Gmail ingress assertion over the user's real mailbox (Deal Memo `.eml` appended via IMAP → one document with the Claimwise/$9M/Harbor Point evidence; re-append → no new document). The "frozen live StrictlyVC `.eml` → ≥3 evidence" step moves to the non-blocking live smoke (`tests/live/strictlyvc.spec.ts`), which skips with a recorded reason while the saved message is only the subscription confirmation; `node prereq/email-probe.mjs` replaces the fixture once an issue arrives. PRQ-EMAIL-02 stays a checkpoint item (non-blocking for the gate).
- **Alternatives:** Keep waiting (no product value gained by waiting); fake an issue (forbidden).
- **Consequences:** Real-newsletter extraction quality is verified as soon as an issue arrives, without blocking delivery. **Affected:** §0.2 PRQ-EMAIL-02, §0.5 CP-EMAIL, PH-06 SMK-06, §3E step 9.

### DEC-087 — Live real-source verification is the primary acceptance gate; fixture suites become regression checks (user-directed)
- **Date:** 2026-10-01 · **Status:** Accepted (user: "the whole purpose of this app is aggregating real data"; "if the RFC has been leading you down a bunch of mock data tests … those are not important"; "most of the work should be real tests"; "you can adjust rfc as needed")
- **Context:** §3E gated on a deterministic fixture corpus and ran real sources only as a non-blocking live smoke (residual risk 1). Running the real pipeline once found bugs no fixture could show: undated web listings (a16z, paulgraham.com) and Google News searches ignored the first-sync window (30 items each instead of ≤ today + 5); every a16z podcast page extracted to the same legal disclaimer (16 false "duplicates"); paulgraham.com's source was named "Essays".
- **Decision:** A new blocking **real-data stage** (`tests/realdata/`, Playwright project `realdata`, real network, real model, real Gmail, fake clock started at the real time so schedules can be driven) carries the gate: RD-SRC (every automatic source type on real sites — first sync window, Sync now idempotency, Read once, Load older posts, the daily scheduled sync, the processing pipeline to terminal states with verbatim quotes and no repeated page text, restart), RD-HYD (user-added companies Seed→Series E and firms hydrated from real coverage, incl. small ones the user named), RD-BRIEF (custom reports, briefings by email, alerts and notifications, adversarial prompts) and an adversarial real-user review. A site being down is recorded as external, not an app failure; content assertions check structure, grounding and consistency, or compare with facts an independent judge read from the same real articles. Fixture smoke/E2E/blind suites stay as regression checks: they run, failures are fixed, but a model-variance flake there does not block delivery.
- **Fixes landed with it:** undated items fill only the floor of the window (`adapters.ts inWindow`, web listing loop); search adapter applies the window; disclaimer blocks stripped before Readability (`parse-html.ts stripDisclaimers`); generic section titles get the site prefix (`probe.ts sourceName`).
- **Consequences:** Gate runs take hours (real processing ≈ 30 s/document with 2 AI lanes) and draw on the ChatGPT plan; the usage guard still applies. **Affected:** §3 intro, §3E steps and thresholds, §4 VerificationReport contents, residual risk (1).

### DEC-088 — Hydrate a company or firm the user adds (user-directed)
- **Date:** 2026-10-01 · **Status:** Accepted (user: "adding a random one should allow us to find it and hydrate it from the users sources"; "sources also include stuff like google searching")
- **Context:** `object.create` made an empty page; "Check for updates" only re-synced sources that already covered the entity, so a small startup or fund the user typed in (e.g. Titanium Ventures, a two-person lab typed as "acme labs / Acme") stayed empty forever unless a subscribed source happened to mention it. It also always created a new row, duplicating entities extraction had already created.
- **Decision:** `object.create` parses "A / B" and "A (B)" as name + aliases, reuses an existing entity (exact, alias, domain, or Jaro-Winkler ≥ 0.96) instead of duplicating, follows it, and enqueues `HYDRATE_OBJECT` — an agent pipeline, retrieval only (DEC-047 still holds: nothing from model memory): (1) the user's library — FTS over every document incl. ones a relevance filter dropped; unlinked mentions are re-read with the entity followed; (2) web discovery — a Google News search over all time for the names (+ Lab/Labs variants); new AI task `SELECT_COVERAGE` picks the results really about this entity (homonyms out; former/product names in, only if they appear verbatim in results) → fetched → normal pipeline (skip triage); (3) its own site — a domain its coverage links to whose label matches the name, confirmed by fetching the home page title; its blog/newsroom is subscribed if the probe finds a listing; (4) a daily news watch source `News: <name>` (custom instruction "only articles about <name>"). Followed entities' aliases are passed to extraction. "Check for updates" on an entity no source covers runs hydration instead of offering only "add its website".
- **Consequences:** New job type (fetch lane), task `SELECT_COVERAGE`, sources with origin `system` (removable like any source). Test env `RW_REAL_SEARCH=1` lets test mode use the real Google News endpoint. **Affected:** §1B.10 jobs, §1B.12 AI tasks, §1B entities (P-OBJECT-004), §1B.8 sources, §3 RD-HYD.

### DEC-089 — Split an entity through a chat correction (user-directed)
- **Date:** 2026-10-01 · **Status:** Accepted (user: "we should enable the user to correct merge split companies firms thesis via chat as well")
- **Context:** Chat corrections (`correct.parse` → `CORRECT_OBJECT` → confirm → `correct.apply`) already set fields, reject links, merge entities, merge and move theses. Splitting was missing, so a homonym or a wrong merge (two funds sharing a name, a product mistaken for the company) could only be fixed by deleting.
- **Decision:** New action `split_entity {objectId, value=<other name>}`. `splitEntity` creates (or reuses) the other entity and moves its alias; documents linked to the original that name only the other entity move with their document links, evidence subjects, relationships supported only by that evidence, and field values (current values re-resolved on both); documents naming both are re-read (generation bump, skip triage) so extraction decides with both entities known. Audited in `history` (`split`). Prompt version `correct-3`.
- **Consequences:** Undo is a merge (also available in chat). **Affected:** §1B.12.3 CORRECT_OBJECT, FLOW-I, P-OBJECT-006, RD-HYD-05.

### DEC-090 — Report and alert requests that can't be built faithfully are answered, not approximated; empty runs aren't emailed
- **Date:** 2026-10-01 · **Status:** Accepted (user-directed real-data testing: "answer honestly… never invent rows… never send an empty email")
- **Context:** RD-BR (tests/realdata/briefs.spec.ts) found that CREATE_REPORT/CREATE_ALERT had no way to decline: gibberish became a generic "Top signals" report and an alert on *every* new fact; "text me…" was routed to an alert; a brief on a company/firm not in the catalog, or on a topic no thesis covers ("quantum computing startups"), silently dropped the name and listed unrelated rows under that title; "a16z leads a round" without the firm compiled to "any round led by anyone". Report catalogs were also capped at the first 100 firms / 150 companies by insertion order, so a named entity could be missing from the list. Runs with no rows were still emailed ("Nothing new." in every section).
- **Decision:** CREATE_REPORT gains `route:'clarify'` + `clarification` (prompt `create-report-3`); CREATE_ALERT gains `clarification` (prompt `create-alert-3`) and a validator that rejects rules with no constraint at all or `investorRole` without `investorFirms`. A clarification marks the report/alert `failed` with `last_error` = the model's explanation (text kept; UI already shows "Couldn't set this up. <reason>" + Edit text); an edited active alert keeps its previous rule. Entity catalogs (`reports/catalog.ts`) list entities named in the request (name, name without firm suffix, alias) first, then followed, then recently updated (firms 200, companies 200–250, people 150). Blank/whitespace prompts → `VALIDATION`. A run whose sections are all empty is stored but not emailed (`delivery_error` "Nothing new · no email sent"). Evidence/thesis sections show one row per deal (company + round), preferring the funding fact over per-investor investment facts.
- **Consequences:** E2E-REP-02 reads one fixture article first so its Daily Brief has content. Retry on a clarified request re-asks the same text; Edit text is the path. **Affected:** FLOW-G/H, §1B.12.3 CREATE_REPORT/CREATE_ALERT, §1B.17 run, §1B.19 email, E2E-REP-02, RD-BR.

### DEC-091 — Email is built from reports: briefings (user-directed)
- **Date:** 2026-10-01 · **Status:** Accepted (user: "we should also really be able to create reports and one report or multiple reports can be tagged as briefings that get emailed"; "the email should be based on reports")
- **Context:** Each report could email itself (`delivery.email`), so a user with three reports got three emails at three times, and there was no way to compose one morning email from several reports.
- **Decision:** New first-class **briefing** = name + ordered report ids + schedule (none/daily/weekdays/weekly at a time). `RUN_BRIEFING` runs each tagged report (normal in-app runs, `noEmail`) and sends **one** email with a part per report (report name as heading, its sections and rows with source links), via `SEND_EMAIL {kind:'briefing'}`; nothing new in any part → no email, recorded on the run. Briefings have their own schedule kind (`schedules.kind` gains `briefing`, migration 0002 rebuilds the table to extend the CHECK) and history (`briefing_runs`). IPC `briefing.list/create/update/setReport/delete/sendNow/runs`. A report keeps its own `delivery.email` for the single-report case; the Reports screen tags reports into briefings.
- **Alternatives:** Keep per-report emails only (the user's complaint); a digest of all reports (no control over which).
- **Consequences:** Schema version 2 (SMK-01 updated). **Affected:** §1B.4 schema, §1B.11 scheduler, §1B.17 reports, §1B.19 delivery, §1B.3 IPC, FLOW-G, RD-BRF tests.

### DEC-092 — Extraction guards: which names become entities, grounded roles and stages, one row per claim
- **Date:** 2026-10-01 · **Status:** Accepted (user-directed fix of the adversarial real-data review: junk entities, dual-typed names, reporters as founders, stage contradicting its quote, off-topic thesis Supports, identical evidence rows)
- **Context:** After 85 real documents the library had 291 companies / 81 firms incl. publishers (TechCrunch, CNBC), institutions (FTC, DoD, Harvard, NASA), countries (Poland), placeholders ("startups", "unknown", "undisclosed angels"); ~20 names were both a company and a firm (investors listed under companies in one article, under firms in another; every investor name created a firm); byline reporters became people "working at" the company (people fallback picked the byline sentence); Mercury stage "Acquired" cited a bank-charter quote; neutral thesis links (FTC probe, "AI risks overblown") were shown as Supports; a round's funding item and each investor's investment item repeated the same claim+quote (up to 10 rows).
- **Decision:** EXTRACT prompt `extract-7` (company/firm definitions, exclusions, aliases only from the text, people only when the text ties them; stage must be stated) and firms get `aliases`. Deterministic guards (`ingest/entity-guards.ts`), after `orgSubjects`: (0) a new company/firm name must be used by the document (title or text; a model-expanded name is replaced by a listed alias the text uses — "AWS", not "Amazon Web Services" — else not created), and model aliases the text doesn't use are dropped; (1) in-document aliases fold into one mention (model aliases + "Name (ABBR)" in the text); (2) one type per name: library-known type wins (former `retypeKnown`, incl. aliases), else an investor role in this document (lead/participant, investment/fund_raise firm) → firm unless the document also treats it as an operating business (a corporation investing stays a company); (3) never an entity: placeholders (incl. rankings like "Fortune 500"); the document's own publisher (site name / domain label / same-site source name) unless the document is its own blog or the publisher is the subject of a business event; government/agency/country/university names as companies; firms with no investor role, no venture-style name and no text describing them as an investor (a business-acting "firm" becomes a company); media-named outlets ("…Times", "…Newsletter") unless the subject of a business event; (4) dropped names are removed from payloads, people orgs and fields; a fact whose subject was dropped is re-subjected to a kept company its quote names, else dropped. People: the byline author is kept only with a sentence naming them with their org and role (or on that org's own blog); others need a fact quote or a sentence with their org/role; `founded` only when the support quote says found*; byline/credit/URL/bare-name quotes are never evidence. Stage values must be stated by their quote (stage words or listed synonyms); a funding `round` the quote doesn't state is removed from the fact (the fact stays). Evidence: an identical (claim, quote span) in one document is one row shared by its subjects (`about` links to each); the same subject+claim+quote (any kind) already active from another document (found through the subject's `about` links) is not inserted — this document links to it (`supportIds`). A grounded abbreviation alias naming another existing entity opens an `entity_merge` suggestion. INTERPRET `interpret-3`: stance support|contra only (neutral removed), topic-only links omitted; neutral links are never persisted.
- **Alternatives:** Hard-coded media/university lists (model-memory-like, unbounded); auto-merging abbreviation duplicates (merges are irreversible and user-confirmed, §1B.13.4); corporate investors as firms (splits a corporation across two lists).
- **Consequences:** A corporation that invests is a company and does not appear in a company's "investors" (its name stays in the funding payload). A document that only repeats another's claim shares that row; if the first document is re-processed the shared support is superseded with it. Quote offsets are UTF-16 code units (JS string indices), see MEM-038. **Affected:** §1B.12.3 EXTRACT/INTERPRET, §1B.13.1, §1B.9 steps 10–12, RD-EXT (tests/realdata/extraction.spec.ts).

### DEC-093 — Story reports: article pictures, a grounded narrative, deterministic charts, chosen layouts, one renderer for app and email (user-directed)
- **Date:** 2026-10-01 · **Status:** Accepted (user: "the reports should be much more elegant looking have the ability to have visuals from articles and stuff as well not just a list of bullets more tell me a clear story in my template based on template and show visuals")
- **Context:** A run was sections of quote bullets ("text — source, date (source)") in the app, the email and briefings; the app view and the email were two different renderings; nothing from the articles' own pictures was kept; the adversarial review found "as a table" requests silently ignored by CREATE_REPORT/REFINE_REPORT.
- **Decision:**
  1. **Lead images.** Each web document's lead image — `og:image`, else `twitter:image`, else the first large `<img>` inside `<article>` — is captured at parse/ingest time as an absolute **https** URL (no SVG, no `data:`; never downloaded) into `documents.metadata_json.image` (no migration: `metadata_json` already exists). `ingest/lead-image.ts` is regex-based so it runs in the parser (`ParseResult.image`) and in `ingestItem` for every adapter's raw HTML; documents ingested earlier are filled lazily from their stored raw HTML the first time a report shows them (`docImage`, the answer — URL or null — is saved). Report rows carry `title`, `image`, `kind`, `deal {company, round, amountUsd, amountText, leads}` and `stance`; a deal amount is kept only when its quote states it (`numbers()` of the quote).
  2. **Layouts.** `ReportDefinition.style?: 'story'|'digest'|'table'` and per-section `style?` override. *story*: a run-level lede "The story" (3–5 sentences connecting the sections) and a 1–3 sentence paragraph per section, written by new task **COMPOSE_STORY** (`compose-story-1`, strict JSON: sentences with row citations) from the run's rows only; each sentence must pass `groundingCheck` against the quote, claim text and article title of the rows it cites (allowed names: report and section titles) or it is dropped (count in `content.groundingDropped`); a model failure leaves the run without prose, never fails it. Then a **hero card** (largest grounded round in a deal section, else the query's first row; a pictured row wins among the top three): lead image capped at 300 px, headline = article title, source · date, claim, short quote; a **grid of up to 4 compact cards** (thumbnail, headline, one-line claim, source · date); the rest as an **Also** list. Rows without a picture get a monogram tile (source initial on a prototype-palette tile), never a broken image. **Charts are computed from the rows, no model:** "Capital raised" horizontal bars (company → largest grounded amount, ≥2 companies), a round-mix chip row, and a "For vs against" bar for thesis rows. *digest*: cards only (plus COMPOSE_REPORT_SECTION bullets when `presentation:'summary'`). *table*: deal table Company | Round | Amount | Lead investors | Source (other rows below as a list; non-deal sections Item | Source).
  3. **Choosing the layout.** CREATE_REPORT (`create-report-4`) / REFINE_REPORT (`refine-report-2`) return `style` (+ section `style|null`); default story. A deterministic pass after the model (`enforceLayout`) applies explicit layout words the definition lacks ("table/tabular/spreadsheet" → table, "digest/just the headlines/no commentary" → digest, "story/narrative/visuals/pictures/charts" → story, negated mentions remove that layout) and, for a refinement saying "shorter" that didn't shrink the report, lowers every section's limit to 60%.
  4. **Backward compatibility:** a definition without `style` renders as **digest** (its rows as cards, no new model calls for reports the user already scheduled); the four built-in templates are `story` and existing template rows without a style are upgraded to story once at startup. Old runs (no row numbers/images) render through the same renderer as digest cards.
  5. **One renderer.** `reports/render.ts` turns the stored run content into email-safe HTML — inline styles only, table layout, no `<style>`, SVG or script; charts are div/table widths; masthead (kicker, report name in serif, date), quiet footer "Built on this Mac from your sources… Pictures come from the original articles", max-width 640 px, hybrid inline-block cards that become one column on phones — and into Markdown (lede and paragraphs with [n] citations, rows numbered, images as links, deal table). The app shows the same HTML (embed variant: no outer tint) from `ReportRunDTO.view` in a sandboxed `iframe srcdoc` (`allow-same-origin allow-popups allow-popups-to-escape-sandbox`, no scripts); links are `target=_blank` and leave through the main window's open handler to the system browser; images use `referrerpolicy=no-referrer` + `<meta name=referrer content=no-referrer>`. The renderer CSP gains `img-src https:`. Briefings compose each report's block under a briefing masthead with the same renderer.
- **Alternatives:** Downloading/embedding images (privacy-neutral but heavy mail, storage, Gmail clipping at ~102 KB); a chart library or SVG (stripped by Gmail); model-written charts or hero picks (ungrounded numbers); a validator that fails compilation when the layout is missing (a layout miss would cost the whole report) — replaced by the deterministic layout pass.
- **Consequences:** Loading article pictures reveals the viewer's IP to the publishers' image hosts when a report is opened (as any newsletter does); Gmail proxies them. Story runs make one extra model call per run. Large briefings can approach Gmail's clipping size (a 4-section story ≈ 50 KB HTML). The in-app preview no longer opens rows in the app's reader — rows link to the article. **Affected:** §1B.9 ingest (lead image), §1B.12.3 tasks (CREATE/REFINE_REPORT, COMPOSE_STORY), §1B.17, §1B.19, FLOW-G, renderer CSP, RD-STORY (`tests/realdata/story-reports.spec.ts`), UI-REP-01 (section title read from the frame).

### DEC-094 — One ontology-operations layer: a registry of ops, one dispatch path, undo, invariants (user-directed)
- **Date:** 2026-10-01 · **Status:** Accepted (user: "make sure for the modification of the ontology objects merge split add new etc all of that works and the backend is clearly structured for these such that it is easily extensible")
- **Context:** Mutations of companies/firms/people/theses were scattered: create in `objects/pages.ts`, merge/split/retype in `entities/corrections.ts` mixed with NL parsing and suggestion resolution, thesis merge there too while create/move/archive lived in `theses/index.ts`, links and fields in their own modules. Each op re-implemented the same plumbing (relationship ends, aliases, field values + current, notes, evidence payload ids, history, events, name cache, feed refresh) — merge had a duplicate-aware repoint; split and retype hand-rolled loops (retype used `UPDATE OR IGNORE`, which left a conflicting relationship pointing at the retired row, and moved a `current` field value onto an existing entity's `current` → unique-index failure; its payload rewrite left `companyId` holding a firm id). Split/retype were chat-only (a `switch` in `applyCorrection`); rename and delete/restore didn't exist; nothing but merge had a reversible audit.
- **Decision:** `app/src/main/entities/ops/`: **primitives** (`moveEnds` duplicate-folding/self-loop-dropping, `moveAliases`, `moveFieldValues` + `resolveCurrent` with the merge user-value rule, `moveNotes`, `rewriteEvidencePayloadIds`, typed `retypeEvidencePayloads` + `restorePayloads`, `retargetSuggestions`, `replaceInList`, `audit`, `ChangeSet`/`afterChange`) and a **registry** of ops `{name, input zod, validate → problems, apply (one transaction, writes history), describe → confirm text, undo?: {historyAction → inverse op | reason}, chat?: {action, one prompt line, slots → input}}`: `entity.create` (former `createObject`, DEC-088), `entity.rename`, `entity.merge`, `entity.split` (DEC-089), `entity.changeType`, `entity.delete`, `entity.restore`, `field.set/revert`, `link.reject/attach`, `thesis.create/update/move/archive/merge`. **One dispatch path** `runOp`: IPC `ontology.apply {op, input}`; the older commands (`object.create`, `merge.*`, `field.set/revert`, `link.reject/attach/rejectEntity`, `thesis.create/update/move/archive`) are aliases returning their old shapes; chat: CORRECT_OBJECT's action list and output enum are generated from the registry's chat entries (prompt `correct-5`), the registry maps slots → `{op, input}` (misfits go back to the model), `correct.parse` runs the op's `validate` up front and uses its `describe()` as confirmText (deterministic — the confirm row says exactly what will be applied); `correct.apply` = `runOp`. **Undo:** `ontology.undo {historyIds}` finds the op owning each history action and runs its inverse through `runOp` (rename ↔ rename back, delete ↔ restore, changeType → back onto the original row with payloads restored exactly, split → merge the created entity back, field.set ↔ previous user value/revert, thesis update/move/(un)archive); every undo writes an `undo` row (`undoOf`, no double undo); undo is refused with the reason when the object changed since. Merges stay irreversible (RFC §1B.13.4) and audited. **Delete** is soft: `deleted_at`; relationships (+ supports), aliases, note anchors and pin are removed and snapshotted in the history row; evidence and documents stay (they record what sources said; payload ids may name the deleted entity and readers already skip deleted ones); the news watch / site sources hydration created only for it are paused (a deleted company shouldn't keep being searched for); restore replays the snapshot (ends merged since follow the merge, gone ends are skipped), resumes those sources, and is refused when a live same-named entity exists. **Invariants** (`checkInvariants`, test IPC `test.ontology.invariants`): relationship ends live; aliases' owners live; one live entity per (type, normalized name); ≤ 1 current value per (object, key), none on merged objects; note anchors live; evidence payload ids exist, typed right and not merged (soft-deleted allowed, counted); feed items → existing documents and live primary theses; thesis parents and pins live. Renderer: the chat correction toast gets **Undo** when `correct.apply` returns `undo`; the palette's "Correct:" row also triggers on rename/split/delete/restore/move/archive/"is a firm"/"X's stage is …".
- **Alternatives:** (a) Keep per-module functions and add the missing ones — the plumbing would stay duplicated and the retype bugs show where that leads. (b) Event-sourced ontology (replay a change log) — a migration of every reader for no user-visible gain. (c) Hard delete — loses the user's decisions and makes Undo impossible. (d) Delete that scrubs entity ids from evidence payloads — loses what the article said and makes restore fragile; readers already filter deleted entities. (e) Model's own confirmText — can describe something other than what will be applied.
- **Reason:** One place defines what moves with an object, so every op (and the next one) gets duplicate folding, field precedence, payload typing, events and feed refresh right by construction; one path means chat, sheets and suggestions can't drift; history rows carrying their inverse make Undo generic.
- **Consequences:** Adding an op = one registry entry (+ one chat line); documented at the top of `entities/ops/index.ts`. `pages.createObject` removed (now `entity.create`). `field.reverted` history records the prior origin. Not reversible: merges, link rejections/attachments, thesis create. A split onto an already-existing entity, and a retype folded into an existing one, are refused by Undo with a reason. Retype undo doesn't re-pin a company. View definitions and report/alert definitions that name a merged/deleted entity id are not rewritten (readers follow merges). Real-data suite RD-ONT (`tests/realdata/ontology.spec.ts`). **Affected:** FLOW-I, §1B.3 IPC, §1B.12.3 CORRECT_OBJECT, §1B.13.4, new §1B.13.5, P-CORRECT-005, §3E RD-ONT.

### DEC-095 — Acceptance runs in two parallel lanes (user-directed)
- **Date:** 2026-10-02 · **Status:** Accepted (user: "Can we not parallelize and speed this up by alot")
- **Context:** One serial §3E run took 4–5 h (the real-data stage alone ~2.5 h), so each fix waited half a day for its verdict.
- **Decision:** `tests/acceptance.mjs` runs two lanes at once after step 1: the real-data stage (9b) on 4 Playwright workers (`RW_WORKERS=4`, each worker its own app, data dir and fixture server on `RW_FIXTURE_PORT_BASE + index`), and a serial lane on :4700 with steps 4–9 (smoke → backend → product → blind → live), then the coverage matrix. Electron's binary is installed once before the lanes. The app reads `RW_FIXTURE_PORT` (test mode only) to map `*.test` to the worker's server.
- **Alternatives:** (a) Parallel fixture suites too — the port remap leaks through relative redirects (MEM-051) and macOS has no 127.0.0.2+ without sudo; rejected. (b) Sharding across machines — no second machine; rejected.
- **Reason:** Real-data suites need no fixture content, so they parallelize safely; the run drops to ~2 h, bounded by the serial lane.
- **Consequences:** Suites that scan the temp folder see the other lane's live data dirs (SEC-01 skips files that vanish mid-scan). Electron must be installed before the lanes (MEM-050). Flake policy and thresholds unchanged.
- **Affected sections:** §1B.2 env vars, §3E step 9b.

### DEC-096 — Three tiers decide what syncs and what matters; Today in three sections; aliases only when the text says so (user-directed)
- **Date:** 2026-10-05 · **Status:** Accepted (user: "three tier 1) just an object extracted 2) a direct child of a firm, or company of a founder etc 3) followed — these should basically auto sync and affect their importance"; "Headlines … just true headlines or important stuff"; "remove them if they are orphaned")
- **Context:** Following only re-ranked Today; active lookup ran only when an entity was added by name, so a followed auto-discovered company never got its history. Today put 50 sources' worth of items in the same full cards. Hydration stored AMD, NVIDIA, NVDA, H100s… as Makora's aliases, so NVIDIA news became "about Makora" (MEM-060).
- **Decision:** (1) **Tiers** (objects/tiers.ts): followed → full hydration on follow; connected (one step via invested_in / partner_at / founded / works_at) → a daily "News: <name>" watch, ≤25 per followed entity, most active first, **forward-only** (its first sync takes nothing; only later news comes in — following three companies otherwise meant reading hundreds of their neighbours' recent articles); the sync also runs when reading creates such a link next to something followed; extracted → passive, plus **Pull latest** (HYDRATE_OBJECT `once`: one lookup into the "Added by you" source, nothing subscribed, not followed). Sources record what they cover as `source —covers→ entity` with a role (own_site, news_watch, connected_watch); `sync_tiers` (after follow/unfollow and daily) creates watches and removes system sources nothing followed or connected needs; user-added sources are never removed. People are hydrated by name (no site). The tier lifts Today's score (followBonus 1 / 0.5) and report ordering (+0.2 / +0.1). (2) **Today** = Following · Your theses (per thesis) · Headlines (headline-only rows; alert matches first, then links the user sent that fit no other section, then real headlines: a novel deal fact ≥0.7 importance or anything ≥0.9). Below-the-bar items are in All, not Today; counts follow. Existing feed items are re-grouped once (`feed_regroup`). The existing `group_key` values are reused (companies = Following, important = Headlines) to avoid a table rebuild. (3) **Aliases** (entities/aliases.ts): a source may add an alias only if it is shaped like the same name or the text states it; `entity.repairAliases` + `ontology.aliasAudit` take back what earlier unstated aliases attached (links and evidence rejected, fields rejected, articles re-read), undoable.
- **Alternatives:** (a) Two tiers (followed / not) — loses the portfolio-and-founders middle the user asked for. (b) Hydrate every connected entity fully — hundreds of lookups per followed firm, ChatGPT usage. (c) A fixed number of headlines — the user rejected a count. (d) New group keys — needs a feed_items rebuild for no user-visible gain. (e) Only the "stated in text" alias rule — real library audit showed it would strip a16z, BVP, NEA and full personal names; the name-shape rule keeps those.
- **Consequences:** Following a firm creates up to 25 daily news searches (cheap to fetch; new matches cost model calls). Today shows fewer items; the rest are one tab away in All. People have no page, so their Pull latest sits on the People list row. Product tests that assumed every item is in Today now read All.
- **Affected sections:** §1A.7 (M21), §1B.14.3, P-FEED-001, P-FEED-010, P-OBJECT-007, P-OBJECT-008, §3D matrix.

### DEC-097 — Test runs are headless (user-directed)
- **Date:** 2026-10-05 · **Status:** Accepted (user: "all of this is live appearing on my desktop can we do it all headless")
- **Context:** Every test launch opened a visible app window and Dock icon, often several at once with parallel workers, taking over the user's screen for hours.
- **Decision:** Test-mode switch `RW_HEADLESS=1`: the main window is never shown (`show: false`, background throttling off so hidden windows keep painting and running timers), sign-in windows are created hidden, `showMainWindow` does nothing, and the Dock icon is hidden. The harness and the blind ui-driver set it unless `RW_HEADED=1`. Playwright drives hidden windows through the debugging protocol (input and screenshots), so suites are unchanged.
- **Alternatives:** (a) Off-screen window positions — still Dock icons and focus changes. (b) A virtual display — not available on macOS without third-party tools.
- **Consequences:** Nothing in the app depends on window visibility or focus (checked); the packaged app never sets the switch (test mode only). `RW_HEADED=1` restores visible windows for debugging. **Amended 2026-10-07 (MEM-067, MEM-071, MEM-073):** every window is created hidden in test mode, and links never open the browser; the main window is shown inactive at opacity 0 and click-through (a never-shown window could stop painting, which stalled Playwright's clicks); sign-in windows stay hidden but are tagged `rwUserFacing` so the blind ui-driver treats them as on screen.
- **Affected sections:** §1B.2 env vars.


### DEC-098 — Fast development tests; full live acceptance unchanged as the bar (user-directed, amends DEC-015)
- **Date:** 2026-10-06 · **Status:** Accepted (user: "re organize the test suite so that it can run much faster and everything is also headless")
- **Context:** Every fix ran the full acceptance (~2 h 40 min: clean rebuild, ~170 tests, Gmail/live, blind agents), though most fixes touch one area. Fixture suites ran one test at a time (MEM-051) and asked ChatGPT live about the same saved articles each run.
- **Decision:** TestPlan.md. Three commands: `npm run test:quick` (static audit + tests for the changed areas), `npm run test:area` (all fixture tests + changed real-data areas), `npm run accept` (everything, clean, live). Spec files carry area tags in `tests/areas.mjs`, which maps changed files to areas. In quick/area only, fixture tests replay recorded AI answers (`RW_AI_REPLAY=1` → `RW_LLM_CACHE=rw` with the shared `RW_LLM_CACHE_DIR=tests/ai-cache`, keyed by the exact request, so a changed prompt or input asks live) and run on 4 workers, each with its own fixture server; real-data tests always ask live (the harness refuses replay for tests/realdata and tests/live) and reuse a prepared real library built the same day by the same builder (`RW_LIBRARY_REUSE=1`). Tests wait for the documents they check (`rw.settle`), not the whole queue. Every window is created hidden in test mode, links never open the user's browser in headless runs, and the static audit enforces both.
- **Alternatives:** (a) Keep full acceptance per fix — hours per fix. (b) Replay in acceptance too (DEC-015's rejected "cassettes in CI") — would stop verifying real model behaviour; rejected, acceptance stays live.
- **Consequences:** A dev pass can miss an indirect effect the area map doesn't know about or a model change; `accept` (live, all stages) remains required before anything is installed. Recordings are git-ignored and survive `accept`'s clean.
- **Affected sections:** §3.0, §3E, §1B.2 env vars (RW_LLM_CACHE_DIR).

### DEC-099 — The user's layer on every object; following always looks it up; Re-process anything (user-directed)
- **Date:** 2026-10-06 · **Status:** Accepted (user: "Following anything always hydrates it and gives it sources"; "add human details really to anything separate from the data the agent maintains … the ability to describe it first"; "the human is able to force a reingest or reprocess of any entity")
- **Context:** Cua (a 3-letter name) was added and followed: the lookup judged 0 of 56 results to be about it, created no news watch (only made when something was picked) and tried no site (names under 4 letters skipped); renaming it "cua.ai" searched the web address as a name. Seven new theses got 0 links: theses were matched only while reading new articles. Notes reached only Ask.
- **Decision:** (1) `object_details` (migration 0003) holds what the user says about a company, firm, person, thesis or source — about, website, other names, kind-specific fields — written only through the ontology op `object.describe` (history + Undo; a thesis's description stays in `theses.description`). (2) Following anything runs HYDRATE_OBJECT again; the lookup uses the user's details (website → domain; what it does → search words and the SELECT_COVERAGE judge), takes a domain-shaped name as the website and names the entity from its home page title, guesses sites for short names (word-boundary title check), and keeps a news watch even when nothing was found; when it found nothing to go on, the page asks for one hint. The watch search is shown and editable (`object.watch`). (3) A thesis created or reworded is matched against stored facts (MATCH_THESIS: FTS candidates from its words → the INTERPRET link rules), with topic-source suggestions while no source covers it. (4) Reading consults the user's layer: SAME_ENTITY runs when a mention resolves to an entity the user described or wrote notes on, and a namesake gets its own entity; triage/interpretation see "Cua — you: …" for followed entities; summaries and Ask get the user's words as context, never as a cited fact. (5) Re-process on every object (`object.reprocess`, plan first): entity → lookup + re-read of its linked/named articles (≤60); thesis → re-match; source → re-fetch + re-read 30 days; article → re-read; a snapshot lets the page say what changed and "Keep those links" restores links a re-read removed.
- **Alternatives:** (a) Fold user details into notes — notes are free text with no fields the lookup can use. (b) Re-read everything for a new thesis — costs the whole library's AI budget; facts are already stored. (c) Put user details in EXTRACT's prompt — one big prompt for every document; SAME_ENTITY runs only where the user said something.
- **Consequences:** More AI calls only where the user described something (SAME_ENTITY) or asked (Re-process, thesis edits, debounced 15 s). Follow on an already-hydrated entity looks it up again. Source "what you want from it" stays the source instruction (its existing editor); the user's layer for sources is that field.
- **Affected sections:** §1A.7 (M22), P-OBJECT-009/010, §1B.4 (object_details), §1B.12 (MATCH_THESIS, SAME_ENTITY).
- **Amendment (2026-10-08, finishing iteration 2 to the letter of the backlog):** creating a thesis opens "Describe it" too (Title · The claim · What would prove or disprove it — the claim is the thesis description, the proof goes to `object_details`), and people can be added from ⌘K / Create (Name · Who they are · Role · Where · How you know them; followed and looked up like any entity). Summaries (SUMMARIZE_OBJECT, summarize-2) may use the user's words for a sentence only when the model lists it in `yours`; it must be grounded in those words, and the page shows it with "(your words)" — every other sentence is grounded in cited evidence. The summary section now writes its summary on first view (it had no trigger and always said "No summary yet"). Tests UI-DESC-05/06, UI-TH-01, SMK-01.

### DEC-100 — Reports are deep dives read in the app; only briefings send; reading first, Refine on top (user-directed)
- **Date:** 2026-10-06 · **Status:** Accepted (user: "only briefings can be sent and stuff and is an aggregation reports are more deep dives with more details … 50% more detail could be helpful"; "Refine this report should be at the top not bottom")
- **Context:** A report could email itself and could also be tagged into a briefing (DEC-091), so there were two ways to get email and the screen didn't say how they differ. Refine sat under the whole preview. Story reports had a 3–5 sentence lede and 1–3 sentences per section.
- **Decision:** (1) No report emails on its own (the run never queues SEND_EMAIL). A report that asks for email — "email it to me" in create/refine, a template, an existing emailing report (migrated once, `reports.briefings_only`) — goes into a briefing: one already holding it, else its own one-report briefing that takes over its schedule (the briefing then runs it; the report keeps its in-app runs on demand). Templates no longer ask for email. Briefing rows get an Email switch (= the briefing's enabled flag; off when email isn't set up). The manual "Send by email" export stays (the user sends it). (2) The open report: Refine on top with examples and the last change + Undo; a settings strip (schedule · layout · sections) writing the same definition through `report.patch` (same history row, so Undo and the next refine see it); Expand / ⌘↩ / double-click open a full-window reader. (3) COMPOSE_STORY (compose-story-3): lede 4–7, sections 2–5, and per section up to two deep dives on its standout companies built from their other stored facts (background rows numbered from 1001, carried in the run so citations resolve); every sentence grounding-checked.
- **Alternatives:** (a) An Email switch on reports (the old backlog item) — keeps two ways to email. (b) Deep dives from re-reading articles — slow and costly; stored facts are enough.
- **Consequences:** E2E-REP-02, UI-REP-01, RD-BR-E1/E2 now prove the briefing path. A report moved into a briefing shows "On demand · Emailed in “X”"; giving it its own schedule again makes it refresh in-app on that schedule too. Longer stories cost a little more per run.
- **Affected sections:** §1A.7 (M23), P-REPORT-010…012, §1B.17.
- **Amendment (2026-10-08):** double-click anywhere in an open report opens the full-window reader (as Expand and ⌘↩ do); UI-REP-03 drives all three. The one-time migration of emailing reports is proven by E2E-REP-06.

### DEC-101 — The daily reading limit is the user's, and off by default (amends DEC-025)
- **Date:** 2026-10-06 · **Status:** Accepted (user: "why is there a limit auto set allow the user to set if needed")
- **Context:** DEC-025 set 150 articles/day when every article cost API money. Since the ChatGPT sign-in, the usage stop (DEC-061) guards the plan directly; the fixed 150 only delayed reading (273 articles parked on 2026-10-06 at 65% usage), and could only be changed in the database.
- **Decision:** `processing.daily_cap` defaults to 0 = no limit; Settings ▸ AI Behavior shows "Daily reading limit" (No limit / 150 / 300 / 600) with today's count. The banner says the limit and how many wait, with Read the rest now (lifts it for the rest of the day, releases parked articles) and Change limit. Raising or removing the limit releases parked articles. Separately, an alias repair re-scores the Today items of entities on the other end of links it rejected, so "X is connected to Y" reasons don't outlive the link.
- **Consequences:** Libraries that never set a limit read without one; the usage stop remains the brake. E2E-CAP-01 still proves the park-until-midnight mechanism with an explicit limit.
- **Affected sections:** §1B.9 (step 7), P-PROC-001, §1A.7 (M23).
