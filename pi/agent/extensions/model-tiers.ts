/**
 * model-tiers — two model tiers, mechanically routed.
 *
 * SUPER gathers insight, plans, and orchestrates; SUB codes and executes.
 * The split exists in three places and this extension keeps them coherent:
 *
 *   1. `modelTiers` in ~/.pi/agent/settings.json is the source of truth
 *      (`{ "super": "openrouter/z-ai/glm-5.3", "sub": "..." }`).
 *   2. `subagents.defaultModel` is synced to the SUB tier, so every
 *      pi-subagents child without its own model executes on SUB.
 *   3. When an orchestrator skill loads — `tier: super` in frontmatter, or,
 *      by default, any skill whose SKILL.md mentions `invoke_skill` (a skill
 *      that calls other skills) — the session switches to SUPER. That covers
 *      both the user typing /skill:mindful-loop and invoke_skill dispatching
 *      it, because both pass through pi's `input` event before expansion.
 *      `tier: sub` in frontmatter opts a skill out. The switch is one-way:
 *      nothing auto-drops back, because composed skills (tdd inside
 *      mindful-loop) run in the orchestrator's session on purpose.
 *
 * Effort: SUPER runs at max, SUB at medium (high when the model has no
 * medium) — but only when the model's API exposes that level, per pi's
 * thinkingLevelMap. Children get the effort as a suffix baked into
 * subagents.defaultModel; sessions get it via setThinkingLevel on switch.
 *
 * Commands:
 *   /tier                 show both tiers and the detected orchestrator skills
 *   /tier super <model>   set a tier; <model> is provider/id[:thinking] or a
 *   /tier sub <model>     bare id when unique. Rejected unless the model is in
 *                         the registry, has auth, AND answers a live API ping.
 *   /super, /sub          switch this session to that tier's model by hand
 */
import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const TIERS = ["super", "sub"] as const;
const DEFAULTS: Record<Tier, string> = {
	super: "openrouter/z-ai/glm-5.3",
	sub: "openrouter/z-ai/glm-5.3-flash",
};
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const PING_TIMEOUT_MS = 45_000;

type Tier = (typeof TIERS)[number];
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * Effort each tier runs at, first supported level wins: SUPER always max,
 * SUB medium with high as the fallback. Applied only when the model's API
 * actually exposes the level; an explicit :suffix on the tier spec wins.
 */
const TIER_EFFORT: Record<Tier, ThinkingLevel[]> = {
	super: ["max"],
	sub: ["medium", "high"],
};

interface Settings {
	modelTiers?: Partial<Record<Tier, string>>;
	subagents?: { defaultModel?: string; [key: string]: unknown };
	[key: string]: unknown;
}

function readSettings(): Settings {
	return JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
}

