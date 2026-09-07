#!/usr/bin/env node
// grill-me-popup — a blocking, graphical stand-in for a round of grilling questions.
//
// Speaks MCP over stdio with no dependencies (newline-delimited JSON-RPC 2.0).
// grill_round renders a whole round in a local browser popup and does not
// return until the user submits — so the answers arrive back in the
// conversation as the tool result, exactly like typed answers would.
// grill_close is the terminal state: it tells the popup the session is over
// and closes the window.

import { askRound, ensureServer, closeSession } from "./ui-server.mjs";

const NAME = "grill";
const VERSION = "1.1.0";
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_TIMEOUT_S = Number(process.env.GRILL_TIMEOUT_SECONDS || 3600);

/* ------------------------------------------------------------------ wire */

const out = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => out({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => out({ jsonrpc: "2.0", id, error: { code, message } });

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch { fail(null, -32700, "parse error"); continue; }
    handle(msg).catch((err) => {
      if (msg && msg.id !== undefined) fail(msg.id, -32603, String(err && err.message || err));
    });
  }
});
process.stdin.on("end", () => process.exit(0));

/* ----------------------------------------------------------------- tools */

const QUESTION_SCHEMA = {
  type: "object",
  required: ["id", "title"],
  properties: {
    id: { type: "string", description: 'Question label as the user will see it, e.g. "Q8".' },
    title: { type: "string", description: "Short bold title of the decision, e.g. 'Ledger retention and tenancy'." },
    body: {
      type: "string",
      description:
        "The question itself, in GitHub-flavoured Markdown: paragraphs, lists, **bold**, `code`, fenced code, tables, " +
        "blockquotes and links all render. A ```mermaid fenced block renders as a diagram — use one when the question " +
        "is about a flow, a state machine, a sequence or a topology; a picture beats a paragraph there.",
    },
    recommendation: { type: "string", description: "Your recommended answer (the ➡️ line). Markdown. Gives the user a one-click Accept." },
    options: {
      type: "array",
      description: "Discrete choices, when the question is a pick-one/pick-many. Rendered as clickable cards with 1..9 hotkeys.",
      items: {
        type: "object",
        required: ["label"],
        properties: {
          key: { type: "string", description: 'Short key, e.g. "A". Defaults to A, B, C… by position.' },
          label: { type: "string", description: "One-line label for the option." },
          detail: { type: "string", description: "Optional second line of explanation." },
          recommended: { type: "boolean", description: "Marks this option as the one you recommend." },
        },
      },
    },
    multi: { type: "boolean", description: "Allow more than one option to be selected." },
  },
};

const TOOLS = [
  {
    name: "grill_round",
    title: "Ask a round of grilling questions",
    description:
      "Ask the user one whole round of grilling questions in a graphical popup and BLOCK until they answer. " +
      "Pass every question on the current frontier in a single call — one call per round, never one call per question. " +
      "Each question carries your recommended answer, so the user can accept it with one keystroke, pick an option, " +
      "write their own answer, or defer it to a later round. Returns their answers as text. " +
      "Use this instead of printing the questions to the terminal whenever the user is running a grilling session. " +
      "When the frontier is empty, call grill_close to end the session and dismiss the popup.",
    inputSchema: {
      type: "object",
      required: ["questions"],
      properties: {
        round: { type: "integer", description: "Round number, starting at 1." },
        topic: { type: "string", description: "One line naming what is being grilled — rendered as the document title." },
        context: {
          type: "string",
          description:
            "Optional Markdown shown above the questions as an abstract: what this round is about and, from round 2 on, " +
            "the decisions already settled that these questions build on. Keep it to a short paragraph or a few bullets.",
        },
        questions: { type: "array", minItems: 1, items: QUESTION_SCHEMA, description: "Every question on the current frontier." },
        timeoutSeconds: { type: "integer", description: `How long to wait for answers. Default ${DEFAULT_TIMEOUT_S}.` },
      },
    },
    annotations: { title: "Grill the user", readOnlyHint: true, openWorldHint: false, idempotentHint: false },
  },
  {
    name: "grill_close",
    title: "End the grilling session and close the popup",
    description:
      "Terminal state. Call this once the frontier is empty (or the user stops the session): the popup shows a closing " +
      "line and the window is closed. Any round still open in the popup is cancelled. Call it before you write up the " +
      "shared understanding in the terminal.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "One closing line, e.g. \"Frontier empty — 12 decisions settled across 3 rounds.\"" },
        keepOpen: { type: "boolean", description: "Leave the window open showing the closing line instead of closing it. Default false." },
      },
    },
    annotations: { title: "Close grill popup", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

/* -------------------------------------------------------------- dispatch */

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return;                       // notification — nothing to answer

  switch (method) {
    case "initialize": {
      const asked = params && params.protocolVersion;
      return reply(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: NAME, version: VERSION },
        instructions:
          "Grilling UI. When running a grilling session (any 'grill me' request), send each round's whole frontier to " +
          "grill_round instead of printing questions to the terminal; the call blocks until the user answers in the popup. " +
          "When the frontier is empty, call grill_close to dismiss the popup, then confirm the shared understanding.",
      });
    }
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call":
      return callTool(id, params || {});
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}

const text = (t, isError) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

