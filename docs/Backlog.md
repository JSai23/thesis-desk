# Backlog

Things we want to fix or build next, most important first. Each item says what is wrong now, what "done" looks like,
and how it will be verified (real data first — see the real-data stage, DEC-087). UI changes need a DEC entry and an
RFC §1A.7 update when they add screens or controls. Move an item to **Done** with its commit when it ships.
Not being built yet — this is the list.

## Now

(Iteration 2 shipped — see Done. Next iteration: pick from Next.)

## Next

### Known live-model misses (seen 2026-10-10, test:quick after the open-source polish)
- **Now:** live-AI checks that passed in the final acceptance run occasionally miss on a later run:
  RD-LOOK-02 (Cua's lookup picked articles about the Australian credit union "CUA"), RD-BR-01 (a report listed the same
  deal twice), RD-STORY-03 (a thesis story's "against" count didn't match its rows).
- **Done when:** each has a deterministic guard (a same-entity check against the user's description on selection;
  de-duplicating deal rows by company and round; the for/against bar computed from the rendered rows), so the
  check fails only when the model is wrong *and* the guard missed it.

### Delete anything (user-requested 2026-10-06)
- **Now:** reports, briefings, alerts and sources have Delete (with Undo). Companies, firms and people can only be
  deleted by asking the AI in chat ("delete X" → entity.delete) — no button anywhere. Theses can only be archived.
- **Done when:** every object — company, firm, person, thesis, note, source, report, briefing, alert, view, and a
  single fact or article — has **Delete** on its page and its list row (right-click and ⌫ too), with Undo.
  - The confirm says what goes with it: "Delete Cua? Its 6 linked articles stay in your library; their links to
    Cua and its 2 sources go." A thesis asks about its child theses (move up or delete too).
  - Deleted stays deleted: a later article naming it doesn't silently re-create it (it can come back only as a
    suggestion, or when you add it again).
  - Sources the app created for it (its site, news watch, connected watches) are removed unless something you
    follow still needs them.
- **Verify:** product E2E deletes one of each kind, checks Undo restores it exactly; real data: delete a company,
  process a new article naming it → not re-created.

### Dismissing a suggested thesis doesn't remove it from the screen (found 2026-10-06)
- **Now:** clicking Dismiss on a suggested thesis saves the dismissal (it's gone after a refresh), but the card stays
  on screen until then, so it looks like the click did nothing. Likely cause, unconfirmed: the Dismiss handler
  (`renderer/vm/screens.ts`, thesisSuggestRows) calls `refreshAll(false)`, which may not reload the suggestion list.
- **Done when:** the card disappears at once on Dismiss (and on Create), with an Undo toast for Dismiss; same check
  for dismissing a suggested source, which uses the same pattern.
- **Verify:** product E2E: suggested thesis → Dismiss → card gone without reload; after a restart it stays gone.

### Two-sided events become one fact per side (found 2026-10-06: World Labs' acquisition missing)
- **Now:** each fact has one subject and shows on that entity's timeline — the right model. Funding already writes
  one fact per side (a funding fact for the company, an investment fact per investor, from the same sentence), but
  acquisitions don't: "AMD announced its intent to acquire Fei Fei Li's World Labs… for $8.2 billion" (Crunchbase Q3
  roundup) became one fact about AMD; World Labs' timeline has nothing and its page doesn't say it was acquired.
  Partnerships ("X partners with Y") and executive moves land on one side the same way.