function writeSettings(settings: Settings): void {
	writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

function tierSpec(settings: Settings, tier: Tier): string {
	return settings.modelTiers?.[tier] ?? DEFAULTS[tier];
}

/** "provider/id:high" -> { base: "provider/id", thinking: "high" }. */
function splitThinking(spec: string): { base: string; thinking?: ThinkingLevel } {
	const colon = spec.lastIndexOf(":");
	if (colon > 0) {
		const suffix = spec.slice(colon + 1) as ThinkingLevel;
		if (THINKING_LEVELS.includes(suffix)) return { base: spec.slice(0, colon), thinking: suffix };
	}
	return { base: spec };
}

interface ResolvedTier {
	model: NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>;
	thinking?: ThinkingLevel;
	/** Fully qualified provider/id plus any thinking suffix — what gets persisted. */
	canonical: string;
}

/**
 * Levels the model's API actually supports, following pi's thinkingLevelMap
 * tristate: null marks a level unsupported, xhigh/max exist only when mapped
 * to an explicit value, and an omitted map means the standard levels through
 * high. Non-reasoning models support nothing beyond off.
 */
function supportedLevels(model: ResolvedTier["model"]): ThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	const map = (model as { thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>> }).thinkingLevelMap;
	if (!map) return THINKING_LEVELS.filter((level) => level !== "xhigh" && level !== "max");
	return THINKING_LEVELS.filter((level) => {
		const mapped = map[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== undefined;
		return true;
	});
}

/**
 * Effort a tier runs its model at: an explicit :suffix on the tier spec wins,
 * otherwise the first TIER_EFFORT preference the API supports. Undefined when
 * the model offers no matching effort control — then nothing is set.
 */
function tierEffort(tier: Tier, resolved: ResolvedTier): ThinkingLevel | undefined {
	if (resolved.thinking) return resolved.thinking;
	const supported = supportedLevels(resolved.model);
	return TIER_EFFORT[tier].find((level) => supported.includes(level));
}

/**
 * Resolve a model spec against the live registry. Exact `provider/id` wins;
 * a bare id resolves only when exactly one provider exposes it. Returns an
 * error string instead of guessing.
 */
function resolveSpec(spec: string, ctx: ExtensionContext): ResolvedTier | string {
	const { base, thinking } = splitThinking(spec.trim());
	const available = ctx.modelRegistry.getAvailable();
	let matches = available.filter((m) => `${m.provider}/${m.id}` === base);
	if (matches.length === 0) matches = available.filter((m) => m.id === base);
	if (matches.length === 0) return `"${base}" is not in the model registry (check /tier against the /models list).`;
	if (matches.length > 1) {
		const ids = matches.map((m) => `${m.provider}/${m.id}`).join(", ");
		return `"${base}" is ambiguous: ${ids}. Use the full provider/id form.`;
	}
	const model = ctx.modelRegistry.find(matches[0].provider, matches[0].id);
	if (!model) return `"${base}" vanished from the registry between lookup and load.`;
	const canonical = `${matches[0].provider}/${matches[0].id}${thinking ? `:${thinking}` : ""}`;
	return { model, thinking, canonical };
}

/** One tiny live completion. Anything but a clean answer rejects the model. */
async function pingModel(resolved: ResolvedTier, ctx: ExtensionContext): Promise<string | null> {
	if (!ctx.modelRegistry.hasConfiguredAuth(resolved.model)) {
		return `no authentication configured for ${resolved.canonical}.`;
	}
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error(`no response within ${PING_TIMEOUT_MS / 1000}s`)), PING_TIMEOUT_MS),
	);
	try {
		const response = await Promise.race([
			ctx.modelRegistry.complete(
				resolved.model,
				{
					messages: [
						{
							role: "user" as const,
							content: [{ type: "text" as const, text: "Reply with the single word OK." }],
							timestamp: Date.now(),
						},
					],
				},
				{ cacheRetention: "none", sessionId: uuidv7() },
			),
			timeout,
		]);
		if (response.stopReason === "error" || response.stopReason === "aborted") {
			return `API call failed: ${response.errorMessage ?? response.stopReason}`;
		}
		return null;
	} catch (error) {
		return `API call failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function frontmatter(text: string): string | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	return match ? match[1] : null;
}

/**
 * A skill's tier. Explicit `tier:` frontmatter wins; otherwise a skill whose
 * body mentions invoke_skill composes other skills, which is orchestration.
 */
function skillTier(path: string): Tier | null {
	try {
		const text = readFileSync(path, "utf8");
		const block = frontmatter(text);
		const declared = block && /^tier:[ \t]*(super|sub)[ \t]*$/im.exec(block);
		if (declared) return declared[1] as Tier;
		return text.includes("invoke_skill") ? "super" : null;
	} catch {
		return null;
	}
}

export default function (pi: ExtensionAPI) {
	const notify = (ctx: ExtensionContext, text: string, level: "info" | "warning" | "error") => {
		if (ctx.hasUI) ctx.ui.notify(text, level);
	};

	async function switchTo(tier: Tier, ctx: ExtensionContext): Promise<void> {
		const spec = tierSpec(readSettings(), tier);
		const resolved = resolveSpec(spec, ctx);
		if (typeof resolved === "string") {
			notify(ctx, `${tier.toUpperCase()} tier ${resolved}`, "error");
			return;
		}
		if (!(await pi.setModel(resolved.model))) {
			notify(ctx, `No API key for ${resolved.canonical}.`, "error");
			return;
		}
		const effort = tierEffort(tier, resolved);
		if (effort) pi.setThinkingLevel(effort);
		notify(
			ctx,
			`Session model → ${tier.toUpperCase()} (${resolved.canonical}${effort ? `, effort ${effort}` : ""})`,
			"info",
		);
	}

	/** Skills that will trigger the SUPER switch, for /tier display. */
	function orchestratorSkills(): string[] {
		return pi
			.getCommands()
			.filter((c) => c.source === "skill" && c.sourceInfo?.path)
			.filter((c) => skillTier(c.sourceInfo!.path!) === "super")
			.map((c) => c.name.replace(/^skill:/, "").split(":")[0]);
	}

	pi.registerCommand("tier", {
		description:
			"Show or set the SUPER/SUB model tiers. Usage: /tier | /tier super <provider/id[:thinking]> | /tier sub <...>",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			if (prefix.includes(" ")) return null;
			const items = TIERS.filter((t) => t.startsWith(prefix)).map((t) => ({ value: `${t} `, label: t }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const settings = readSettings();

			if (parts.length === 0) {
				const lines = TIERS.map((tier) => {
					const spec = tierSpec(settings, tier);
					const resolved = resolveSpec(spec, ctx);
					const state =
						typeof resolved === "string"
							? `BROKEN — ${resolved}`
							: `effort ${tierEffort(tier, resolved) ?? "unavailable in API"}`;
					return `${tier.toUpperCase()}: ${spec} (${state})`;
				});
				const skills = orchestratorSkills();
				lines.push(`Orchestrator skills (auto-SUPER): ${skills.length ? skills.join(", ") : "none detected"}`);
				notify(ctx, lines.join("\n"), "info");
				return;
			}

			const tier = parts[0] as Tier;
			if (parts.length !== 2 || !TIERS.includes(tier)) {
				notify(ctx, "Usage: /tier super <provider/id[:thinking]> | /tier sub <provider/id[:thinking]>", "error");
				return;
			}

			const resolved = resolveSpec(parts[1], ctx);
			if (typeof resolved === "string") {
				notify(ctx, `Rejected: ${resolved}`, "error");
				return;
			}
			notify(ctx, `Validating ${resolved.canonical} with a live API call…`, "info");
			const failure = await pingModel(resolved, ctx);
			if (failure) {
				notify(ctx, `Rejected: ${failure} ${tier.toUpperCase()} tier unchanged.`, "error");
				return;
			}

			const effort = tierEffort(tier, resolved);
			settings.modelTiers = { ...settings.modelTiers, [tier]: resolved.canonical };
			if (tier === "sub") {
				// Children read the effort from the model-string suffix, so the
				// tier's effective effort is baked into subagents.defaultModel.
				const base = resolved.canonical.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");
				settings.subagents = {
					...settings.subagents,
					defaultModel: `${base}${effort ? `:${effort}` : ""}`,
				};
			}
			writeSettings(settings);
			notify(
				ctx,
				`${tier.toUpperCase()} tier → ${resolved.canonical} (effort ${effort ?? "unavailable in API"})` +
					(tier === "sub" ? ` — subagents.defaultModel synced to ${settings.subagents?.defaultModel}` : ""),
				"info",
			);
		},
	});

	pi.registerCommand("super", {
		description: "Switch this session to the SUPER tier model",
		handler: async (_args, ctx) => switchTo("super", ctx),
	});

	pi.registerCommand("sub", {
		description: "Switch this session to the SUB tier model",
		handler: async (_args, ctx) => switchTo("sub", ctx),
	});

	pi.on("input", async (event, ctx) => {
		const text = event.text.trim();
		if (!text.startsWith("/skill:")) return { action: "continue" as const };
		const name = text.slice("/skill:".length).split(/\s/)[0];
		const command = pi
			.getCommands()
			.find((c) => c.source === "skill" && (c.name === `skill:${name}` || c.name.startsWith(`skill:${name}:`)));
		const path = command?.sourceInfo?.path;
		if (!path || skillTier(path) !== "super") return { action: "continue" as const };

		const spec = tierSpec(readSettings(), "super");
		const resolved = resolveSpec(spec, ctx);
		if (typeof resolved === "string") {
			notify(ctx, `SUPER tier ${resolved} Staying on ${ctx.model?.id ?? "current model"}.`, "warning");
			return { action: "continue" as const };
		}
		const alreadyOn = ctx.model && `${ctx.model.provider}/${ctx.model.id}` === `${resolved.model.provider}/${resolved.model.id}`;
		if (!alreadyOn) {
			if (!(await pi.setModel(resolved.model))) {
				notify(ctx, `SUPER switch failed: no API key for ${resolved.canonical}.`, "warning");
				return { action: "continue" as const };
			}
			const effort = tierEffort("super", resolved);
			if (effort) pi.setThinkingLevel(effort);
			notify(
				ctx,
				`Orchestrator skill "${name}" → SUPER model (${resolved.canonical}${effort ? `, effort ${effort}` : ""})`,
				"info",
			);
		}
		return { action: "continue" as const };
	});
}
