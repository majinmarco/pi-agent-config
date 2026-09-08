# pi-agent-config

My configuration for the [pi coding agent](https://github.com/earendil-works/pi):
permissions, working agreement, one subagent, one extension, and the skills
that make up a deliberately human-in-the-loop workflow.

The organising idea is that **the human is the reviewer**. The agent plans with
me, proves each slice red-then-green on its own (testing is autopilot),
implements the minimum, and hands the diff to [Hunk](https://hunkdiff.com) for
me to read. It never commits.

```
install.sh                     link this repo into place (idempotent)
scripts/sync.sh                pull live settings back here for committing
skills-upstream.tsv            skills used but not vendored, and where they come from
amos-upstream.tsv              extensions linked out of a pi-config clone, same idea

agents/skills/                 hand-authored skills, linked to ~/.agents/skills
  mindful-loop/                the orchestrator: one commit, seven stops
  grilling/                    fork of mattpocock's grilling (MIT) that asks its
                               rounds through question_round instead of a wall of text
  grill-me/                    user-invoked pointer to grilling
  to-tickets/                  fork of mattpocock's to-tickets (MIT) with a formal
                               ticket schema and super-/sub-tickets
  ticket-loop/                 driver: idea → grill → to-tickets → mindful-loop queue

pi/agent/
  settings.json                permissions and packages (copied, not linked)
  models.json                  model overrides (caps glm-5.3 max_tokens for
                               OpenRouter's worst-case credit pre-auth)
  AGENTS.md                    working agreement, loaded into every session
  agents/hunk-reviewer.md      read-only second reviewer (pi-subagents)
  themes/                      terminal theme
  extensions/
    skill-invoke.ts            the invoke_skill tool
    model-tiers.ts             SUPER/SUB model tiers and the /tier command
    question-round.ts          the question_round wizard UI (used by grilling)
    custom-header.ts           startup header
    plan-approval.ts           the plan_approval panel (mindful-loop phase 2)
    perm-why.ts                one-line gpt-oss-20b explanation beside permission asks
    loop-status.ts             live mindful-loop widget, /loop-status panel,
                               and ticket autocomplete for /skill:mindful-loop
    working-anim.ts            animated working indicator (/anim to switch)
    allow-cmd.ts               /allow — append bash allowlist rules from chat
    hunk-flow.ts               /skill:hunk-review autopilot: opens a Hunk tmux
                               pane if needed, auto-runs /hunk review after
```

Four more extensions and one skill are installed from a clone rather than kept
here — see [What is here and what is only referenced](#what-is-here-and-what-is-only-referenced).

## Install

```bash
git clone https://github.com/mattpocock/skills       ~/development/skills
git clone https://github.com/amosblomqvist/pi-config ~/development/pi-config

git clone <this repo> ~/development/pi-agent-config
cd ~/development/pi-agent-config
./install.sh --dry-run     # see what it would do
./install.sh

# The browser extension is the only piece with dependencies of its own.
cd ~/development/pi-config/extensions/browser
npm install && ./node_modules/.bin/playwright-core install chromium   # ~115 MB, once per machine
```

Both clone paths are overridable: `POCOCK_SKILLS` and `AMOS_CONFIG`.

Hand-authored files are **symlinked**, so editing the live file and editing the
repo are the same act, and `git status` is the truth about what has changed.
`settings.json` is the exception — pi rewrites it (theme, `lastChangelogVersion`,
`pi install`), so it is copied on a fresh machine and never overwritten
afterwards. `scripts/sync.sh` pulls live changes back; `scripts/sync.sh --check`
reports drift without touching anything.

Anything the installer displaces is moved to
`~/.pi/agent/pre-install-backups/<timestamp>/` — deliberately outside every
skill search path, because a displaced copy of `grilling/` sitting next to
`grilling/` is a second skill with the same name, and pi resolves that collision
silently by keeping whichever it finds first.

## What is here and what is only referenced

Skills belonging to other people are **not vendored**. `install.sh` links them
from wherever their owner installs them, listed in `skills-upstream.tsv`:

| Source | Skills | Where it comes from |
|---|---|---|
| [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) | grill-with-docs, teach, tdd, diagnosing-bugs, domain-modeling, implement, code-review | a clone at `$POCOCK_SKILLS`, default `~/development/skills` |
| [hunk](https://hunkdiff.com) | hunk-review | ships inside the binary; path from `hunk skill path` |
| [Omarchy](https://omarchy.org) | omarchy, diagnose-crash | `/usr/share/omarchy/default/agents/skills` |

`grilling`, `grill-me`, and `to-tickets` used to be in that list; they are now
hand-authored forks in `agents/skills/` (MIT permits it, with credit in each
`SKILL.md`). The forked grilling delivers its question rounds through the
`question_round` UI below instead of numbered questions in a message; the
forked to-tickets writes every ticket to a formal schema (type, per-file
impact, blockers, acceptance criteria) and can split a
must-ship-together slice into a **super-ticket** whose sub-tickets (`03a`,
`03b`, …) all block the super, which is the final integrate-and-ship step —
`ticket-loop`'s queue and `mindful-loop` drive both shapes unchanged.

This keeps the repo publishable without redistributing anyone's work, and means
`git pull` in the upstream clone updates the skills in place.

Extensions follow the same rule, in `amos-upstream.tsv`:

| Source | What | Where it comes from |
|---|---|---|
| [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config) | ask-user-question, prompt-snippets, browser, analyze-sessions | a clone at `$AMOS_CONFIG`, default `~/development/pi-config` |

That repo says to copy the pieces you want, but it carries **no LICENSE**, so its
files are all-rights-reserved by default and redistributing them from a public
repo of mine is not mine to do. They are linked out of a clone instead. The one
exception is `custom-header.ts`, which is written here from pi's own documented
`ctx.ui.setHeader` API — a header is a thing you edit, and a symlink into
somebody else's git clone is a bad place to edit anything.

Real pi packages are installed with `pi install` and recorded in `settings.json`,
which is versioned here:
[`observational-memory`](https://github.com/amosblomqvist/pi-observational-memory)
(MIT), `pi-hunk`, `@pi-lab/permissions`, `pi-subagents`, and
[`pi-better-edit`](https://github.com/Rianico/pi-better-edit) (MIT), which
replaces the built-in `read`/`edit` tools with hash-anchored versions (plus
`read_skill` for plain skill-file reads and a persisted `undo_last_edit`).
pi-better-edit is installed from a local checkout at
`~/development/pi-better-edit` (branch `bun-sqlite-compat`), not npm: the
published package imports `node:sqlite`, which pi's Bun-based runtime does
not provide, so the checkout patches in a `bun:sqlite` fallback until that
lands upstream.

Credentials, sessions, and the model cache are gitignored. `auth.json` in
particular must never land here.

## Why `invoke_skill` exists

pi has no skill tool. Skills reach the model as name, description, and location
in the system prompt, and the model is expected to `read` the `SKILL.md` when a
task matches — pi's own docs note that "models don't always do this". `/skill:`
is expanded on *user* input, so the agent cannot type it.

That makes skill composition aspirational: a skill saying "load the `grilling`
skill" is asking the model to volunteer a file read it may quietly skip, and the
loop then runs on a paraphrase of a procedure instead of the procedure.

`pi/agent/extensions/skill-invoke.ts` registers `invoke_skill`, which dispatches
pi's own `/skill:<name>` through `sendUserMessage({ expandPromptTemplates: true })`.
The skill is expanded by pi exactly as if I had typed the command, so composition
runs through the real path. Discovery comes from `pi.getCommands()`, so it
inherits pi's own search order with no second catalogue to drift out of sync.

It refuses any skill whose frontmatter sets `disable-model-invocation: true`.
Those are mine to invoke, and refusing them mechanically is what stops a
user-invoked orchestrator from pulling in a rival one — `implement`, for
instance, ends by committing.

```
invoke_skill()                     list what pi has discovered
invoke_skill(name="grilling")      expand and run that skill
invoke_skill(name=…, reload=true)  re-expand after compaction dropped it
```

## The extensions, and why each one is here

| Extension | What it adds | Default |
|---|---|---|
| `skill-invoke.ts` | `invoke_skill` — see above | always on |
| `model-tiers.ts` | Two model tiers: SUPER (`openrouter/z-ai/glm-5.3`, effort max) plans and orchestrates, SUB (`openrouter/z-ai/glm-5.3-flash`, effort medium or high when the API has no medium) executes; effort applies only when the model's API exposes it. `/tier super\|sub <model>` changes one — rejected unless the model is in the registry, has auth, and answers a live API ping. The SUB tier is mirrored into `subagents.defaultModel`, so pi-subagents children execute on SUB; loading an orchestrator skill (frontmatter `tier: super`, or by default any SKILL.md that mentions `invoke_skill`) switches the session to SUPER. `/super` and `/sub` switch by hand | always on |
| `ask-user-question.ts` | `ask_user_question`: a real single-question UI (free text, single- or multi-select, always with an "Other" escape) that blocks the turn until answered | always on |
| `question-round.ts` | `question_round`: a whole round of questions as a tabbed wizard — one question on screen at a time, ■/□ progress, per-option descriptions and a ★ recommended marker, write-in escape everywhere, a review screen before submit, and optional per-question **exhibits** (preformatted monospace panels: ASCII diagrams, decision trees, comparison tables). Cancelling reports which questions were already answered. Serializes with `ask_user_question` on a shared UI lock. Written here from pi's documented `ctx.ui.custom()` API, starting from the MIT `questionnaire.ts` example that ships with pi | always on |
| `prompt-snippets/` | `alt+s` / `/snippets`: toggle small behaviour rules onto the next message only — "verify, don't assume", "diagnose, don't fix", "delegate exploration". Resets after every send | always on, nothing active |
| `custom-header.ts` | The startup header. `/builtin-header` restores pi's own | always on |
| `working-anim.ts` | Replaces the streaming spinner with a themed animation — Larson scanner by default; `/anim breath\|orbit\|off\|default` to switch | always on |
| `allow-cmd.ts` | `/allow <cmd words>` appends a bash allow rule to settings.json (args permitted, shell metacharacters not); `/allow` lists, `/allow rm <n>` removes. Rules load at session_start, so changes apply next session; priority-10 denies always win | always on |
| `hunk-flow.ts` | Arms on `/skill:hunk-review`: if the repo has no live Hunk session and pi is inside tmux, opens `hunk diff --watch` in a side pane and waits for the daemon to see it; when the response settles (agent_settled), dispatches `/hunk review` as if typed | always on |
| `browser/` | `browser_goto`, `browser_eval`, `browser_console`, `browser_network`, `browser_fill`, `browser_click`, `browser_screenshot` — a real Chromium the agent can drive | **off**; `/browser on` |
| `observational-memory` | Observers distil the conversation into a ledger; compaction renders it verbatim instead of asking a model to summarise; a consolidator promotes the oldest into durable `.memory/<session>/` files | **off**; `/om on` |

Adding your own prompt snippet means writing into the pi-config clone —
`prompt-snippets` resolves `snippets/` relative to the realpath of its own
`index.ts`, so a link cannot redirect it.

`ask_user_question` is the one that changes how the other skills feel. Before it,
a skill asking the human something could only end its turn and hope; now the
question is a tool call with a real answer coming back, which is what `grilling`
and phase 2 of `mindful-loop` were always describing.

`browser/` and `observational-memory` are both off by default and cost nothing
until switched on: the browser tools are registered but invisible to the model,
and every observational-memory hook and subprocess returns immediately while the
gate is off. `observational-memory` spawns `pi` subprocesses when on — it
defaults to `openrouter` / `z-ai/glm-5.3` for both workers, and shows the running
spend in the footer and in `/om:status`.

## Notes for anyone borrowing this

- **Claude Code does not read `~/.agents/skills`.** Only `~/.claude/skills`.
  `install.sh --claude` links them across, skipping `code-review` because Claude
  Code ships its own `/code-review` and two skills with one name have no winner.
- **`~/.pi/agent/skills/` is pi-private; `~/.agents/skills/` is the cross-agent
  convention** that `npx skills`, Cline, and others read. Never put the same
  skill in both — pi keeps the first it finds and says nothing.
- **`pi-interactive-subagents` cannot be installed alongside `pi-subagents`.**
  Both register a tool named `subagent`, and pi does not merge or shadow on a
  tool-name clash — it fails the whole extension load
  (`Tool "subagent" conflicts with ...`), taking `bg_wait`, every `subagents-*`
  command, and the hunk-reviewer agent with it. Pick one.
- The permission rules in `settings.json` deny force-push, history destruction,
  recursive deletes, and `sudo` outright, and ask before every other bash, write,
  and edit. Note that `git commit` is only *ask* — "never commit" is a rule the
  skills state, not something the harness enforces.