- **Done when:**
  - The reading instructions apply the funding pattern to every two-sided event, from the same quote: acquisition →
    one fact for the buyer ("AMD agreed to acquire World Labs") and one for the company bought ("World Labs agreed to
    be acquired by AMD for $8.2B"), each with its role (acquirer / acquired) in the payload; partnership → one fact per
    partner; executive move → the person, the company left and the company joined.
  - A fact about the company bought sets its stage to Acquired (pending or closed, as the quote says — "intent to
    acquire" / "agreed to buy" counts as pending), and the company page shows "Acquired by AMD · pending" at the top.
  - No new structure: still one subject per fact, no new relationship type.
  - Articles already read are re-read once for these kinds only (articles that have an acquisition, partnership or
    executive-change fact), paced by the daily limit and the usage stop, so existing facts gain their other side.
- **Verify:** real data: the user's library after the re-read shows the acquisition on World Labs' timeline and
  page, and on AMD's, from the Crunchbase roundup and the two later articles; a live article with a partnership gets a
  fact on both partners; product E2E fixture covers acquirer/acquired roles and the pending stage.

### Suggest sources for the space around a company or firm you follow (user-requested 2026-10-05; decided: on follow)
- **Now:** adding a company or firm finds the entity itself — its site and a "News: <name>" search — but nothing
  about its market. For Makora, sources on GPU kernel optimization, AI infrastructure and inference, chips, and peer
  blogs (SemiAnalysis, Modular, PyTorch…) had to be picked by hand.
- **Done when:** after following (which runs hydration), the company or firm page shows a short **Suggested sources** card: 4–8 proposals,
  each with a one-line reason drawn from its coverage ("Makora's articles are about GPU kernel tuning"). Kinds:
  news searches for its market and named competitors, Hacker News searches for its technical topics, blogs of the
  platforms or peers its coverage names; for a firm, its portfolio's sectors and its partners' blogs. Each
  suggestion is added with one click (or all at once), dismissible, and never subscribed without the user's click.
  Suggestions come only from the entity's fetched coverage, never model memory, and every proposed feed is
  probed before it's shown.
- **Verify:** real-data test adds a small company and a firm by name → suggestions appear, are on-topic per an
  independent judge, every one probes as found, adding one starts syncing; dismissing hides it for good.

### Changing a source to "Everything" should surface what it already fetched (found 2026-10-05)
- **Partly done (iteration 2):** Re-process on a source re-fetches and re-reads its last 30 days with its current mode, so the user can do it by hand; the automatic re-gate on a mode change is still open.
- **Now:** an article fetched while the source was in "relevant" mode (and filtered out) is not reconsidered when the
  user switches the source to Everything and presses Sync now — Today/All counts don't move; it appears only after a
  source reset. The blind UX tester (UX-08, run acc-2026-10-05T23-19-10) used 61 actions and 4 dead ends on this.
- **Done when:** changing a source's mode or instruction re-runs the relevance gate on that source's recent articles
  (e.g. the last 30 days), so the ones that now qualify appear at once, with a toast ("3 earlier articles now included").
- **Verify:** product E2E: add a source in relevant mode with no theses → switch to Everything → its article appears
  in All without a sync or reset.

### Alias rule: plurals and short abbreviations (found 2026-10-05)
- **Now:** repairing the user's library flagged two real aliases as wrong: "Thinking Machine Labs" for Thinking Machines
  (singular/plural) and "OAI" for OpenAI (a short form that isn't initials). Both were undone by hand.
- **Done when:** the same-name shape accepts a singular/plural variant of a word and short forms made of the name's
  leading letters ("OAI" ← OpenAI); the audit of the user's library lists neither.

### Ask answers can miss a contradicting fact
- **Now:** BK-Q2 in the final run cited one of the two facts that contradict the thesis (the Callhaven ~58%
  automation ceiling) and missed the other. Within the blind threshold (7/8), but an incomplete answer.
- **Done when:** "what contradicts my thesis" answers list every contra-linked evidence item in the window; BK-Q2
  passes across 3 consecutive runs.

### Installed app doesn't update itself
- **Now:** `/Applications/Research Workspace.app` is a copy of the 2026-10-03 build; a rebuild doesn't replace it.
- **Done when:** a documented `npm run install-app` copies the new build into /Applications after a passing run
  (data stays in ~/Library/Application Support/Research Workspace/). Signing/notarization is out of scope unless
  wanted (needs an Apple developer account).

### Ideas raised earlier, not yet committed to
- Report coverage note and gap-filling: tell the user when a report's window has thin coverage and offer sources.
- A confirm step before hydration subscribes the user to an entity's site and news watch.
- More parallel AI lanes for faster processing of large backfills (bounded by the ChatGPT plan's rate).

## Waiting on the user (not code)
- PRQ-EMAIL-02: click the confirmation link in StrictlyVC's email.
- PRQ-AUTH-01: one Keychain "Allow" so the X-post read can be re-verified.
- PRQ-AUTH-02 (optional): sign in to LinkedIn in Chrome.

## Done
- **Iteration 2 (2026-10-06/08)** — DEC-098…101, MEM-066…080. Verified per item with `test:quick` / `test:area`, then acceptance: final run `acc-2026-10-08T09-11-31` (tested 39ccf70): blocking passed, coverage 127/127, no retries in any suite — VerificationReport.md (an earlier clean run, acc-2026-10-08T04-47-19 on 9e92aac, preceded the last four Done-when points). Commits c46dcfc…39ccf70 (items 2–5 share 42245a5 — accepted by the user 2026-10-08); the ten acceptance attempts before it fixed the bugs in MEM-075…080 (unbounded page reads, dropped AI answers, tier-sync races, firm deal coverage).
  - **Faster tests while developing (TestPlan.md)** — `test:quick` / `test:area` / `accept`; tags + changed-files map; replayed AI answers for fixture tests (all 102 fixture tests in 9–11 min, was ~75); prepared real libraries reused for the day; tests wait for what they check; everything headless (the per-source sign-in window and links opening the browser were the leaks, MEM-067). Proof: a one-line change's `test:quick` passed in 13.2 min (31 tests). Commit c46dcfc (+ fixes in the iteration commit).
  - **Following anything always hydrates it** — follow re-runs the lookup; a watch is kept even when nothing is found; a name typed as a web address is the website and the name comes from its home page; short names get site guesses only with context (cua.com is a credit union); the page asks for one hint when there's nothing to go on; the watch search is shown and editable; theses are matched against stored facts on create/edit/follow (MATCH_THESIS) with topic-source suggestions. Verified RD-LOOK-01..05, UI-DESC-01..03. Commits 42245a5 (built together with the next three items in one commit, not one per item), fixes 36d8e6b, f1a53e4, 9e92aac. Final run: RD-LOOK-01…05, RD-HYD-01, RD-TIER-04, UI-OBJ-04 passed first try.
  - **Your description first; Re-process anything** — object_details + `object.describe` (Undo); "Describe it" when adding; From you card on company/firm/thesis pages and Describe… on people; reading checks a described entity (SAME_ENTITY) and leaves namesakes unlinked; summaries and Ask use your words as context; Re-process for entities, theses, sources and articles with "what changed" and Keep those links. Verified RD-DESC-01..03, UI-DESC-04. Commits 42245a5 (combined), fixes b86daff; ada0259 finished the last points (Describe it for new theses and people; summaries mark the user's words). Final run: UI-DESC-01…06, UI-TH-01, RD-DESC-01…03, RD-ONT-11 passed first try.
  - **Reports vs briefings; reading first; Refine on top; ~50% deeper** — only briefings email (one-report briefings take the schedule; emailing reports migrated); Email switch on briefings; Refine at the top with examples and last change + Undo; collapsed settings strip (schedule · layout · sections); Expand reader; deep dives from stored facts. Verified E2E-REP-02, UI-REP-01/03, RD-BR-E1/E2, RD-STORY-06. Commits 42245a5 (combined), b8dc411 (deeper stories), 91da71f, 9eb9b07. Final run: E2E-REP-02, SMK-11, UI-REP-01, UI-REP-03, RD-BR-E1/E2, RD-STORY-01/06 passed first try. ada0259 added double-click to open the reader. The one-time migration of emailing reports is shown by E2E-REP-06 (the user's library had no emailing report left to migrate); 39ccf70 holds roles in stories to their quotes. Final run also passed E2E-REP-06 first try.
  - **Daily reading limit** — off by default, set in Settings with today's count; banner Read the rest now / Change limit; alias repair re-scores the other end's Today reasons. Verified UI-LIMIT-01/02, E2E-CAP-01, RD-TIER-02. Commit 42245a5 (combined). Final run: UI-LIMIT-01/02, E2E-CAP-01, RD-TIER-02 passed first try.
- **Bug: AMD and NVIDIA as Makora's aliases** — aliases only when shaped like the same name or stated by the text; `entity.repairAliases` + `ontology.aliasAudit` (undoable, chat "X isn't another name for Y"). Commits 585b83b, 623add8, 3ec7a98. DEC-096, MEM-060. Verified RD-TIER-01/02, RD-ONT-09b; repaired in the installed library 2026-10-05.
- **Three tiers decide what syncs and what matters** — followed (full lookup on follow), connected (forward-only daily watch, ≤25 per followed entity, sticky), extracted (Pull latest); orphaned system sources removed on unfollow; tier lifts Today and reports. Commits 489a862, 69df1fb, 2416cbf, f5ed11e, d7445f1. DEC-096, MEM-062/063. Verified RD-TIER-03/04, UI-TIER-01.
- **Follow button for venture firms and people** — reader inspector, lists, pages; tier line and Pull latest. Commits 489a862, e0549c5. Verified UI-TIER-01.
- **Today: three sections** — Following · Your theses (per thesis, with an "Add your first thesis" invitation) · Headlines (headline-only, a real bar); the rest in All. Commits 489a862, 0c3e7c2. DEC-096, MEM-061. Verified RD-TIER-05, UI-TIER-02/03, VIS-01.
- Also shipped in this iteration: headless test runs (DEC-097, 83b3422); web listings no longer re-ingest older posts they hadn't seen (5e38780, MEM-064).
- Final acceptance run `acc-2026-10-05T23-19-10` (tested 0c8e325): blocking passed, coverage 121/121, no flaky passes — VerificationReport.md.
