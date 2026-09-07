// Local HTTP + SSE server that renders a grilling round in a browser popup and
// resolves a promise with the user's answers.  One long-lived server per MCP
// process; the same window is reused for every round of the session, and is
// closed (or told to close itself) when the session ends.

import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKIN = ["latex", "textbook", "dossier", "mono"].includes(process.env.GRILL_THEME) ? process.env.GRILL_THEME : "latex";
const DEFAULT_SCHEME = ["auto", "light", "dark"].includes(process.env.GRILL_SCHEME) ? process.env.GRILL_SCHEME : "auto";
const HTML = () => readFileSync(path.join(HERE, "ui.html"), "utf8")
  .replace("__GRILL_DEFAULT_SKIN__", DEFAULT_SKIN)
  .replace("__GRILL_DEFAULT_SCHEME__", DEFAULT_SCHEME);
const VENDOR = path.join(HERE, "vendor");

const TOKEN = process.env.GRILL_TOKEN || randomBytes(16).toString("hex");
const NO_OPEN = process.env.GRILL_NO_OPEN === "1";
const GRACE_MS = Number(process.env.GRILL_GRACE_MS || 12_000);
const AUTOCLOSE = process.env.GRILL_AUTOCLOSE !== "0";

const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

let server = null;
let baseUrl = null;
const clients = new Set();          // live SSE responses
let pending = null;                 // { roundId, payload, resolve, graceTimer, timeoutTimer, reopened }
let launching = false;
let sessionClosed = false;          // set by closeSession(); cleared by the next askRound

