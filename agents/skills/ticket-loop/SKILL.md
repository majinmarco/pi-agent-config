---
name: ticket-loop
description: User-invoked driver for a multi-commit feature. Interview and investigate until the destination is clear, hand off to to-tickets, then keep a queue that feeds tickets to /skill:mindful-loop one at a time. The human types every command that starts work; this skill prepares context and keeps the queue, nothing more. Invoke with /skill:ticket-loop <idea>, or with a feature slug to resume.
disable-model-invocation: true
argument-hint: "an idea to break down, a feature slug to resume, or nothing to find the open queue"
---

# Ticket loop

One feature. Many commits. The human types every command that starts work.

This skill is a driver, not a wrapper. It cannot and must not invoke
to-tickets or mindful-loop — both are user-invoked only, and invoke_skill
refuses them by design. At every boundary where one of them is needed, this
skill STOPs and names the exact command for the user to type. Every STOP is
a hard stop: end the turn and wait.

Composed skills that ARE invocable (grilling) are loaded with `invoke_skill`,
never by reading their files or working from memory. If `invoke_skill` is
not available, say so and stop.

## 0. Orient

Parse the argument:

- **An idea** (prose) → phase 1.
- **A feature slug** matching `.scratch/<slug>/` → the queue phase that slug
  is in: no `queue.md` yet → phase 5; `queue.md` with open tickets → phase 6;
  all done → say so and stop.
- **Nothing** → scan `.scratch/*/queue.md` for queues with open tickets.
  Exactly one → phase 6 on it. Several → list them and ask which. None →
  ask for the idea.

## 1. Frame the destination

Ask for the desired end state in a few sentences: what works when this is
done that does not work today. Not steps, not layers — observable behaviour.
If the answer is a list of tasks, ask again for the state the tasks are in
service of. STOP.

## 2. Read-only investigation

Read `CONTEXT.md` and any ADRs covering the area if they exist, plus
whatever you must grep to understand the current state relative to the
destination. Report in ten lines or fewer: what already exists, what is
missing, anything that contradicts the framing. Do not edit anything.

## 3. Grill

`invoke_skill("grilling")` and follow its protocol as written — the whole
frontier each round, numbered, each with your recommended answer, then wait.

Scope override: the frontier is closed once these are explicit. Do not open
branches past them.

- the destination, in the user's words
- constraints (what must not change)
- what is out of scope
- the feature slug (short, kebab-case — it names `.scratch/<slug>/`)

Write the result back in eight lines or fewer and ask for a yes. STOP.

## 4. Hand off to to-tickets

State the tracker configuration in the conversation, so to-tickets finds it
provided when the user invokes it:

> Issue tracker for this feature: local markdown. One file per ticket at
> `.scratch/<slug>/issues/<NN>-<name>.md`, numbered from 01 in dependency
> order, per to-tickets' local template. No triage labels beyond the
> Status line.

Then say exactly this, and STOP:

> Context is set. Run `/skill:to-tickets` now. Review and edit the ticket
> files it writes until they say what you mean, then run
> `/skill:ticket-loop <slug>` to build the queue.

Do not draft the tickets yourself. Ticket drafting belongs to to-tickets,
in the user's invocation of it.

## 5. Build the queue

Runs when invoked with a slug whose `issues/` exists but `queue.md` does not.

First confirm the user has reviewed the tickets. If not: STOP, review comes
first.

Then, in order:

1. **Hide from git.** If this is a git repo and `git check-ignore .scratch`
   fails, append `.scratch/` to `.git/info/exclude` — local, never
   committed, which is the point. If the user has said these tickets should
   be shared, skip this and say so.
2. **Normalize status.** Every ticket's `**Status:**` line becomes exactly
   one of `open | in-progress | done`. Map `ready-for-agent` to `open`.
   These three tokens are the whole vocabulary; a queue reader matches on
   them, so never write `completed`, `closed`, or anything else.
3. **Write `.scratch/<slug>/queue.md`** from the template below. The
   frontier is every open ticket whose blockers are all done.

Show the queue. Then say exactly, and STOP:

> Queue ready. Run `/skill:mindful-loop .scratch/<slug>/issues/<first
> frontier ticket>` to start.

## 6. Between tickets

Runs when invoked on a queue that already exists. mindful-loop updates the
queue itself when a ticket finishes; this phase is for the human asking
"where was I?", or for repairing a queue that drifted from its ticket files.

Re-derive status from the ticket files (they are the truth; `queue.md` is
the index), rewrite `queue.md` if it drifted, and report: done / in
progress / frontier. Then name the next command — `/skill:mindful-loop
<path>` for the first frontier ticket, or "all tickets are done" — and STOP.

## Queue file template

```markdown
# Queue: <slug>

Statuses are exactly one of: open | in-progress | done.

| NN | Ticket | Blocked by | Status |
| -- | ------ | ---------- | ------ |
| 01 | <title> | — | open |

Current: —
Frontier: 01
```

## Rules that override everything above

- Never invoke to-tickets, mindful-loop, or implement, and never work
  around invoke_skill refusing them — not by reading their files, not by
  paraphrasing them, not by doing their job inline. A refusal means that
  skill is the user's to invoke.
- Never edit code, tests, or anything outside `.scratch/<slug>/` and
  `.git/info/exclude`. This skill owns the queue, not the work.
- Never start a mindful-loop run, a ticket, or a slice yourself. Naming
  the next command is where this skill's turn ends, every time.
- Never commit.
- One queue advances at a time. If asked to run tickets in parallel, say
  that this loop is sequential by design and stop.
