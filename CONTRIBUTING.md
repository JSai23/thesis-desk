# Contributing

Thanks for helping! Thesis Desk is a macOS Electron app; the notes below get you from a clone to a tested change.

## Setup

```bash
npm ci          # installs and rebuilds better-sqlite3 for Electron
npm run dev     # run the app with hot reload
```

AI features need the [Codex CLI](https://github.com/openai/codex) signed in with ChatGPT (`codex login`).

## The development loop

1. Make the change.
2. `npm run test:quick` — runs the tests for the files you changed (fixture tests replay recorded AI answers, so it
   is fast). Repeat while you work.
3. `npm run test:area` when the change is done — every test in the touched areas, including real-data tests.
4. `npm run typecheck && npm run audit:static`.

Test runs are headless. To watch one, set `RW_HEADED=1`.

## House rules

- **Grounding.** Anything the model writes that the user reads must cite stored text and pass the grounding check
  (`app/src/main/ai/grounding.ts`). Prefer dropping a sentence to showing an unsupported one.
- **The user's layer is separate.** What the user says (`object_details`, thesis descriptions) is never overwritten
  by the agent.
- **Every edit is an undoable operation** (`app/src/main/entities/ops`) with history.
- **Bounded waits.** Every network call, page step and bridge call has a time limit that names what it waited for
  (see `docs/Memory.md`, MEM-074/075).
- **New tests get area tags** in `tests/areas.mjs`; the static audit fails an untagged spec or a test that could open
  a window.
- **Decisions are written down.** A change to behavior described in `docs/RFC.md` gets a `DEC-` entry in
  `docs/Decisions.md`; new UI is listed in RFC §1A.7.
- One backlog item per commit, with the item's name in the subject.

## Pull requests

- Describe the change and how you verified it (which tests, on fixtures or real data).
- Keep the PR to one concern; include screenshots for UI changes (`npm run demo:record` re-records the README clips).
- CI runs the type check, the static audit and the requirement-coverage check.