const log = (...a) => process.env.GRILL_DEBUG === "1" && console.error("[grill-ui]", ...a);

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const c of clients) { try { send(c, event, data); } catch { /* dead socket */ } }
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function handler(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const base = { "cache-control": "no-store" };

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    if (url.searchParams.get("t") !== TOKEN) { res.writeHead(403).end("bad token"); return; }
    res.writeHead(200, { ...base, "content-type": "text/html; charset=utf-8" }).end(HTML());
    return;
  }

  // Vendored browser assets (fonts, markdown, mermaid). Same-origin only, no
  // token needed — nothing here is sensitive — but path-traversal is closed.
  if (req.method === "GET" && url.pathname.startsWith("/vendor/")) {
    const rel = path.normalize(decodeURIComponent(url.pathname.slice("/vendor/".length)));
    const file = path.join(VENDOR, rel);
    if (!file.startsWith(VENDOR + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found"); return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "public, max-age=86400",
    }).end(readFileSync(file));
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    if (url.searchParams.get("t") !== TOKEN) { res.writeHead(403).end("bad token"); return; }
    res.writeHead(200, {
      ...base, "content-type": "text/event-stream", connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(": hello\n\n");
    clients.add(res);
    log("client connected; total", clients.size);
    if (pending) {                       // reconnect / fresh window mid-round
      clearTimeout(pending.graceTimer); pending.graceTimer = null;
      send(res, "round", pending.payload);
    } else if (sessionClosed) {          // a stale window reconnecting after the end
      send(res, "bye", { reason: "This grilling session has ended." });
    }
    const beat = setInterval(() => { try { res.write(": beat\n\n"); } catch {} }, 25_000);
    req.on("close", () => {
      clearInterval(beat); clients.delete(res);
      log("client gone; total", clients.size);
      if (!clients.size && pending) startGrace();
    });
    return;
  }

  if (req.method === "POST" && (url.pathname === "/submit" || url.pathname === "/closing")) {
    readBody(req).then((raw) => {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { /* ignore */ }
      if (body.token !== TOKEN) { res.writeHead(403).end("bad token"); return; }
      if (url.pathname === "/closing") { res.writeHead(204).end(); return; }
      if (!pending || pending.roundId !== body.roundId) { res.writeHead(409).end("no such round"); return; }
      const p = pending; pending = null;
      clearTimeout(p.graceTimer); clearTimeout(p.timeoutTimer);
      res.writeHead(200, { ...base, "content-type": "application/json" }).end('{"ok":true}');
      p.resolve({ outcome: "submitted", answers: body.answers || [], note: body.note || "" });
    });
    return;
  }

  res.writeHead(404).end("not found");
}

function startGrace() {
  if (!pending || pending.graceTimer) return;
  pending.graceTimer = setTimeout(() => {
    if (!pending || clients.size) return;
    if (!pending.reopened && !NO_OPEN) {           // window closed by accident: one reopen
      pending.reopened = true;
      pending.graceTimer = null;
      log("no client; reopening window once");
      openWindow();
      startGrace();
      return;
    }
    const p = pending; pending = null;
    clearTimeout(p.timeoutTimer);
    p.resolve({ outcome: "abandoned" });
  }, GRACE_MS);
}

export async function ensureServer() {
  if (server) return baseUrl;
  server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(process.env.GRILL_PORT || 0), "127.0.0.1", resolve);
  });
  server.unref();                                   // never hold the MCP process open
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}/?t=${TOKEN}`;
  log("listening on", baseUrl);
  return baseUrl;
}

/* ---------------------------------------------------------- the browser */

const CHROME_MAC = "/Applications/Google Chrome.app";
const CHROME_LINUX = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

function spawnDetached(cmd, args) {
  log("spawn", cmd, args.join(" "));
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", (e) => log("spawn failed", e.message));
    child.unref();
  } catch (e) { log("spawn threw", e.message); }
}

function openWindow() {
  if (NO_OPEN || launching) return;
  launching = true;
  setTimeout(() => { launching = false; }, 1500);
  const custom = process.env.GRILL_BROWSER;        // e.g. "Safari", "Arc", "firefox", "none"
  if (custom === "none") { console.error(`[grill] open this in a browser: ${baseUrl}`); return; }

  if (process.platform === "darwin") {
    if (!custom && existsSync(CHROME_MAC)) {
      // reuses the running Chrome + default profile; --app gives a chromeless popup window
      spawnDetached("open", ["-na", CHROME_MAC, "--args", "--new-window", `--app=${baseUrl}`]);
    } else {
      spawnDetached("open", custom ? ["-a", custom, baseUrl] : [baseUrl]);
    }
    return;
  }
  if (process.platform === "win32") {
    spawnDetached("cmd", ["/c", "start", "", custom || "", baseUrl].filter(Boolean));
    return;
  }
  // linux & friends: try a chromium app window, else whatever xdg-open gives us
  const chrome = custom || CHROME_LINUX.find((b) => {
    try { return spawn("sh", ["-c", `command -v ${b}`], { stdio: "ignore" }) && true; } catch { return false; }
  });
  if (chrome && chrome !== "xdg-open") spawnDetached(chrome, [`--app=${baseUrl}`, "--new-window"]);
  else spawnDetached("xdg-open", [baseUrl]);
}

function focusWindow() {
  if (process.platform !== "darwin" || NO_OPEN || process.env.GRILL_FOCUS === "0") return;
  if (process.env.GRILL_BROWSER) return;           // only know how to raise Chrome
  spawnDetached("osascript", ["-e", 'tell application "Google Chrome" to activate']);
}

/** Close the Chrome app window(s) showing this popup — the belt to window.close()'s braces. */
function closeWindow() {
  if (process.platform !== "darwin" || NO_OPEN || !AUTOCLOSE || process.env.GRILL_BROWSER) return;
  const script =
    'tell application "Google Chrome"\n' +
    '  set victims to {}\n' +
    '  repeat with w in windows\n' +
    '    try\n' +
    `      if URL of active tab of w contains "t=${TOKEN}" then set end of victims to w\n` +
    '    end try\n' +
    '  end repeat\n' +
    '  repeat with w in victims\n' +
    '    close w\n' +
    '  end repeat\n' +
    'end tell';
  spawnDetached("osascript", ["-e", script]);
}

/* --------------------------------------------------------------- rounds */

/**
 * Push one round to the popup and wait for the user.
 * Resolves { outcome: "submitted"|"abandoned"|"timeout"|"superseded", answers?, note? }
 */
export async function askRound(payload, { timeoutMs }) {
  await ensureServer();
  sessionClosed = false;
  if (pending) {                                   // a second call supersedes the first
    const old = pending; pending = null;
    clearTimeout(old.graceTimer); clearTimeout(old.timeoutTimer);
    old.resolve({ outcome: "superseded" });
  }
  return new Promise((resolve) => {
    pending = { roundId: payload.roundId, payload, resolve, graceTimer: null, reopened: false };
    pending.timeoutTimer = setTimeout(() => {
      if (!pending || pending.roundId !== payload.roundId) return;
      const p = pending; pending = null;
      clearTimeout(p.graceTimer);
      broadcast("cancel", { reason: "Timed out waiting for answers." });
      p.resolve({ outcome: "timeout" });
    }, timeoutMs);
    pending.timeoutTimer.unref?.();

    if (clients.size) { broadcast("round", payload); focusWindow(); }
    else openWindow();
  });
}

export function uiUrl() { return baseUrl; }

/**
 * Terminal state. Tells every open window the session is over: the page shows
 * a closing line, then closes itself; on macOS/Chrome the server also closes
 * the app window in case the page cannot. Any pending round is cancelled.
 * Returns how many windows were told.
 */
export function closeSession(message, { autoClose = AUTOCLOSE } = {}) {
  if (!server) return 0;
  sessionClosed = true;
  if (pending) {
    const p = pending; pending = null;
    clearTimeout(p.graceTimer); clearTimeout(p.timeoutTimer);
    p.resolve({ outcome: "superseded" });
  }
  const told = clients.size;
  broadcast("bye", { reason: message || "Grilling complete — shared understanding reached.", autoClose });
  if (told && autoClose) setTimeout(closeWindow, 2600).unref?.();
  return told;
}

/** How many windows are connected right now (for tests and status). */
export function clientCount() { return clients.size; }
