# Working agreement

## Before you edit

- I supply the plan: files to touch, approach, expected shape of the diff.
  If I haven't supplied it, ask for it. Do not infer it and proceed.
- If the task is ambiguous, ask one question and stop. Do not guess.

## While you work

- One commit-sized change per turn. Finish it and stop. Do not chain into
  the next obvious thing.
- Scope is exactly what I stated. No new dependencies, no new files, no
  drive-by refactors, no renames I didn't ask for.
- Tests: write the failing test first, then stop and show it to me. I
  approve or rewrite it before you implement. Never write the test and the
  implementation in the same turn.
- Prefer editing existing code over adding abstraction. If you think a new
  layer is needed, say so and stop.

## After you edit

- Summarize what changed in one or two sentences. Do not re-explain the code.
- Do not commit. I review in Hunk and commit myself.
- When I leave inline comments in a live Hunk session, load the hunk-review
  skill, read my comments, and address them one at a time — smallest first.
  Reply to each comment with what you changed.

## Never

- Never run git commands that rewrite or discard history.
- Never say a change is done without stating what you did not verify.
