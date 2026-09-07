// End-to-end: speak real MCP over stdio to server.mjs, drive the real HTTP/SSE
// form the way the page does, and assert the answers come back as the tool result.
// No browser is involved (GRILL_NO_OPEN=1).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SAMPLE } from "./sample-round.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 39117, TOKEN = "e2etoken", BASE = `http://127.0.0.1:${PORT}`;
const child = spawn("node", [path.join(ROOT, "server.mjs")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, GRILL_NO_OPEN: "1", GRILL_PORT: String(PORT), GRILL_GRACE_MS: "1500", GRILL_TOKEN: TOKEN, GRILL_THEME: "dossier", GRILL_SCHEME: "dark", GRILL_DEBUG: process.env.GRILL_DEBUG || "0" },
});

let buf = "";
const waiters = new Map();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const w = waiters.get(msg.id);
    if (w) { waiters.delete(msg.id); w(msg); }
  }
});

let nextId = 1;
const rpc = (method, params) => new Promise((res) => {
  const id = nextId++;
  waiters.set(id, res);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0, total = 0;
const check = (name, ok, extra) => { total++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) { failures++; if (extra) console.log("      " + extra); } };

// A live SSE client, standing in for the browser page.
function openPage(token) {
  const rounds = [], events = [], byes = [];
  const ac = new AbortController();
  const ready = fetch(`${BASE}/events?t=${token}`, { signal: ac.signal }).then(async (r) => {
    const reader = r.body.getReader(); const dec = new TextDecoder(); let acc = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          acc += dec.decode(value, { stream: true });
          let i;
          while ((i = acc.indexOf("\n\n")) !== -1) {
            const frame = acc.slice(0, i); acc = acc.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(frame); const data = /^data: (.+)$/m.exec(frame);
            if (!ev) continue;
            events.push(ev[1]);
            if (ev[1] === "round") rounds.push(JSON.parse(data[1]));
            if (ev[1] === "bye") byes.push(JSON.parse(data[1]));
          }
        }
      } catch { /* aborted */ }
    })();
    return r.status;
  });
  return { rounds, events, byes, ready, close: () => ac.abort() };
}

const QUESTIONS = SAMPLE.questions.map(({ id, title, body, recommendation, options }) => ({ id, title, body, recommendation, options }));

