/**
 * working-anim — a more interesting working/thinking indicator.
 *
 * Replaces pi's default streaming spinner (ctx.ui.setWorkingIndicator) with
 * one of a few animations, themed through the active theme's colors:
 *
 *   scanner  a Larson scanner: a bright head sweeping over a dim track,
 *            with a fading tail (the default)
 *   breath   a slow inhale/exhale pulse — fits the mindful loop
 *   orbit    a quarter-disc orbiting at a steady pace
 *   off      no indicator at all
 *   default  pi's own spinner
 *
 * /anim [scanner|breath|orbit|off|default] switches; bare /anim shows the
 * current mode. Only the streaming indicator is affected — compaction and
 * retry loaders keep pi's builtin styling.
 */

import type { ExtensionAPI, ExtensionContext, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

const MODES = ["scanner", "breath", "orbit", "off", "default"] as const;
type Mode = (typeof MODES)[number];

type ThemeLike = { fg(color: string, text: string): string };

function scannerFrames(theme: ThemeLike): string[] {
	const width = 7;
	// 0..6 then 5..1: the head sweeps right, bounces, sweeps back.
	const sweep = [...Array(width).keys(), ...Array.from({ length: width - 2 }, (_, i) => width - 2 - i)];
	return sweep.map((head) => {
		let frame = "";
		for (let i = 0; i < width; i++) {
			const distance = Math.abs(i - head);
			frame +=
				distance === 0
					? theme.fg("accent", "●")
					: distance === 1
						? theme.fg("muted", "•")
						: theme.fg("dim", "·");
		}
		return frame;
	});
}

function breathFrames(theme: ThemeLike): string[] {
	// One glyph wide so the streaming text never shifts; the breath is the
	// glyph growing and the color warming, then releasing.
	const inhale = [
		theme.fg("dim", "·"),
		theme.fg("dim", "∙"),
		theme.fg("muted", "•"),
		theme.fg("muted", "●"),
		theme.fg("accent", "●"),
		theme.fg("accent", "●"),
	];
	return [...inhale, ...inhale.slice(1, -1).reverse()];
}

function orbitFrames(theme: ThemeLike): string[] {
	return ["◐", "◓", "◑", "◒"].map((glyph) => theme.fg("accent", glyph));
}

function indicatorFor(mode: Mode, theme: ThemeLike): WorkingIndicatorOptions | undefined {
	switch (mode) {
		case "scanner":
			return { frames: scannerFrames(theme), intervalMs: 70 };
		case "breath":
			return { frames: breathFrames(theme), intervalMs: 260 };
		case "orbit":
			return { frames: orbitFrames(theme), intervalMs: 140 };
		case "off":
			return { frames: [] };
		case "default":
			return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	let mode: Mode = "scanner";

	const apply = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWorkingIndicator(indicatorFor(mode, ctx.ui.theme));
	};

	pi.on("session_start", async (_event, ctx) => apply(ctx));

	pi.registerCommand("anim", {
		description: "Working-indicator animation: /anim [scanner|breath|orbit|off|default]",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items = MODES.filter((m) => m.startsWith(prefix)).map((m) => ({ value: m, label: m }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const requested = (args ?? "").trim().toLowerCase();
			if (!requested) {
				ctx.ui.notify(`Working animation: ${mode}`, "info");
				return;
			}
			if (!MODES.includes(requested as Mode)) {
				ctx.ui.notify("Usage: /anim [scanner|breath|orbit|off|default]", "error");
				return;
			}
			mode = requested as Mode;
			apply(ctx);
			ctx.ui.notify(`Working animation → ${mode}`, "info");
		},
	});
}
