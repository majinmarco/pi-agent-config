#!/usr/bin/env bash
#
# Link this repo into place as the live pi configuration.
#
# Everything hand-authored here is symlinked, so editing the live file and
# editing the repo are the same act and `git status` is the truth about what
# has changed. Settings files are the exception: pi rewrites them (theme,
# lastChangelogVersion), so they are copied on a fresh machine and left alone
# afterwards — use scripts/sync.sh to pull live changes back here.
#
# Idempotent. Run it again after adding a skill or updating an upstream source.
#
# Usage:
#   ./install.sh [--dry-run] [--claude]
#
#   --dry-run  print what would happen, change nothing
#   --claude   also link the portable skills into ~/.claude/skills, which
#              Claude Code reads instead of ~/.agents/skills
#
# Environment:
#   POCOCK_SKILLS  clone of github.com/mattpocock/skills (default ~/development/skills)

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POCOCK_SKILLS="${POCOCK_SKILLS:-$HOME/development/skills}"
OMARCHY_SKILLS="/usr/share/omarchy/default/agents/skills"
AGENT_HOME="$HOME/.pi/agent"
AGENTS_SKILLS="$HOME/.agents/skills"
CLAUDE_SKILLS="$HOME/.claude/skills"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUPS="$HOME/.pi/agent/pre-install-backups/$STAMP"

DRY_RUN=0
LINK_CLAUDE=0
for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=1 ;;
		--claude) LINK_CLAUDE=1 ;;
		-h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "unknown argument: $arg" >&2; exit 2 ;;
	esac
done

warnings=()
note()  { printf '  %s\n' "$*"; }
warn()  { warnings+=("$*"); printf '  ! %s\n' "$*"; }
run()   { if (( DRY_RUN )); then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }

# .../installs/<tool>/<version>/rest -> .../installs/<tool>/latest/rest when that
# alias exists, so a version bump does not dangle the link.
resolve_latest() {
	local path="$1" candidate
	if [[ $path =~ ^(.*/installs/[^/]+)/[^/]+/(.*)$ ]]; then
		candidate="${BASH_REMATCH[1]}/latest/${BASH_REMATCH[2]}"
		[[ -e $candidate ]] && { printf '%s\n' "$candidate"; return; }
	fi
	printf '%s\n' "$path"
}

# Symlink $2 -> $1, moving any real file or directory already there aside.
link() {
	local src="$1" dest="$2"
	if [[ ! -e $src ]]; then
		warn "missing source, skipped: $src"
		return
	fi
	if [[ -L $dest ]]; then
		[[ "$(readlink "$dest")" == "$src" ]] && { note "ok       $dest"; return; }
		run rm -f "$dest"
	elif [[ -e $dest ]]; then
		# Outside every skill/extension search path, so the displaced copy
		# cannot come back as a duplicate skill name.
		run mkdir -p "$BACKUPS"
		run mv "$dest" "$BACKUPS/$(basename "$dest")"
		warn "moved existing $dest -> $BACKUPS/$(basename "$dest")"
	fi
	run mkdir -p "$(dirname "$dest")"
	run ln -sfn "$src" "$dest"
	note "linked   $dest"
}

# Copy $1 -> $2 only when absent; report a drift instead of overwriting.
seed() {
	local src="$1" dest="$2"
	if [[ ! -e $dest ]]; then
		run mkdir -p "$(dirname "$dest")"
		run cp "$src" "$dest"
		note "copied   $dest"
	elif cmp -s "$src" "$dest"; then
		note "ok       $dest"
	else
		warn "differs from repo, left alone: $dest (run scripts/sync.sh to capture it)"
	fi
}

echo "==> extensions"
for ext in "$REPO"/pi/agent/extensions/*.ts; do
	[[ -e $ext ]] || continue
	link "$ext" "$AGENT_HOME/extensions/$(basename "$ext")"
done

echo "==> hand-authored skills"
for skill in "$REPO"/agents/skills/*/; do
	[[ -d $skill ]] || continue
	link "${skill%/}" "$AGENTS_SKILLS/$(basename "${skill%/}")"
done

echo "==> upstream skills"
while IFS=$'\t' read -r name source path; do
	[[ -z ${name:-} || $name == \#* ]] && continue
	case "$source" in
		pocock)
			if [[ ! -d $POCOCK_SKILLS ]]; then
				warn "no clone at $POCOCK_SKILLS — git clone https://github.com/mattpocock/skills"
				continue
			fi
			link "$POCOCK_SKILLS/$path" "$AGENTS_SKILLS/$name"
			;;
		hunk)
			if ! command -v hunk >/dev/null 2>&1; then
				warn "hunk not on PATH, skipped skill: $name"
				continue
			fi
			skill_md="$(resolve_latest "$(hunk skill path "$name")")"
			run mkdir -p "$AGENTS_SKILLS/$name"
			link "$skill_md" "$AGENTS_SKILLS/$name/SKILL.md"
			;;
		omarchy)
			link "$OMARCHY_SKILLS/$path" "$AGENTS_SKILLS/$name"
			;;
		*)
			warn "unknown source '$source' for skill $name"
			;;
	esac
done < "$REPO/skills-upstream.tsv"

echo "==> agent files"
link "$REPO/pi/agent/AGENTS.md" "$AGENT_HOME/AGENTS.md"
for agent in "$REPO"/pi/agent/agents/*.md; do
	[[ -e $agent ]] || continue
	link "$agent" "$AGENT_HOME/agents/$(basename "$agent")"
done
for theme in "$REPO"/pi/agent/themes/*.json; do
	[[ -e $theme ]] || continue
	link "$theme" "$AGENT_HOME/themes/$(basename "$theme")"
done

echo "==> settings (copied, not linked — pi rewrites these)"
seed "$REPO/pi/agent/settings.json" "$AGENT_HOME/settings.json"

if (( LINK_CLAUDE )); then
	echo "==> claude code skills"
	# Claude Code reads only ~/.claude/skills; it does not know about ~/.agents.
	# code-review is excluded: Claude Code ships a built-in /code-review and two
	# skills with one name have no defined winner.
	for skill in "$AGENTS_SKILLS"/*/; do
		name="$(basename "${skill%/}")"
		[[ $name == code-review ]] && { note "skipped  code-review (collides with Claude Code's built-in)"; continue; }
		link "$(readlink -f "${skill%/}")" "$CLAUDE_SKILLS/$name"
	done
fi

echo "==> duplicate skill names"
# pi searches .pi/skills, .agents/skills, ~/.pi/agent/skills, ~/.agents/skills and
# keeps the FIRST match on a name collision, silently.
if [[ -d $AGENT_HOME/skills ]]; then
	for skill in "$AGENT_HOME"/skills/*/; do
		[[ -d $skill ]] || continue
		name="$(basename "${skill%/}")"
		if [[ -e "$AGENTS_SKILLS/$name" ]]; then
			warn "'$name' exists in both ~/.pi/agent/skills and ~/.agents/skills; pi keeps the first"
		fi
	done
fi

echo
if (( ${#warnings[@]} )); then
	printf 'done, with %d warning(s):\n' "${#warnings[@]}"
	printf '  ! %s\n' "${warnings[@]}"
else
	echo "done."
fi
if (( DRY_RUN )); then
	echo "(dry run — nothing was changed)"
fi
exit 0
