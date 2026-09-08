---
name: mindful-loop
description: User-invoked orchestrator for ONE commit-sized change — a whole ticket when driven by a ticket-loop queue. The human decides scope and reviews the diff; testing runs on autopilot. Invoke with /skill:mindful-loop. Composes grilling, diagnosing-bugs, and tdd through invoke_skill. One ticket per run; never commits.
disable-model-invocation: true
tier: sub
---

# Mindful loop

One change. One commit. The human decides everything that is a decision.
Run the phases in order. Every STOP is a hard stop: end the turn and wait.
Do not skip a phase because the task looks small — small tasks are where
autopilot starts.

Composed skills are loaded with the `invoke_skill` tool, never by reading
their files or working from memory of what they say. If `invoke_skill` is
not available, say so and stop: this loop does not approximate its parts.

## 0. State

Every turn of this loop starts by reading `.scratch/mindful-loop/state.md`.
No file means you are at phase 1. If the file exists but the phases below
are no longer in your context, re-run `/skill:mindful-loop` before acting.

After every STOP, write to that file, in this shape, before ending the turn:

```
Phase: <number> — waiting on <what>
Ticket: <path to the ticket file, when a ticket-loop queue is driving this run>
Criterion: <the acceptance criterion currently in progress, ticket runs only>
Plan: <the six lines approved in phase 2>
Files: <the approved file list>
Findings: <phase 3's report, once phase 3 is done>
Test: <path::name of the current approved test, once phase 4 is done>
```

The loop outlives your context window. This file is the only thing that does.

## 1. Frame

Ask for the change in one sentence. If the sentence contains "and", it is
two changes. Ask which one goes first. STOP.

If invoked with a ticket file path (/skill:mindful-loop
.scratch/<slug>/issues/NN-<name>.md), read the ticket instead of asking.
The change is the whole ticket — one run, one commit. Its unchecked
acceptance criteria are this run's slices, worked in order in phases 4–5.
Record the path as `Ticket:` in the state file, set the ticket's
`**Status:**` to `in-progress`, and point `Current:` in its `queue.md` at it.

The one-sentence test applies to the ticket, not to each criterion: frame
its Description back in one sentence. A ticket you cannot frame without
"and" joining two behaviours is two tickets — STOP and send it back to
/skill:ticket-loop for a split. Otherwise do NOT stop here: carry the
framing into phase 2's first round and get the yes there. The framing STOP
and the grill's first round cost one turn, not two.

If what comes back is a feature rather than a commit — more than one slice,
or the user cannot state it without listing steps — STOP and say: "This is
more than one commit. Run /skill:ticket-loop first, then /skill:mindful-loop
on the ticket it points you at." Do not start the loop on a fragment you
chose yourself.

If the change is a bug fix — a symptom rather than an approach — do phase 1b
before phase 2.

## 1b. Reproduce (bug fixes only)

`invoke_skill("diagnosing-bugs")`. Do its reproduce and minimise phases only.

Do not theorise about the cause before you can name ONE command you have
already run that goes red on this exact symptom, is deterministic, finishes
in seconds, and needs no human. Show the command and its output. Then
minimise it and show the minimised repro. STOP.

That repro becomes phase 4's test. Phase 2's plan is written against it.

## 2. Grill

`invoke_skill("grilling")` and follow its protocol as written — the whole
frontier each round, numbered, each with your recommended answer, then wait.

Scope override: the frontier is closed once these five are explicit. Do not
open branches past them.

- files to touch
- approach, in the user's words
- the seams the test sits at (tdd refuses to test at an unconfirmed seam)
- what "done" looks like (observable, not "works")
- what is out of scope

Ticket runs: the ticket already answers three of the five — files
(**Impacted files**), approach (**Description**), "done" (the acceptance
criteria). The user wrote and reviewed that file; do not re-ask what it
states. The frontier is the gaps only: the seams the tests sit at, what is
out of scope, and anything the ticket leaves genuinely unclear. Open with
the phase 1 framing plus these questions in one round; most ticket runs
should close in that round.

Then write the plan in six lines or fewer and present it with the
`plan_approval` tool — the same lines you will save, plus the file list
and the "done" line. The tool blocks until the user decides, so it is
this phase's stop. If the tool is unavailable (no TUI, not installed),
write the plan in the message, ask for a yes, and STOP instead.

- Approved → save the plan to the state file (approval does not remove the
  need to survive a context rollover) and continue to phase 3.
- Objection → the note becomes a new frontier question and this phase
  restarts. Scope is never renegotiated later than this phase.
- Cancelled → not approval. Update the state file and STOP.

## 3. Read-only pass

Read the files in the plan, plus `CONTEXT.md` and any ADRs covering the area
if they exist, plus whatever you must grep to answer "is something already
doing this?". Report anything that contradicts the plan — an existing helper,
a different pattern already in use, hidden coupling — in five lines or fewer.
Do not edit anything in this phase.

