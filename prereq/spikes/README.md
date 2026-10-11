# Spikes verified on 2026-09-30 (macOS 15.7.9, Node 24.4.1)

These scripts are the working reference for three integrations. Each one ran successfully. **None of them prints secrets.**

## 1. GPT-6 Luna through the local ChatGPT/Codex sign-in — `luna/`
- **Prerequisite:** Codex CLI is installed and signed in with ChatGPT. `~/.codex/auth.json` has `auth_mode` set to ChatGPT, plus `tokens.access_token` and `tokens.account_id`.
- **Run:**
  ```bash
  node luna/luna-probe.mjs
  ```
  It makes three calls: plain text, a strict `text.format` json_schema call, and `reasoning.effort: 'none'`. All returned HTTP 200 with 0 reasoning tokens.
- **Run:**
  ```bash
  node luna/luna-parallel-and-limits.mjs
  ```
  It makes 8 parallel calls (all 200) and one ~60k-token input call (200), and prints the `x-codex-*` usage headers.
- **Endpoint:** `POST https://chatgpt.com/backend-api/codex/responses`
- **Headers:** `Authorization: Bearer <access_token>`, `chatgpt-account-id: <account_id>`, `originator: codex_cli_rs`.
- **Body:** `{model:'gpt-6-luna', store:false, stream:true, instructions, reasoning:{effort:'none'}, input:[...], text:{format:{type:'json_schema',...}}}`. The response is an SSE stream: concatenate `response.output_text.delta` events; usage is on `response.completed`.
- **Where the details came from:**
  - Model slug: `~/.codex/models_cache.json`.
  - Endpoint string: found inside the Codex binary (`grep -a backend-api/codex`).

## 2. Operating the Electron app through its UI — `electron-ui/`
- **Install:**
  ```bash
  npm i -D electron playwright electron-builder
  ```
  `electron` and `electron-builder` must be in devDependencies.
- **Dev:**
  ```bash
  node drive.mjs dev
  ```
- **Packaged:**
  ```bash
  npx electron-builder --mac dir --publish never
  cp -R "dist/mac-arm64/RW Spike.app" ~/Applications/
  node drive.mjs packaged "$HOME/Applications/RW Spike.app/Contents/MacOS/RW Spike"
  ```
- **What the drive script does:** fills fields and clicks by accessible role/name, reads `ariaSnapshot()`, calls `window.rw.invoke`, evaluates main with `app.evaluate`, and takes a screenshot.
- **Attach to a running app:** launch it with `--remote-debugging-port=9350`, then run
  ```bash
  node attach.mjs
  ```
  (uses `chromium.connectOverCDP`).
- **Gotcha:** use `asar:true` **with an explicit `build.files` list**. With the default files glob, the packaged app exited silently with code 1 and never ran main.js.

## 3. Using whatever you're signed into in Chrome — `browser-session/`
- **Run:**
  ```bash
  node browser-session/chrome-session-bridge.mjs "<Chrome profile>" x.com https://x.com/home out.png
  node browser-session/chrome-session-bridge.mjs "<Chrome profile>" google.com "https://mail.google.com/mail/u/0/#inbox" out.png
  ```
  Both worked headless, signed in.
- **How it works:**
  1. Read the "Chrome Safe Storage" password with the `security` CLI (macOS shows a Keychain prompt; click **Allow**).
  2. Derive the key: PBKDF2-SHA1 with salt `saltysalt`, 1003 iterations, 16 bytes.
  3. Decrypt `v10` cookies with AES-128-CBC (IV = 16 spaces), then strip the 32-byte SHA-256(host) prefix (Chrome ≥130).
  4. Inject the cookies with `context.addCookies` into a headless `channel:'chrome'` browser with a normal Chrome user agent.
- **What did NOT work:**
  - Copying the profile directory and launching Chrome on it. Chrome couldn't decrypt the copied cookies, even with `ignoreDefaultArgs:['--use-mock-keychain']`, and X and Google showed signed-out pages.
  - Headless Chrome's default user agent. "HeadlessChrome" got HTTP errors on X.
  - a Chrome profile's Google session (account chooser). The working Google session is in a Chrome profile.
- **Profile names and accounts:** listed in `~/Library/Application Support/Google/Chrome/Local State` under `profile.info_cache`.
