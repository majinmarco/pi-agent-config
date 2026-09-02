/**
 * skill-invoke — make skill composition mechanical instead of aspirational.
 *
 * pi has no skill tool. Skills reach the model as name + description +
 * location in the system prompt, and the model is expected to `read` the
 * SKILL.md when a task matches (docs/skills.md, "How Skills Work"). That is
 * a suggestion, not a mechanism: a skill that says "load the grilling skill"
 * is asking the model to volunteer a file read it may simply skip.
 *
 * This registers `invoke_skill`, which dispatches pi's own `/skill:<name>`
 * command through `sendUserMessage({ expandPromptTemplates: true })`. The
 * skill is expanded by pi exactly as if the user had typed the command —
 * same preamble, same relative-path handling — so composed skills run
 * through the real path rather than an approximation of it.
 *
 * Discovery comes from `pi.getCommands()`, so this inherits pi's own search
 * order (`.pi/skills`, `.agents/skills`, `~/.pi/agent/skills`,
 * `~/.agents/skills`, packages, settings) with no second catalogue to drift.
 *
 * Skills marked `disable-model-invocation: true` are refused. pi already
 * hides those from the system prompt because they are the user's to invoke;
 * `getCommands()` lists them anyway, so the check is re-applied here. That
 * keeps a user-invoked orchestrator from pulling in a rival orchestrator —
 * enforced by the tool rather than requested in prose.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";

const SKILL_PREFIX = "skill:";

interface SkillEntry {
	/** Bare skill name, e.g. "grilling". */
	name: string;
	/** Command name as pi knows it, e.g. "skill:grilling" (may carry a collision suffix). */
	command: string;
	description: string;
	path: string;
	scope: string;
	/** Frontmatter says `disable-model-invocation: true` — the user's to invoke, not the model's. */
	userInvokedOnly: boolean;
}

/** Extract the YAML frontmatter block from a SKILL.md, or null when there is none. */
function frontmatter(text: string): string | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	return match ? match[1] : null;
}

/**
 * A skill is user-invoked-only when its frontmatter disables model invocation.
 * Unreadable or malformed files fall back to "invocable" — pi would have
 * listed the command either way, and refusing on a read error would be a
 * confusing failure mode.
 */
function isUserInvokedOnly(path: string): boolean {
	try {
		const block = frontmatter(readFileSync(path, "utf8"));
		if (!block) return false;
		return /^disable-model-invocation:[ \t]*(true|yes)[ \t]*$/im.test(block);
	} catch {
		return false;
	}
}

function listSkills(pi: ExtensionAPI): SkillEntry[] {
	return pi
		.getCommands()
		.filter((command) => command.source === "skill")
		.map((command) => {
			const raw = command.name.startsWith(SKILL_PREFIX)
				? command.name.slice(SKILL_PREFIX.length)
				: command.name;
			const path = command.sourceInfo?.path ?? "";
			return {
				// Drop any collision suffix pi appended ("grilling:1" -> "grilling").
				name: raw.split(":")[0],
				command: command.name,
				description: command.description ?? "",
				path,
				scope: command.sourceInfo?.scope ?? "unknown",
				userInvokedOnly: path ? isUserInvokedOnly(path) : false,
			};
		});
}

function findSkill(skills: SkillEntry[], requested: string): SkillEntry | undefined {
	const wanted = requested.trim().replace(/^\//, "").replace(/^skill:/, "");
	return (
		skills.find((skill) => skill.name === wanted) ??
		skills.find((skill) => skill.name.toLowerCase() === wanted.toLowerCase())
	);
}

/**
 * Descriptions are written for the system prompt and some run to a paragraph.
 * The catalogue is a tool result the model reads to pick one name, so collapse
 * each to a single line — the skill's own text arrives in full once invoked.
 */
function summarize(description: string, limit = 140): string {
	const flat = description.replace(/\s+/g, " ").trim();
	if (flat.length <= limit) return flat;
	const cut = flat.slice(0, limit);
	const boundary = cut.lastIndexOf(" ");
	return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function renderCatalogue(skills: SkillEntry[]): string {
	const invocable = skills.filter((skill) => !skill.userInvokedOnly);
	const userOnly = skills.filter((skill) => skill.userInvokedOnly);
	const lines: string[] = [];

	lines.push(
		invocable.length
			? `Invocable with invoke_skill (${invocable.length}):`
			: "No invocable skills are loaded.",
	);
	for (const skill of invocable) {
		lines.push(`- ${skill.name} — ${summarize(skill.description)}`);
	}
	if (userOnly.length) {
		lines.push("");
		lines.push(
			`User-invoked only, refused by invoke_skill (${userOnly.length}): ${userOnly
				.map((skill) => skill.name)
				.join(", ")}. The user types /skill:<name> for these.`,
		);
	}
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	/** Skills already expanded in this session — their text is still in context. */
	const loaded = new Set<string>();

	pi.on("session_start", async () => {
		loaded.clear();
	});

	pi.registerTool({
		name: "invoke_skill",
		label: "Invoke Skill",
		description:
			"Load and run a named skill's full instructions. Call with no name to list the available skills. " +
			"The skill is expanded through pi's own /skill: command and arrives as the next message; follow it. " +
			"Skills marked disable-model-invocation are refused — those are the user's to invoke.",
		promptSnippet: "Load a named skill's full instructions (list them by calling with no name)",
		promptGuidelines: [
			"Use invoke_skill when a procedure you are following names another skill, instead of reading the SKILL.md by hand or working from memory of what it says.",
			"When invoke_skill refuses a skill as user-invoked, do not read or paraphrase that skill's file — tell the user to run /skill:<name> themselves.",
		],
		parameters: Type.Object({
			name: Type.Optional(
				Type.String({
					description:
						"Skill to invoke, e.g. \"grilling\". Omit to list every skill pi has discovered.",
				}),
			),
			args: Type.Optional(
				Type.String({ description: "Arguments appended to the skill command." }),
			),
			reload: Type.Optional(
				Type.Boolean({
					description:
						"Re-expand a skill already loaded in this session. Default false; only set this when the earlier text has been compacted away.",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const ok = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
			const fail = (text: string) => ({
				content: [{ type: "text" as const, text }],
				details: {},
				isError: true,
			});

			const skills = listSkills(pi);
			const requested = params.name?.trim();

			if (!requested) return ok(renderCatalogue(skills));

			const skill = findSkill(skills, requested);
			if (!skill) {
				return fail(
					`No skill named "${requested}" is loaded.\n\n${renderCatalogue(skills)}`,
				);
			}

			if (skill.userInvokedOnly) {
				return fail(
					`"${skill.name}" is user-invoked only (disable-model-invocation: true). ` +
						`Ask the user to run /skill:${skill.name} themselves. Do not read or paraphrase ${skill.path}.`,
				);
			}

			if (loaded.has(skill.name) && !params.reload) {
				return ok(
					`"${skill.name}" was already expanded in this session — its instructions are above. ` +
						"Follow them; pass reload=true only if they have been compacted out of context.",
				);
			}

			const args = params.args?.trim();
			pi.sendUserMessage(`/${skill.command}${args ? ` ${args}` : ""}`, {
				expandPromptTemplates: true,
				deliverAs: "steer",
			});
			loaded.add(skill.name);

			return ok(
				`Loaded skill "${skill.name}" (${skill.scope}: ${skill.path}). ` +
					"Its full instructions arrive as the next message — follow them before doing anything else.",
			);
		},
	});
}
