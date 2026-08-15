// Claude Usage — Scriptable home screen widget.
// Reads the JSON published by publish-usage.js on your computer via a
// private GitHub Gist and shows session/weekly % left + reset times.
//
// Setup:
//   1. Replace GIST_RAW_URL below with your own gist's hash-less raw URL:
//      https://gist.github.com/<your-username>/<gist-id>/raw/claude-usage.json
//   2. Install this as a Scriptable script named "ClaudeUsage".
//   3. Long-press home screen -> add widget -> Scriptable -> pick a size.
//   4. Edit the widget -> Script: ClaudeUsage -> When Interacting: Run Script.
//      (This is what makes tapping the widget refresh it.)

const GIST_RAW_URL =
  "https://gist.github.com/vishalreddy-cmd/1d81400c223536dee4c3e791b602f824/raw/claude-usage.json";

const CACHE_PATH = FileManager.local().joinPath(
  FileManager.local().documentsDirectory(),
  "claude-usage-cache.json"
);

async function fetchUsage() {
  const req = new Request(GIST_RAW_URL);
  req.timeoutInterval = 10;
  const data = await req.loadJSON();
  FileManager.local().writeString(CACHE_PATH, JSON.stringify(data));
  return { data, stale: false };
}

function loadCachedUsage() {
  if (!FileManager.local().fileExists(CACHE_PATH)) return null;
  try {
    return JSON.parse(FileManager.local().readString(CACHE_PATH));
  } catch (_) {
    return null;
  }
}

async function getUsage() {
  try {
    return await fetchUsage();
  } catch (err) {
    const cached = loadCachedUsage();
    if (cached) return { data: cached, stale: true };
    throw err;
  }
}

function percentLeft(percentUsed) {
  return Math.max(0, 100 - percentUsed);
}

function colorFor(pctLeft) {
  if (pctLeft <= 15) return new Color("#e05252");
  if (pctLeft <= 40) return new Color("#e0a952");
  return new Color("#5aa971");
}

function addBar(stack, label, pctLeft, resets) {
  const row = stack.addStack();
  row.layoutVertically();

  const labelRow = row.addStack();
  const labelText = labelRow.addText(label);
  labelText.font = Font.mediumSystemFont(12);
  labelText.textColor = Color.white();
  labelRow.addSpacer();
  const pctText = labelRow.addText(`${pctLeft}% left`);
  pctText.font = Font.boldSystemFont(12);
  pctText.textColor = colorFor(pctLeft);

  row.addSpacer(3);

  const barWidth = 260;
  const barHeight = 8;
  const barBg = new Path();
  barBg.addRoundedRect(new Rect(0, 0, barWidth, barHeight), 4, 4);
  const ctx = new DrawContext();
  ctx.size = new Size(barWidth, barHeight);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  ctx.setFillColor(new Color("#3a3a3c"));
  ctx.addPath(barBg);
  ctx.fillPath();
  const filled = new Path();
  filled.addRoundedRect(new Rect(0, 0, Math.max(6, (barWidth * pctLeft) / 100), barHeight), 4, 4);
  ctx.setFillColor(colorFor(pctLeft));
  ctx.addPath(filled);
  ctx.fillPath();
  const barImg = row.addImage(ctx.getImage());
  barImg.imageSize = new Size(barWidth / 2, barHeight / 2);

  row.addSpacer(2);
  const resetText = row.addText(`Resets ${resets}`);
  resetText.font = Font.systemFont(10);
  resetText.textColor = new Color("#9a9a9e");
}

async function createWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#1c1c1e");
  widget.setPadding(14, 14, 14, 14);

  let usage, stale, errorMsg;
  try {
    ({ data: usage, stale } = await getUsage());
  } catch (err) {
    errorMsg = err.message || String(err);
  }

  const header = widget.addStack();
  const title = header.addText("Claude Usage");
  title.font = Font.boldSystemFont(14);
  title.textColor = Color.white();
  header.addSpacer();
  const refreshIcon = header.addText("↻"); // ↻ refresh glyph, tap-target is the whole widget
  refreshIcon.font = Font.boldSystemFont(14);
  refreshIcon.textColor = new Color("#9a9a9e");

  widget.addSpacer(10);

  if (errorMsg) {
    const err = widget.addText(`Couldn't load usage:\n${errorMsg}`);
    err.font = Font.systemFont(11);
    err.textColor = new Color("#e05252");
  } else {
    addBar(widget, "Session", percentLeft(usage.session.percentUsed), usage.session.resets);
    widget.addSpacer(10);
    addBar(widget, "This week", percentLeft(usage.week.percentUsed), usage.week.resets);

    widget.addSpacer(10);
    const captured = new Date(usage.capturedAt);
    const label = stale ? "Last known (offline)" : "Updated";
    const updatedText = widget.addText(`${label} ${captured.toLocaleTimeString()}`);
    updatedText.font = Font.systemFont(9);
    updatedText.textColor = new Color("#6a6a6e");
  }

  return widget;
}

const widget = await createWidget();

if (!config.runsInWidget) {
  // Running from the app (including a tap on the home screen widget) —
  // show a preview matching the size you're using on your home screen.
  await widget.presentMedium();
}

Script.setWidget(widget);
Script.complete();
