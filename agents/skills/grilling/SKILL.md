---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

<!-- Forked from mattpocock/skills (MIT) skills/productivity/grilling; rounds
     are delivered through the question_round tool instead of numbered
     questions in a message. -->

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet.

## Delivering a round

Deliver the whole frontier as **one `question_round` tool call** — never as a wall of numbered questions in a message. For each round:

- `title`: name the round and what it settles, e.g. `Round 2 · Storage decisions`.
- One entry per frontier question, with a short `label` (one or two words: `Scope`, `Storage`, `Auth`).
- `prompt` is the question; `details` carries why it matters and what hangs off it.
- Give `options` whenever the answers are enumerable, and mark exactly one `recommended: true` — your recommended answer, first in the list. The user always gets a write-in escape, so options never trap them.
- Use a free-form question (no options) only when the answer is genuinely open-ended.
- Attach an `exhibit` when a picture argues better than a paragraph: a box-drawing sketch of the design branch under discussion, a comparison table of the options, the slice of the design tree this round settles. Plain monospace text, no ANSI, roughly 30 lines by 76 columns at most. Exhibits are optional — most questions don't need one.

After the round returns, post a short synthesis in a normal message: what got settled, what it unblocked, anything the answers overturned. Then recompute the frontier and fire the next round. If the user **cancelled** the round, the result says which questions were already answered — re-ask only the remainder, and ask (in a plain message) whether they want to keep going.

If there is no `question_round` tool but there is an `AskUserQuestion` tool (Claude Code), deliver the round through that instead: up to 4 questions per call, recommended option first with "(Recommended)" appended, splitting bigger rounds across consecutive calls. If neither tool is available (no interactive UI) or the call fails, fall back to asking the round in a message, formatted like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

## Working the tree

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
