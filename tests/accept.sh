#!/bin/bash
# npm run accept — full acceptance (RFC §3E, TestPlan.md): clean checkout, fresh install, build, then every stage with
# live AI (tests/acceptance.mjs). Recorded AI answers (tests/ai-cache) survive the clean but are never used here.
# Stop a run with MEM-065 (kill `node tests/acceptance.mjs` first).
set -x
cd "$(dirname "$0")/.."
git clean -xfd -e prereq/.env.local -e '*.zip' -e tests/ai-cache && test -f prereq/.env.local && test -z "$(git status --porcelain)" || { echo "STEP1 FAILED: commit or stash changes first"; exit 1; }
npm ci || exit 1
(cd prereq && npm ci) || exit 1
# the installer is built once here (it also builds app/out): SMK-13 then checks it instead of rebuilding while other
# fixture workers are launching the app from app/out
npm run dist || exit 1
export SMK13_SKIP_DIST=1
export RW_RUN_ID=acc-$(date -u +%Y-%m-%dT%H-%M-%S)
unset RW_AI_REPLAY RW_LLM_CACHE_DEV
echo "RUN $RW_RUN_ID"
node tests/acceptance.mjs
code=$?
echo "ACCEPTANCE EXIT $code"
exit $code
