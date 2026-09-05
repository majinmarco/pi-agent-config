---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker (edges as text in one file per ticket locally, or native blocking links on a real tracker).
disable-model-invocation: true
---

<!-- Forked from mattpocock/skills (MIT) skills/engineering/to-tickets;
     adds a formal per-ticket schema (type, per-file impact, blockers,
     acceptance criteria) and super-tickets that ship as a unit but are
     split into sub-tickets. -->

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching. You will also need this exploration to fill each ticket's **Impacted files** honestly — a file list guessed without looking is worse than none.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- **Granular beats grand.** One coherent change per ticket; if the description needs an "and" joining two behaviours, split it. Err toward more, smaller tickets — blocking edges keep the order, and a small ticket that lands is worth more than a big one that stalls
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**Super-tickets.** When a slice genuinely must ship as one unit but is too big for a single ticket, make it a **super-ticket** split into **sub-tickets**:

- Sub-tickets take the parent's number with a letter suffix (`03a`, `03b`, …) and carry the full ticket schema each, plus a `**Parent:**` line. They may block each other like any tickets.
- The super-ticket itself (`03`) has `**Type:** super`. It carries the unit-level description and the split rationale, is **blocked by every one of its sub-tickets**, and its own work is integrate, verify end to end, and ship. Its acceptance criteria are the unit's, not any sub-ticket's.
- Because the unit ships at the super-ticket, sub-tickets may share an integration branch when they cannot each stay green alone; green is promised only at the super-ticket.
- Nothing outside the unit may block on a sub-ticket — external tickets block on the super-ticket, which is the only boundary the rest of the graph sees.

Super-tickets are the exception, not the default: most work should be plain tickets. Use one only when "must ship together" is real (a contract change with both sides, a feature useless until all its parts exist), not merely when a ticket feels large — a large ticket that could ship in independent pieces is just several plain tickets.

**Wide refactors** fit the super-ticket shape naturally. A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Sequence it as **expand–contract** inside a super-ticket: an expand sub-ticket adds the new form beside the old so nothing breaks; migrate sub-tickets move the call sites over in batches sized by blast radius (per package, per directory), each blocked by the expand; and the super-ticket itself contracts — deletes the old form once no caller remains — then verifies and ships.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title** and **Type**
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work
- **Files touched**: the impacted files, one line each

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further — and does any split need to become a super-ticket because its parts must ship together?

Iterate until the user approves the breakdown.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the tracker `/setup-matt-pocock-skills` configured; the tickets are the same either way, only the shape of the blocking edges changes:

- **Local files** → write one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first); sub-tickets as `<NN><letter>-<slug>.md` next to their parent. Each file's "Blocked by" lists the ids/titles it depends on. Use the per-ticket file template below: one ticket per file, never a single combined file.
- **A real issue tracker (GitHub, Linear, …)** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the platform's native blocking / sub-issue relationship where it has one — sub-tickets become native sub-issues of the super-ticket where supported; otherwise set each ticket's "Blocked by" (and "Parent") to the referenced issues. Apply the `ready-for-agent` triage label unless instructed otherwise; the tickets are agent-grabbable by construction.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Do NOT close or modify any parent issue.

## Ticket schema

Every ticket — plain, super, or sub — carries the same fields, in this order:

- **Title**: short and descriptive, in the project's domain vocabulary.
- **Type**: one of `feature | bug | refactor | prefactor | chore | super`.
- **Description**: the end-to-end behaviour this ticket makes work, from the user's perspective, not a layer-by-layer implementation list. For a super-ticket: what the unit as a whole delivers, and why it must ship together.
- **Impacted files**: one line per file — its path and what changes in it, with `(new)` for files the ticket creates. Best effort as of writing: paths can go stale, so the implementer treats them as a map, not a contract. If exploration was too shallow to name files honestly, say `to be discovered` rather than guessing.
- **Blocked by**: ticket ids/titles that gate this one, or "None (can start immediately)". A super-ticket is always blocked by all of its sub-tickets.
- **Parent**: sub-tickets only — the super-ticket's id.
- **Status**: `ready-for-agent`.
- **Acceptance criteria**: checkboxes an implementer can verify without asking anyone.

<local-ticket-template>

# <NN>: <Ticket title>

**Type:** feature

**Description:** the end-to-end behaviour this ticket makes work, from the user's perspective.

**Impacted files:**

- `path/to/file.ts` — what changes here
- `path/to/new-file.ts` (new) — what it is for

**Blocked by:** the ids/titles of the tickets that gate this one, or "None (can start immediately)".

**Status:** ready-for-agent

## Acceptance criteria

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

<issue-template>

## Parent

A reference to the parent issue on the tracker — the source issue if the tickets came from one, and/or the super-ticket for a sub-ticket (otherwise omit this section).

## Description

**Type:** feature

The end-to-end behaviour this ticket makes work, from the user's perspective, not layer-by-layer implementation.

## Impacted files

- `path/to/file.ts` — what changes here
- `path/to/new-file.ts` (new) — what it is for

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None (can start immediately)".

</issue-template>

Beyond the Impacted files list, avoid inlining code snippets: they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.
