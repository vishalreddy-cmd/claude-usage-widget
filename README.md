# Claude Code Usage Widget

An iPhone home screen widget that shows Claude Code's session (5-hour) and
weekly usage limits — percent left and reset times — updated on tap.

Claude Code doesn't expose this data through any file or headless API. The
only place it exists is the `/usage` panel, and that only renders inside an
*interactive* terminal session. So this automates the terminal itself.

## How it works

```
┌─────────────────┐      ┌───────────────────┐      ┌──────────────────────┐
│  Your computer   │      │  GitHub Gist        │      │  iPhone (Scriptable) │
│                  │      │  (private, free)     │      │                      │
│  capture-usage.js│ ───► │  claude-usage.json   │ ───► │  ClaudeUsage.js      │
│  publish-usage.js│      │                       │      │  home screen widget  │
└─────────────────┘      └───────────────────┘      └──────────────────────┘
```

1. **`capture-usage.js`** spawns `claude` inside a real pseudo-terminal
   (`node-pty`), so the CLI thinks it's talking to an interactive session. It
   feeds the raw terminal output into a headless terminal emulator
   (`@xterm/headless`) to reconstruct the rendered screen, sends `/usage`,
   waits for the panel to render, then parses the numbers back out of the
   screen text. This is the free, local, non-billable panel — no API cost.
2. **`publish-usage.js`** runs the capture and pushes the parsed JSON to a
   private GitHub Gist (created automatically on first run).
3. **`scriptable/ClaudeUsage.js`** is an iOS home screen widget (built with
   the free [Scriptable](https://scriptable.app) app) that fetches the
   gist's raw JSON and renders session/weekly % left + reset times. Tapping
   the widget re-runs the script and refreshes it.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure a GitHub token

Copy `.env.example` to `.env` and fill in a Personal Access Token scoped to
**only** `gist`:

```
GITHUB_TOKEN=ghp_...
GIST_ID=          # leave blank on first run
```

Create one at https://github.com/settings/tokens → *Generate new token
(classic)* → check only the `gist` scope.

### 3. Publish usage

```bash
node publish-usage.js
```

First run creates a private gist and prints its id — paste that into
`GIST_ID` in `.env` so future runs update the same gist instead of creating
new ones.

Run this any time you want to push a fresh reading (there's nothing
automatic/scheduled here on purpose — see [Notes](#notes)).

### 4. Set up the iOS widget

1. Install **Scriptable** from the App Store (free).
2. Open `scriptable/ClaudeUsage.js`, update `GIST_RAW_URL` to your own
   gist's hash-less raw URL:
   `https://gist.github.com/<your-username>/<gist-id>/raw/claude-usage.json`
3. In Scriptable: **+** → paste the script → rename it `ClaudeUsage`.
4. Long-press your home screen → **+** → **Scriptable** → pick a size →
   **Add Widget**.
5. Long-press the widget → **Edit Widget** → Script: `ClaudeUsage`,
   **When Interacting: Run Script** (this makes tapping it refresh).

## Notes

- **Cost:** the whole pipeline is free. The `/usage` panel is a local,
  non-billable command; `-p`/headless mode does *not* expose it (anything
  sent there is billed as a real prompt instead), which is why this scrapes
  the interactive panel rather than calling the CLI headlessly.
- **Not real-time:** updates only when you run `publish-usage.js` and then
  tap the widget — by design, not a limitation.
- **Windows-specific bit:** `claude` resolves to `claude.cmd` on Windows,
  which spawns a child process the pty's own `.kill()` doesn't always reach.
  `capture-usage.js` uses `taskkill /T /F` to clean up the whole process
  tree. On macOS/Linux a plain `SIGKILL` is enough.
- Requires `node-pty`, which has a native module — if `npm install` fails to
  build it, you may need platform build tools (Xcode Command Line Tools on
  macOS, `build-essential` on Linux, or Windows already worked here without
  extra setup on Node 24).