(async () => {
  /* ---- handshake ------------------------------------------------------- */
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
  check("initialize returns a supported protocol version", init.result?.protocolVersion === "2025-06-18", JSON.stringify(init));
  check("advertises tools capability", !!init.result?.capabilities?.tools);
  check("instructions mention grill_round and grill_close", /grill_round/.test(init.result?.instructions || "") && /grill_close/.test(init.result?.instructions || ""));
  notify("notifications/initialized");

  const ping = await rpc("ping", {});
  check("ping answers", ping.result && !ping.error);

  const list = await rpc("tools/list", {});
  const names = (list.result?.tools || []).map((t) => t.name);
  check("tools/list exposes grill_round + grill_close", names.join(",") === "grill_round,grill_close", names.join(","));
  const schema = list.result.tools[0].inputSchema;
  check("input schema requires questions", schema.required?.[0] === "questions");
  check("input schema documents context and mermaid", !!schema.properties.context && /mermaid/.test(schema.properties.questions.items.properties.body.description));

  /* ---- bad args -------------------------------------------------------- */
  const bad = await rpc("tools/call", { name: "grill_round", arguments: { questions: [{ title: "no id" }] } });
  check("rejects a question without an id", bad.result?.isError === true && /id is required/.test(bad.result.content[0].text), JSON.stringify(bad.result));
  const unknown = await rpc("tools/call", { name: "nope", arguments: {} });
  check("unknown tool is a JSON-RPC error", !!unknown.error);

  /* ---- http surface ---------------------------------------------------- */
  const callP = rpc("tools/call", { name: "grill_round", arguments: { round: 2, topic: SAMPLE.topic, context: SAMPLE.context, questions: QUESTIONS } });
  await sleep(300);

  check("bad token is rejected on /", (await fetch(`${BASE}/?t=wrong`).then((r) => r.status)) === 403);
  check("bad token is rejected on /events", (await fetch(`${BASE}/events?t=wrong`).then((r) => r.status)) === 403);
  const page = openPage(TOKEN);
  const html = await fetch(`${BASE}/?t=${TOKEN}`);
  const htmlText = await html.text();
  check("page loads with the right token", html.status === 200 && /<title>Grilling<\/title>/.test(htmlText));
  check("page references only vendored assets (no CDN)", !/https?:\/\/cdn\./.test(htmlText) && /\/vendor\/marked\.min\.js/.test(htmlText));
  check("GRILL_THEME / GRILL_SCHEME are injected as the page defaults", /data-skin="dossier" data-scheme-pref="dark"/.test(htmlText) && !/__GRILL_DEFAULT/.test(htmlText));
  check("all four skins are offered in the theme picker", ["latex", "textbook", "dossier", "mono"].every((k) => htmlText.includes(`<option value="${k}">`)));
  const otf = await fetch(`${BASE}/vendor/fonts/NewCM10-Book.otf`);
  check("New Computer Modern OTF is served as font/otf", otf.status === 200 && otf.headers.get("content-type") === "font/otf");
  check("JetBrains Mono woff2 is served", (await fetch(`${BASE}/vendor/fonts/jetbrains-mono-400-normal.woff2`).then((r) => r.status)) === 200);
  const font = await fetch(`${BASE}/vendor/fonts/cmunrm.woff`);
  check("vendored font is served with a font mime type", font.status === 200 && /font\/woff/.test(font.headers.get("content-type")));
  check("vendored mermaid is served", (await fetch(`${BASE}/vendor/mermaid.min.js`).then((r) => r.status)) === 200);
  check("vendor path traversal is refused", (await fetch(`${BASE}/vendor/..%2Fserver.mjs`).then((r) => r.status)) === 404);
  check("unknown route is 404", (await fetch(`${BASE}/whatever?t=${TOKEN}`).then((r) => r.status)) === 404);

  await page.ready; await sleep(400);
  check("pending round is pushed to a page that connects late", page.rounds.length === 1, JSON.stringify(page.events));
  const round = page.rounds[0];
  check("round payload carries all questions", round.questions.length === QUESTIONS.length);
  check("round payload carries topic, round and context", round.round === 2 && round.topic === SAMPLE.topic && round.context === SAMPLE.context);
  check("option keys survive / default by position", round.questions[0].options.map((o) => o.key).join("") === "ABC");
  check("questions without options get an empty array", Array.isArray(round.questions[2].options) && round.questions[2].options.length === 0);

  /* ---- window closed and reopened mid-round ---------------------------- */
  page.close();
  await sleep(300);
  const page2 = openPage(TOKEN);
  await page2.ready; await sleep(400);
  check("a reconnecting window gets the same pending round", page2.rounds.length === 1 && page2.rounds[0].roundId === round.roundId);

  /* ---- wrong round id / wrong token on submit -------------------------- */
  const stale = await fetch(`${BASE}/submit`, { method: "POST", body: JSON.stringify({ token: TOKEN, roundId: "stale", answers: [] }) });
  check("submit for an unknown round is 409", stale.status === 409);
  const forged = await fetch(`${BASE}/submit`, { method: "POST", body: JSON.stringify({ token: "nope", roundId: round.roundId, answers: [] }) });
  check("submit with a bad token is 403", forged.status === 403);

  /* ---- submit ---------------------------------------------------------- */
  const submit = await fetch(`${BASE}/submit`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: TOKEN, roundId: round.roundId,
      answers: [
        { id: "Q4", title: QUESTIONS[0].title, status: "chose", choice: ["A"], text: "", recommendation_accepted: false },
        { id: "Q5", title: QUESTIONS[1].title, status: "chose", choice: ["C"], text: "Also stop at a workspace root marker.", recommendation_accepted: false },
        { id: "Q6", title: QUESTIONS[2].title, status: "accepted", choice: [], text: "", recommendation_accepted: true },
        { id: "Q7", title: QUESTIONS[3].title, status: "accepted_with_note", choice: [], text: "Only when a schema is present.", recommendation_accepted: true },
        { id: "Q8", title: QUESTIONS[4].title, status: "deferred", choice: [], text: "" },
      ],
      note: "Keep the doc short.",
    }),
  });
  check("submit accepted", submit.status === 200, String(submit.status));

  const res = await callP;
  const txt = res.result?.content?.[0]?.text || "";
  check("tool call resolved with the answers", !!txt && !res.result?.isError);
  check("summary counts are right", /2 accepted, 2 chose an option, 0 written, 1 deferred, 0 left open/.test(txt), txt.split("\n")[0]);
  check("chosen option is resolved to its label", /Q4 · Precedence[\s\S]*Chose \(A\) flags > env > file > defaults/.test(txt));
  check("note on a chosen option comes through quoted", /Chose \(C\)[\s\S]*“Also stop at a workspace root marker.”/.test(txt));
  check("accepted answer is reported", /Q6 · Secrets[\s\S]*Accepted your recommendation as written/.test(txt));
  check("accepted-with-note is distinguished", /Q7[\s\S]*with a qualification:[\s\S]*“Only when a schema is present.”/.test(txt));
  check("deferred question is flagged as still open", /Q8[\s\S]*Deferred — not settled/.test(txt));
  check("round note comes through", /Note on the whole round: “Keep the doc short.”/.test(txt));
  check("model is told to carry the open question forward", /put the 1 still-open question into the next grill_round call/.test(txt), txt.slice(-260));
  check("no stray keys leaked into the text", !/recommendation_accepted/.test(txt));

  /* ---- a fully settled round tells the model to close ------------------ */
  const callAll = rpc("tools/call", { name: "grill_round", arguments: { round: 3, questions: [{ id: "Q9", title: "Last one", recommendation: "Yes." }] } });
  await sleep(300);
  check("second round reaches the open window", page2.rounds.length === 2 && page2.rounds[1].round === 3);
  await fetch(`${BASE}/submit`, { method: "POST", body: JSON.stringify({ token: TOKEN, roundId: page2.rounds[1].roundId, answers: [{ id: "Q9", title: "Last one", status: "accepted", choice: [], text: "" }] }) });
  const resAll = await callAll;
  check("settled round instructs grill_close", /Every question is settled[\s\S]*call grill_close/.test(resAll.result?.content?.[0]?.text || ""));

  /* ---- terminal state -------------------------------------------------- */
  const close = await rpc("tools/call", { name: "grill_close", arguments: { message: "Frontier empty — 6 decisions settled." } });
  await sleep(200);
  check("grill_close reports the popup is closing", /session ended; the popup is closing/.test(close.result?.content?.[0]?.text || ""), close.result?.content?.[0]?.text);
  check("window receives bye with the message and autoClose", page2.byes.length === 1 && page2.byes[0].reason === "Frontier empty — 6 decisions settled." && page2.byes[0].autoClose === true, JSON.stringify(page2.byes));
  page2.close();
  await sleep(200);
  const late = openPage(TOKEN); await late.ready; await sleep(300);
  check("a stale window reconnecting after the end is told bye", late.byes.length === 1 && !late.rounds.length, JSON.stringify(late.events));
  late.close(); await sleep(200);
  const closeNone = await rpc("tools/call", { name: "grill_close", arguments: {} });
  check("grill_close with no window open still succeeds", /no popup window was open/.test(closeNone.result?.content?.[0]?.text || ""));

  /* ---- keepOpen + cancelling a pending round --------------------------- */
  const pendingP = rpc("tools/call", { name: "grill_round", arguments: { questions: [{ id: "Q10", title: "Pending" }] } });
  await sleep(200);
  const page4 = openPage(TOKEN); await page4.ready; await sleep(300);
  check("a new session after close opens a fresh round", page4.rounds.length === 1);
  const closeKeep = await rpc("tools/call", { name: "grill_close", arguments: { message: "stopping early", keepOpen: true } });
  const pendingRes = await pendingP;
  check("closing cancels the pending round as superseded", /replaced by a newer grill_round call|no answers were collected/i.test(pendingRes.result?.content?.[0]?.text || ""), pendingRes.result?.content?.[0]?.text);
  await sleep(200);
  check("keepOpen sends bye with autoClose=false", page4.byes.length === 1 && page4.byes[0].autoClose === false && /shows the closing line/.test(closeKeep.result?.content?.[0]?.text || ""), JSON.stringify(page4.byes));
  page4.close(); await sleep(200);

  /* ---- abandonment ----------------------------------------------------- */
  const callP2 = rpc("tools/call", { name: "grill_round", arguments: { round: 4, questions: [{ id: "Q11", title: "Anything else?", recommendation: "No." }] } });
  await sleep(300);
  const page3 = openPage(TOKEN); await page3.ready; await sleep(400);
  check("round reaches the window", page3.rounds.length === 1);
  page3.close();
  await sleep(4200);                                    // grace ×2 (one silent reopen attempt is suppressed by GRILL_NO_OPEN)
  const res2 = await callP2;
  check("closing the window returns a fallback instruction, not a hang",
    /closed the grilling popup without submitting/.test(res2.result?.content?.[0]?.text || ""), (res2.result?.content?.[0]?.text || "").slice(0, 120));

  /* ---- timeout --------------------------------------------------------- */
  const t0 = Date.now();
  const res3 = await rpc("tools/call", { name: "grill_round", arguments: { questions: [{ id: "Q12", title: "Fast timeout" }], timeoutSeconds: 1 } });
  check("timeout returns a fallback instruction", /timed out waiting/.test(res3.result?.content?.[0]?.text || ""));
  check("timeout fires on its own clock (10s floor)", Date.now() - t0 >= 9500 && Date.now() - t0 < 14000, `${Date.now() - t0}ms`);

  console.log(failures ? `\n${failures} of ${total} FAILED` : `\nall ${total} green`);
  child.kill();
  process.exit(failures ? 1 : 0);
})();
