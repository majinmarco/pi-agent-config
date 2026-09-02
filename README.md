# pi-agent-config

My configuration for the [pi coding agent](https://github.com/earendil-works/pi):
permissions, working agreement, one subagent, one extension, and the skills
that make up a deliberately human-in-the-loop workflow.

The organising idea is that **the human is the reviewer**. The agent plans with
me, writes one failing test, gets it approved, implements the minimum, and hands
the diff to [Hunk](https://hunkdiff.com) for me to read. It never commits.

```
install.sh                     link this repo into place (idempotent)
scripts/sync.sh                pull live settings back here for committing
skills-upstream.tsv            skills used but not vendored, and where they come from

agents/skills/                 hand-authored skills, linked to ~/.agents/skills
  mindful-loop/                the orchestrator: one commit, seven stops

pi/agent/
  settings.json                permissions and packages (copied, not linked)
  AGENTS.md                    working agreement, loaded into every session
  agents/hunk-reviewer.md      read-only second reviewer (pi-subagents)
  extensions/skill-invoke.ts   the invoke_skill tool
  themes/                      terminal theme
```

## Install

```bash
git clone <this repo> ~/development/pi-agent-config
cd ~/development/pi-agent-config
./install.sh --dry-run     # see what it would do
./install.sh
```

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
| [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) | grilling, grill-me, grill-with-docs, teach, tdd, diagnosing-bugs, domain-modeling, to-tickets, implement, code-review | a clone at `$POCOCK_SKILLS`, default `~/development/skills` |
| [hunk](https://hunkdiff.com) | hunk-review | ships inside the binary; path from `hunk skill path` |
| [Omarchy](https://omarchy.org) | omarchy, diagnose-crash | `/usr/share/omarchy/default/agents/skills` |

This keeps the repo publishable without redistributing anyone's work, and means
`git pull` in the upstream clone updates the skills in place.

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

## Notes for anyone borrowing this

- **Claude Code does not read `~/.agents/skills`.** Only `~/.claude/skills`.
  `install.sh --claude` links them across, skipping `code-review` because Claude
  Code ships its own `/code-review` and two skills with one name have no winner.
- **`~/.pi/agent/skills/` is pi-private; `~/.agents/skills/` is the cross-agent
  convention** that `npx skills`, Cline, and others read. Never put the same
  skill in both — pi keeps the first it finds and says nothing.
- The permission rules in `settings.json` deny force-push, history destruction,
  recursive deletes, and `sudo` outright, and ask before every other bash, write,
  and edit. Note that `git commit` is only *ask* — "never commit" is a rule the
  skills state, not something the harness enforces.
