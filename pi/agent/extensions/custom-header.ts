/**
 * Startup header.
 *
 * Replaces pi's built-in header via `ctx.ui.setHeader`. Everything worth
 * changing is in `buildHeader()` below — edit it and run `/reload`.
 * `/builtin-header` puts pi's own header back for the current session.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION, keyHint, rawKeyHint } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

/** Set to true to list the keybindings under the logo, as pi's own header does. */
const SHOW_HINTS = false;

const LOGO = [
	"██████████████████████████",
	"██████████████████████████",
	"     ████        ████     ",
	"     ████        ████     ",
	"     ████        ████     ",
	"     ████        ████     ",
	"   ████████    ████████   ",
];

function buildHeader(theme: Theme): string[] {
	const lines = [
		"",
		...LOGO.map((line) => theme.bold(theme.fg("success", line))),
		"",
		theme.bold(theme.fg("accent", "pi")) + theme.fg("dim", ` v${VERSION}`),
	];

	if (SHOW_HINTS) {
		lines.push(
			rawKeyHint("escape", "to interrupt"),
			rawKeyHint("ctrl+c", "to clear"),
			rawKeyHint("ctrl+c twice", "to exit"),
			rawKeyHint("ctrl+d", "to exit (empty)"),
			rawKeyHint("ctrl+z", "to suspend"),
			keyHint("deleteToLineEnd", "to delete to end"),
			rawKeyHint("shift+tab", "to cycle thinking level"),
			rawKeyHint("ctrl+p/shift+ctrl+p", "to cycle models"),
			rawKeyHint("ctrl+l", "to select model"),
			rawKeyHint("ctrl+o", "to expand tools"),
			rawKeyHint("ctrl+t", "to expand thinking"),
			rawKeyHint("ctrl+g", "for external editor"),
			rawKeyHint("/", "for commands"),
			rawKeyHint("!", "to run bash"),
			rawKeyHint("!!", "to run bash (no context)"),
			rawKeyHint("alt+s", "for prompt snippets"),
			rawKeyHint("alt+enter", "to queue follow-up"),
			rawKeyHint("alt+up", "to edit all queued messages"),
			rawKeyHint(process.platform === "win32" ? "alt+v" : "ctrl+v", "to paste image"),
			rawKeyHint("drop files", "to attach"),
		);
	}

	return lines;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setHeader((_tui, theme) => ({
			// The logo is a fixed 26 columns. pi-tui aborts the process when a
			// component hands back a line wider than the width it was given, so
			// clamp every line rather than trusting the terminal to be wide enough.
			render(width: number): string[] {
				return buildHeader(theme).map((line) => truncateToWidth(line, width));
			},
			invalidate() {},
		}));
	});

	pi.registerCommand("builtin-header", {
		description: "Restore pi's built-in startup header for this session",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader(undefined);
			ctx.ui.notify("Built-in header restored", "info");
		},
	});
}