async function callTool(id, { name, arguments: args = {} }) {
  if (name === "grill_close") {
    const told = closeSession(args.message, { autoClose: !args.keepOpen });
    return reply(id, text(told
      ? `Grilling session ended; the popup ${args.keepOpen ? "shows the closing line" : "is closing"}. Now confirm the shared understanding with the user in the terminal.`
      : "Grilling session ended (no popup window was open). Now confirm the shared understanding with the user in the terminal."));
  }
  if (name !== "grill_round") return fail(id, -32602, `unknown tool: ${name}`);

  const problems = validate(args);
  if (problems.length) return reply(id, text("Bad arguments for grill_round:\n- " + problems.join("\n- "), true));

  const roundId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    roundId,
    round: args.round ?? 1,
    topic: args.topic || "",
    context: args.context || "",
    questions: args.questions.map((q, i) => ({
      id: q.id || `Q${i + 1}`,
      title: q.title || "",
      body: q.body || "",
      recommendation: q.recommendation || "",
      options: Array.isArray(q.options)
        ? q.options.map((o, oi) => ({
            key: o.key || String.fromCharCode(65 + oi),
            label: o.label || "",
            detail: o.detail || "",
            recommended: !!o.recommended,
          }))
        : [],
      multi: !!q.multi,
    })),
  };

  await ensureServer();
  const timeoutMs = Math.max(10, Number(args.timeoutSeconds || DEFAULT_TIMEOUT_S)) * 1000;
  const res = await askRound(payload, { timeoutMs });
  return reply(id, text(formatResult(res, payload)));
}

function validate(args) {
  const p = [];
  if (!Array.isArray(args.questions) || !args.questions.length) p.push("`questions` must be a non-empty array.");
  else args.questions.forEach((q, i) => {
    if (!q || typeof q !== "object") p.push(`questions[${i}] must be an object.`);
    else {
      if (!q.id || typeof q.id !== "string") p.push(`questions[${i}].id is required (e.g. "Q${i + 1}").`);
      if (!q.title || typeof q.title !== "string") p.push(`questions[${i}].title is required.`);
      if (q.options && !Array.isArray(q.options)) p.push(`questions[${i}].options must be an array.`);
    }
  });
  return p;
}

/* ----------------------------------------------------------- the answers */

function formatResult(res, payload) {
  const where = `round ${payload.round}`;
  if (res.outcome === "timeout")
    return `No answers: the grilling popup timed out waiting for ${where}. The user may be away. ` +
      `Ask this round in the terminal instead, or call grill_round again if they come back.`;
  if (res.outcome === "abandoned")
    return `No answers: the user closed the grilling popup without submitting ${where}. ` +
      `Fall back to asking this round in the terminal (do not silently assume the recommendations).`;
  if (res.outcome === "superseded")
    return `This round was replaced by a newer grill_round call; no answers were collected for ${where}.`;

  const byId = new Map(payload.questions.map((q) => [q.id, q]));
  const answers = res.answers || [];
  const counts = { accepted: 0, chose: 0, answered: 0, deferred: 0, unanswered: 0 };

  const lines = [];
  for (const a of answers) {
    const q = byId.get(a.id);
    const title = a.title || (q && q.title) || "";
    lines.push(`${a.id} · ${title}`);
    const note = (a.text || "").trim();
    switch (a.status) {
      case "accepted":
        counts.accepted++;
        lines.push("  ✅ Accepted your recommendation as written.");
        break;
      case "accepted_with_note":
        counts.accepted++;
        lines.push("  ✅ Accepted your recommendation, with a qualification:");
        break;
      case "chose": {
        counts.chose++;
        const labels = (a.choice || []).map((k) => {
          const o = q && q.options.find((x) => x.key === k);
          return o ? `(${k}) ${o.label}` : `(${k})`;
        });
        lines.push(`  ☑️ Chose ${labels.join("  +  ") || "—"}`);
        break;
      }
      case "answered":
        counts.answered++;
        lines.push("  ✍️ Answered in their own words:");
        break;
      case "deferred":
        counts.deferred++;
        lines.push("  ⏳ Deferred — not settled. Carry it into a later round; do not assume the recommendation.");
        break;
      default:
        counts.unanswered++;
        lines.push("  ⬜ Left unanswered. Still open — re-ask it.");
    }
    if (note) {
      const nl = note.split("\n");
      lines.push(...nl.map((l, i) => "     " + (i === 0 ? "“" : "") + l + (i === nl.length - 1 ? "”" : "")));
    }
    lines.push("");
  }

  const head =
    `The user answered ${where}${payload.topic ? ` (${payload.topic})` : ""} in the grilling popup — ` +
    `${answers.length} question${answers.length === 1 ? "" : "s"}: ` +
    `${counts.accepted} accepted, ${counts.chose} chose an option, ${counts.answered} written, ` +
    `${counts.deferred} deferred, ${counts.unanswered} left open.`;

  const tail = [];
  if (res.note) tail.push(`Note on the whole round: “${res.note}”`);
  const open = counts.deferred + counts.unanswered;
  tail.push(
    open
      ? `Treat the settled answers as decisions, recompute the frontier, and put the ${open} still-open question${open === 1 ? "" : "s"} into the next grill_round call along with anything they unblocked.`
      : `Every question is settled. Recompute the frontier — if it is non-empty, call grill_round again for the next round; if it is empty, call grill_close, then confirm the shared understanding before acting.`
  );

  return [head, "", ...lines, tail.join("\n")].join("\n");
}

/* --------------------------------------------------------------- startup */

process.on("uncaughtException", (e) => { console.error("[grill] uncaught", e); });
process.on("unhandledRejection", (e) => { console.error("[grill] unhandled", e); });
