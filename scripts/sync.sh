#!/usr/bin/env bash
#
# Pull the live settings files back into the repo so they can be committed.
#
# Everything else is symlinked, so it needs no syncing — editing the live file
# already edits the repo. Only the settings files are copies, because pi
# rewrites them itself (theme changes, lastChangelogVersion, `pi install`).
#
# Usage: scripts/sync.sh [--check]
#
#   --check  report drift and exit non-zero; change nothing (useful in CI)

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK=0
[[ ${1:-} == --check ]] && CHECK=1

pairs=(
	"$HOME/.pi/agent/settings.json:$REPO/pi/agent/settings.json"
)

drift=0
for pair in "${pairs[@]}"; do
	live="${pair%%:*}"
	repo="${pair##*:}"
	if [[ ! -e $live ]]; then
		echo "  ! missing live file: $live"
		continue
	fi
	if cmp -s "$live" "$repo"; then
		echo "  ok       $(basename "$(dirname "$repo")")/$(basename "$repo")"
		continue
	fi
	drift=1
	if (( CHECK )); then
		echo "  drift    $repo"
		diff -u "$repo" "$live" | sed 's/^/    /' || true
	else
		cp "$live" "$repo"
		echo "  updated  $repo"
	fi
done

if (( CHECK )); then
	(( drift )) && { echo "settings differ from the repo — run scripts/sync.sh"; exit 1; }
	echo "settings match the repo."
fi

exit 0