When a queue drives this run, keep a running `.scratch/<slug>/findings.md`:
read it before reading anything else — earlier tickets' passes are verified
context you do not re-derive; re-read only what this plan touches — and
append what this pass learned that later tickets will need. Save the report
as `Findings:` in the state file either way.

If anything contradicts the plan: STOP for a decision. Otherwise continue.

## 4. Test first (autopilot)

`invoke_skill("tdd")` and follow it, with three overrides:

- The seams were agreed in phase 2. Do not re-ask for them.
- Ignore its reference to a `codebase-design` skill. It is not installed here.
- Testing is autopilot: the user has delegated tests entirely. Never STOP
  for test approval, and never ask about test structure, frameworks, or
  cases — decide, write, run.

Phases 4 and 5 repeat once per slice. In a ticket run a slice is one
unchecked acceptance criterion, taken in order; a prose run has exactly
one slice. Invoke tdd once, on the first pass.

Write ONE failing test for the current slice, at an agreed seam. Run it
and show it failing — a test asserted to be red but never executed is the
failure this phase exists to prevent. Then continue straight to phase 5:
the plan approved in phase 2 already authorizes this slice.

## 5. Implement and verify

Minimum code to make the approved test pass. Stay inside the plan's file
list. No extras, no cleanup, no "while I was here".

If the minimum change does not fit inside that file list, STOP and say which
file is missing and why. Do not widen the list yourself.

Then run the approved test and show it green, plus the fast checks the
project already has — typecheck, the test file. Show the commands and their
output. If anything is red, fix it or STOP. Never hand off red.

In a ticket run, tick the criterion this slice satisfied in the ticket file
(one small edit; the file is git-ignored, so it does not touch the
changeset) and update `Criterion:` in the state file. Unchecked criteria
remain → return to phase 4 for the next one, without stopping: testing is
autopilot, and the next human checkpoint is the Hunk review in phase 6.
All ticked → phase 6.

## 6. Hand off

Say what changed in one sentence — the whole ticket, in a ticket run. Then
say exactly: `Ready for /hunk review.` STOP.

From here, do not touch the working tree. Hunk fingerprints the changeset at
review time; any edit flips the checkpoint to re-review-due and `/hunk submit`
refuses. `/hunk review` and `/hunk submit` also require an idle agent — your
ending the turn is what makes them possible at all.

Three things can happen, none of them yours to trigger:

- The user submits notes. They arrive as a review-submission message and
  start your next turn. Go to phase 7.
- The user submits an empty review. It is approved and no turn starts. If you
  are not woken, the change is approved — that is this loop's exit.
- The user keeps the review for later, or abandons it. Nothing starts. Wait.

## 7. Address notes

The notes are already in the message that woke you, each with File, Note ID,
Title, and Body. Do not run `hunk session` commands and do not ask the user
to reopen Hunk: the session is closed by the time you are woken, and the
notes you were sent are the complete set.

Address them one at a time, smallest first. After each, say one line:
`Note <ID> (<file>): <what changed>`. Reply here, in the conversation —
Hunk has no reply verb, and a comment written back into a session is filtered
out of every later submission, so it would reach no one.

If a note asks for something outside the plan, do not do it. Say so and STOP.

When every note is addressed, return to phase 6.

## 8. Done

You reach this phase only when the user says the review is approved — an
empty submission starts no turn, so you will not be told automatically.

State the tests that now pass, the files touched, and `Ready to commit.`

If the state file names a ticket, also advance the queue — the criteria were
already ticked as their slices landed, so what remains is:

- Set the ticket's `**Status:**` to `done` and update its `queue.md`
  (status, Current, Frontier). Statuses are exactly
  `open | in-progress | done`; never write anything else.
- End with one line naming the next command, which is the user's to type:
  - frontier non-empty → `Ticket NN complete. Next: /skill:mindful-loop <path>`
  - queue empty → `All tickets in <slug> are done.`

Then STOP.

## Rules that override everything above

- Never commit. `git commit` is only `ask` in settings, not denied, so this
  rule is the only thing stopping you.
- The approved plan authorizes the ticket's slices, one at a time. Each
  slice still goes red before green — the test and both runs shown as
  evidence — but tests never wait for approval; the reviewable record is
  the point. Never touch work beyond the current ticket — the next ticket
  starts only when the user types its command.
- Never work around `invoke_skill` refusing a skill. A refusal means that
  skill is the user's to invoke — `implement` in particular ends by
  committing and by substituting `/code-review` for the human, which is the
  opposite of this loop. `code-review` belongs after the commit, not here.
- Do not put explanation of code the user did not ask about in any message.
- After every STOP, update the state file before ending the turn.
