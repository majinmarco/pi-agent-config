---
name: mindful-loop
description: User-invoked orchestrator for ONE commit-sized change with the human deciding at every step. Invoke with /skill:mindful-loop. Composes the model-invoked skills grilling, tdd, and hunk-review. Never self-invoke; never run more than one slice.
---

# Mindful loop

One change. One commit. The human decides everything that is a decision.
Run the phases in order. Every STOP is a hard stop: end the turn and wait.
Do not skip a phase because the task looks small — small tasks are where
autopilot starts.

## 1. Frame

Ask for the change in one sentence. If the sentence contains "and", it is
two changes. Ask which one goes first. STOP.

## 2. Grill — load the `grilling` skill

Interview one question at a time until these are explicit:

- files to touch
- approach, in the user's words
- what "done" looks like (observable, not "works")
- what is out of scope

Then write the plan back in six lines or fewer and ask for a yes. STOP.

## 3. Read-only pass

Read only the files in the plan. Report anything that contradicts it —
an existing helper, a different pattern already in use, hidden coupling —
in five lines or fewer. Do not edit anything in this phase.
If anything contradicts the plan: STOP for a decision. Otherwise continue.

## 4. Test first — load the `tdd` skill, with one change

Write ONE failing test for the first vertical slice. Show it in full.
STOP. The user approves it, edits it, or rewrites it. Do not touch
implementation until the test has been explicitly approved.

## 5. Implement

Minimum code to make the approved test pass. Stay inside the plan's file
list. No extras, no cleanup, no "while I was here".

## 6. Hand off

Say what changed in one sentence. Then say exactly: `Ready for /hunk review.`
STOP. Do nothing until Hunk comments arrive.

## 7. Address comments — load the `hunk-review` skill

Read the live Hunk session. Address comments one at a time, smallest first.
After each, reply to that comment with what changed. Return to phase 6.

## Rules that override everything above

- Never commit.
- Never start slice two without being asked.
- Never call another user-invoked skill from inside this one.
- If you are about to explain code the user did not ask about, stop instead.
