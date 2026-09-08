/**
 * allow-cmd — /allow: grow the bash allowlist without editing settings.json.
 *
 * @pi-lab/permissions reads its rules from ~/.pi/agent/settings.json once per
 * session. This command appends an allow rule for a bash command prefix so
 * the next session stops asking about it:
 *
 *   /allow                 list rules added through /allow
 *   /allow git commit      allow `git commit ...` (args allowed, but no
 *                          ; | & ` $ < > — the same injection guard the
 *                          hand-written rules use)
 *   /allow ^\s*docker\b    an argument starting with ^ is taken as a raw
 *                          regex, verbatim
 *   /allow rm <n>          remove rule <n> from the /allow list
 *
 * Deny rules sit at priority 10 and always win over these (priority 5), so
 * force pushes, recursive deletes, and sudo stay blocked no matter what is
 * allowed here. New and removed rules apply from the NEXT pi session —
 * the permissions extension only reads settings at session_start.
 *
 * settings.json is copied (not linked) into the config repo, so after
 * adding rules run scripts/sync.sh there to pull them in for committing.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const MARKER = "Allowed via /allow";
/** Argument tail that cannot chain, pipe, substitute, or redirect. */
const SAFE_ARGS = "(\\s+[^;|&`$<>]*)?$";

interface PermissionRule {
	message?: string;
	priority?: number;
	match: { tool: string; params?: { command?: string } };
	action: string;
}

interface Settings {
	permissions?: { rules?: PermissionRule[] };
	[key: string]: unknown;
}

function readSettings(): Settings {
	return JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
}

function writeSettings(settings: Settings): void {
	writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `git commit` -> `^\s*git\s+commit(\s+[^;|&\`$<>]*)?$` */
function prefixToRegex(words: string[]): string {
	return `^\\s*${words.map(escapeRegex).join("\\s+")}${SAFE_ARGS}`;
}

function allowRules(settings: Settings): PermissionRule[] {
	return (settings.permissions?.rules ?? []).filter((r) => r.message === MARKER);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("allow", {
		description: "Allowlist a bash command: /allow <cmd words> | /allow <^regex> | /allow rm <n> | /allow",
		handler: async (args, ctx) => {
			const notify = (text: string, level: "info" | "warning" | "error") => {
				if (ctx.hasUI) ctx.ui.notify(text, level);
			};
			const words = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const settings = readSettings();
			const rules = settings.permissions?.rules;
			if (!rules) {
				notify("settings.json has no permissions.rules block — nothing to append to.", "error");
				return;
			}

			if (words.length === 0) {
				const mine = allowRules(settings);
				if (mine.length === 0) {
					notify("No /allow rules yet. /allow <cmd words> adds one (applies next session).", "info");
					return;
				}
				const lines = mine.map((r, i) => `${i + 1}. ${r.match.params?.command ?? "?"}`);
				lines.push("Remove one with /allow rm <n>. Rules apply from the next session.");
				notify(lines.join("\n"), "info");
				return;
			}

			if (words[0] === "rm") {
				const index = Number(words[1]) - 1;
				const mine = allowRules(settings);
				if (!Number.isInteger(index) || index < 0 || index >= mine.length) {
					notify(`Usage: /allow rm <1-${mine.length || "?"}> (see /allow for the list)`, "error");
					return;
				}
				const target = mine[index];
				settings.permissions!.rules = rules.filter((r) => r !== target);
				writeSettings(settings);
				notify(`Removed: ${target.match.params?.command}. Applies next session.`, "info");
				return;
			}

			// A leading ^ means the user wrote the regex themselves.
			const pattern = args.trim().startsWith("^") ? args.trim() : prefixToRegex(words);
			try {
				// eslint-disable-next-line no-new
				new RegExp(pattern);
			} catch (error) {
				notify(`Not a valid regex: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			if (rules.some((r) => r.match.tool === "bash" && r.match.params?.command === pattern)) {
				notify("An identical rule already exists.", "warning");
				return;
			}

			rules.push({
				message: MARKER,
				priority: 5,
				match: { tool: "bash", params: { command: pattern } },
				action: "allow",
			});
			writeSettings(settings);
			notify(
				`Allowed: ${pattern}\nApplies from the next pi session. Deny rules (priority 10) still win.\nRun scripts/sync.sh in pi-agent-config to commit it.`,
				"info",
			);
		},
	});
}
