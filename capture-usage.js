// Spawns `claude` inside a real pseudo-terminal, sends /usage, waits for it
// to render, then reads the terminal's screen buffer back out as plain text.
// This uses the free, local, non-billable /usage panel — no API cost.

const os = require("os");
const pty = require("node-pty");
const { Terminal } = require("@xterm/headless");

const COLS = 120;
const ROWS = 50;

const isWindows = process.platform === "win32";
const shell = isWindows ? "claude.cmd" : "claude";

function dumpScreen(term) {
  const buf = term.buffer.active;
  const lines = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  // trim trailing blank lines
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

function killProcessTree(pid) {
  // `claude` on Windows resolves to `claude.cmd`, which spawns a real node
  // process as a *child* of the shell node-pty launched. A plain kill() on
  // the pty's own pid can leave that grandchild running. `taskkill /T`
  // kills the whole tree; on non-Windows a plain kill is enough since
  // `claude` runs directly under the pty with no wrapper in between.
  if (isWindows) {
    require("child_process").spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch (_) {}
  }
}

function parseUsage(screen) {
  const sessionMatch = screen.match(
    /Current session[\s\S]*?(\d+)% used\s*\n\s*Resets ([^\n]+?)\s*$/m
  );
  const weeklyMatch = screen.match(
    /Current week[\s\S]*?(\d+)% used\s*\n\s*Resets ([^\n]+?)\s*$/m
  );

  return {
    capturedAt: new Date().toISOString(),
    session: sessionMatch
      ? { percentUsed: Number(sessionMatch[1]), resets: sessionMatch[2].trim() }
      : null,
    week: weeklyMatch
      ? { percentUsed: Number(weeklyMatch[1]), resets: weeklyMatch[2].trim() }
      : null,
  };
}

// Polls the terminal's rendered screen every `interval` ms until `predicate`
// returns true, or gives up after `timeout` ms (resolves false either way —
// callers decide whether a timeout is fatal).
function waitForScreen(term, predicate, { timeout = 15000, interval = 300 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (predicate(dumpScreen(term))) return resolve(true);
      if (Date.now() - start >= timeout) return resolve(false);
      setTimeout(tick, interval);
    };
    tick();
  });
}

// Captures the /usage panel and resolves with { parsed, screen }.
// Rejects if the panel never rendered parseable content.
async function captureUsage({ debug = false } = {}) {
  const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: COLS,
    rows: ROWS,
    cwd: os.homedir(),
    env: process.env,
  });

  ptyProcess.onData((data) => term.write(data));

  const finish = async (result) => {
    ptyProcess.write("\x1b"); // leave the /usage panel, if open
    ptyProcess.write("/exit\r");
    await new Promise((r) => setTimeout(r, 1000));
    killProcessTree(ptyProcess.pid);
    return result;
  };

  // Step through whichever one-time interactive prompts actually show up
  // (folder-trust, Chrome-extension detection) — poll instead of guessing
  // fixed delays, since CLI boot time varies with system load.
  const sawTrustPrompt = await waitForScreen(term, (s) => /trust this folder/i.test(s), {
    timeout: 10000,
  });
  if (sawTrustPrompt) {
    ptyProcess.write("\r");
    await waitForScreen(term, (s) => !/trust this folder/i.test(s), { timeout: 5000 });
  }

  const sawChromePrompt = await waitForScreen(term, (s) => /Chrome extension detected/i.test(s), {
    timeout: 4000,
  });
  if (sawChromePrompt) {
    ptyProcess.write("\x1b");
    await waitForScreen(term, (s) => !/Chrome extension detected/i.test(s), { timeout: 5000 });
  }

  ptyProcess.write("/usage\r");
  await waitForScreen(term, (s) => /Current session/.test(s) && /Current week/.test(s), {
    timeout: 15000,
  });
  // give the panel a moment to finish rendering numbers after the headings appear
  await new Promise((r) => setTimeout(r, 500));

  const screen = dumpScreen(term);
  const parsed = parseUsage(screen);

  if (debug) {
    console.error("----- CAPTURED SCREEN -----");
    console.error(screen);
    console.error("----- END CAPTURED SCREEN -----");
  }

  if (!parsed.session || !parsed.week) {
    await finish();
    throw Object.assign(new Error("Failed to parse usage panel"), { screen });
  }

  await finish();
  return { parsed, screen };
}

module.exports = { captureUsage };

if (require.main === module) {
  captureUsage({ debug: Boolean(process.env.DEBUG_SCREEN) })
    .then(({ parsed }) => {
      console.log(JSON.stringify(parsed, null, 2));
    })
    .catch((err) => {
      console.error(err.message);
      if (err.screen) console.error("Re-run with DEBUG_SCREEN=1 to see raw output.");
      process.exitCode = 1;
    });
}
