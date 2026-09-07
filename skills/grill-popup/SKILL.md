---
name: grill-popup
description: Interview the user relentlessly about a plan, decision or design until you reach a shared understanding — asking each round through the grill_round popup instead of the terminal. Use for any "grill me" trigger phrase, or whenever the user wants their thinking stress-tested and the grill_round tool is available.
---

Interview the user relentlessly until you reach a shared understanding. Map the problem as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round, with your recommended answer on every question, then wait for the user's answers before the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, docs), dispatch a sub-agent to find it — don't ask the user for anything you could look up. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait; ask the rest of the frontier now. The _decisions_ are the user's — put each to them and wait.

## Ask through the popup

Ask every round with **one `grill_round` call** carrying the whole frontier — never one call per question. The call blocks until the user submits in the popup; their answers come back as the tool result.

- `topic` is the document title; keep it to one line. From round 2 on, put a short `context` — the decisions already settled that this round builds on — so the user is never reading a question cold.
- Each question is `{id, title, body, recommendation}`. `body` is Markdown and renders fully: lists, `code`, **bold**, tables, blockquotes, fenced code. A ```` ```mermaid ```` block renders as a diagram — reach for one when the question is about a flow, a sequence, a state machine or a topology.
- **Use `options` whenever the question is really a pick-one.** "(A)… (B)… (C)…" belongs in `options`, not in the body: the user gets `(a)`/`(b)`/`(c)` rows with number-key hotkeys and you get back which one they picked. Mark your pick `recommended: true` and still write the `recommendation` — the popup's Enter key takes the recommended option.
- Set `multi: true` only when several options can genuinely be true at once.

## Honour what comes back

- `accepted` and `chose` are settled decisions. Read the chosen option's label; any text alongside it is a qualification that overrides you where it conflicts.
- `answered` / `accepted_with_note`: the user's words win over your recommendation.
- `deferred` and `unanswered` are **not** settled. Carry them into a later round; never assume the recommendation.
- If the result says the popup was closed or timed out, ask that round in the terminal in the plain numbered format instead — do not treat silence as agreement.

Then recompute the frontier and call `grill_round` again.

## Finish properly

The session is done when the frontier is empty: every branch visited, nothing silently assumed. At that point:

1. Call **`grill_close`** with a one-line summary (e.g. "Frontier empty — 12 decisions settled across 3 rounds."). This dismisses the popup.
2. Write the shared understanding out in the terminal as a numbered list of decisions, and ask the user to confirm it.
3. Do not act on any of it until they confirm.

If the user stops the session early, still call `grill_close` so the window doesn't linger.

_The interview method is Matt Pocock's `grilling` skill (MIT); this skill only changes the surface it is asked through._
