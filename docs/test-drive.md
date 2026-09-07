# Test drive

An end-to-end exercise of the popup in a **real** Claude Code session: real skill, real MCP server, real browser window, multiple rounds, terminal state.

## How to run

From any directory (an empty one proves there's no repo dependency):

```bash
mkdir -p /tmp/grill-test && cd /tmp/grill-test
claude "Read ~/GitHub/grill-me-popup/docs/test-drive.md and follow it."
```

For a stricter, bias-free test of the skill itself, paste only the **Scenario** section below as your prompt instead of pointing at this file — then the session never sees the scorecard.

---

## To the session being tested

Act on the Scenario below exactly as if the user had typed it as their message. The "Scorecard" section at the end is the human tester's checklist, not instructions to you — do not optimize for it; just run your normal grilling behaviour.

## Scenario

Grill me on this plan before I build it.

I'm building **relay**, a small self-hosted webhook *delivery* service: my apps publish events to it over HTTP, and relay owns delivering them to third-party consumer endpoints so each app doesn't reimplement retries. Single binary, Postgres for state, maybe 50 events/sec peak, a few hundred consumer endpoints across ~20 tenants.

My rough plan, which definitely has holes:

- Events land in a Postgres table and workers poll it with `FOR UPDATE SKIP LOCKED`.
- Retry failed deliveries "5 times with backoff", then… not sure. Probably drop with a log line.
- Sign payloads with an HMAC header so consumers can verify us; one signing secret per tenant.
- I want *at-least-once* delivery, but I haven't thought about what consumers need for dedupe.
- Per-endpoint ordering would be nice but I suspect it fights with retries; undecided.
- No thoughts yet on: a slow/dead endpoint starving everyone else, payload retention/PII, secret rotation, or what the ops surface looks like (replay? pause an endpoint?).

Assume I'd rather cut scope than add infrastructure (no Kafka, no Redis unless you convince me). Interview me properly — I want the gaps found before the code exists, and I want the shared understanding written down at the end so I can drop it into a DESIGN.md.

---

## Scorecard (for the human)

What a passing run looks like, in order. Answer honestly — the point is to exercise every path, so vary your answer types in round 1.

**Launch**
- [ ] The session invokes the `grill-popup` skill (or goes straight to `grill_round`) without being told the tool name.
- [ ] A chromeless Chrome app window opens by itself with round 1 — title block, contents rail, progress meter.
- [ ] Round 1 is the *whole frontier* in **one** `grill_round` call (≈4–8 questions), not one call per question. Pick-one decisions arrive as `(a)/(b)/(c)` option rows, each with a `recommended` pick, not as prose.
- [ ] After ~2 minutes unanswered, Claude Code backgrounds the MCP call as a task and the session keeps working (often researching facts) — this is expected, not a failure.

**Round 1 — deliberately exercise every status:**
- [ ] `Enter` on an options question takes the recommended pick and auto-advances.
- [ ] A number key picks a *non*-recommended option; type a short note in its answer box too ("chose + note").
- [ ] `a` accepts a recommendation; on another question, `e` → write your own answer → `Enter` advances.
- [ ] `d` defers at least one question (pick one you actually want re-asked).
- [ ] `?` shows the keyboard sheet; `⌘⏎` warns about open questions if any remain, sends on confirm.

**Between rounds**
- [ ] The tool result the session receives reflects your answers (watch the transcript): chosen options resolved to labels, your notes quoted, the deferral marked *not settled*.
- [ ] Round 2 arrives **in the same window** (no second popup), with an **Abstract** summarising what round 1 settled.
- [ ] Your deferred question comes back in round 2 or later, plus new questions unblocked by your answers.
- [ ] If any question is about a flow/sequence (delivery lifecycle, retry state machine), it may include a monochrome mermaid diagram — bonus, not required.
- [ ] Close the popup window mid-round once: it reopens itself within ~15 s with your draft intact.

**Terminal state**
- [ ] When the frontier empties (usually 2–4 rounds), the session calls `grill_close`: the window shows the closing line under a **∎** and closes itself within a few seconds.
- [ ] The session then writes the shared understanding in the terminal as numbered decisions and asks you to confirm **before** writing DESIGN.md.
- [ ] Nothing you deferred or left open appears in that write-up as a settled decision.

**Failure modes worth spot-checking occasionally**
- [ ] Kill the popup and don't let it reopen (close it again within the grace window): the session falls back to asking that round in the terminal, and does *not* treat the recommendations as agreed.
- [ ] `claude mcp list` shows `plugin:grill-me-popup:grill ✔ Connected` if the window never appears.
