// Captures Claude Code usage (session/week % + reset times) and writes it to
// a private GitHub Gist, so the iOS widget can read it from anywhere.
//
// Config comes from a local .env file (see .env.example) — never hardcode
// the token here, and never paste it into chat.
//
// Env vars:
//   GITHUB_TOKEN  (required) - PAT scoped to "gist" only
//   GIST_ID       (optional) - existing gist to update; if blank, a new
//                               private gist is created and its id printed
//                               so you can save it into .env for next time

const fs = require("fs");
const path = require("path");
const { captureUsage } = require("./capture-usage");

const GIST_FILENAME = "claude-usage.json";
const API_BASE = "https://api.github.com/gists";

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function githubRequest(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "claude-usage-widget",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${options.method || "GET"} ${url} -> ${res.status}: ${body}`);
  }
  return res.json();
}

async function publish(parsed) {
  const content = JSON.stringify(parsed, null, 2);
  const gistId = process.env.GIST_ID;

  if (gistId) {
    await githubRequest(`${API_BASE}/${gistId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } }),
    });
    console.log(`Updated gist ${gistId}`);
    return gistId;
  }

  const created = await githubRequest(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: "Claude Code usage (auto-updated)",
      public: false,
      files: { [GIST_FILENAME]: { content } },
    }),
  });

  console.log(`Created new private gist: ${created.id}`);
  console.log(`Raw URL: ${created.files[GIST_FILENAME].raw_url}`);
  console.log(`\nAdd this to your .env so future runs update it instead of creating new ones:`);
  console.log(`GIST_ID=${created.id}`);
  return created.id;
}

async function main() {
  loadEnvFile();

  if (!process.env.GITHUB_TOKEN) {
    console.error("Missing GITHUB_TOKEN. Copy .env.example to .env and fill it in.");
    process.exitCode = 1;
    return;
  }

  const { parsed } = await captureUsage({ debug: Boolean(process.env.DEBUG_SCREEN) });
  console.log(JSON.stringify(parsed, null, 2));
  await publish(parsed);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
