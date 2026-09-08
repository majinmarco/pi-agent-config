/**
 * Loop status widget.
 *
 * Renders the mindful-loop / ticket-loop state as a live widget above the
 * editor, so phase, current ticket, criteria progress, and queue progress
 * are visible without opening the files under `.scratch/`.
 *
 * Sources (all in the project cwd, all owned by the skills — this extension
 * only reads):
 *   .scratch/mindful-loop/state.md        Phase / Ticket / Criterion lines
 *   .scratch/<slug>/issues/NN-*.md        ticket Status + criteria checkboxes
 *   .scratch/<slug>/queue.md              ticket table, Current, Frontier
 *
 * The layout adapts to the rendered width, so it stays legible in a narrow
 * tile (1/3–1/5 of a screen): wide terminals get one dense summary line,
 * narrow ones a stacked card. `/loop-status` toggles the expanded panel
 * (all tickets + all criteria); `/loop-status hide` clears the widget for
 * this session, `/loop-status show` brings it back. Refreshes on turn/tool
 * events and on fs.watch of .scratch.
 *
 * Typing `/skill:mindful-loop ` also gets ticket autocomplete: every
 * non-done ticket under .scratch/*​/issues/ is suggested (in-progress
 * first, then unblocked open, then blocked), and accepting one inserts
 * its full path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "loop-status";

interface QueueRow {
	id: string;
	title: string;
	blockedBy: string;
	status: string;
}

interface Snapshot {
	phase?: string; // "4 — waiting on test approval"
	ticketPath?: string;
	ticketId?: string;
	ticketTitle?: string;
	criteria: { done: boolean; text: string }[];
	criterion?: string; // the one in progress, from state.md
	slug?: string;
	rows: QueueRow[];
	current?: string;
	frontier?: string;
}

// ── data ────────────────────────────────────────────────────────────────

function readIfFile(p: string): string | undefined {
	try {
		return fs.readFileSync(p, "utf8");
	} catch {
		return undefined;
	}
}

function firstMatch(text: string, re: RegExp): string | undefined {
	const m = text.match(re);
	return m ? m[1].trim() : undefined;
}

function collect(cwd: string): Snapshot | undefined {
	const snap: Snapshot = { criteria: [], rows: [] };

	const state = readIfFile(path.join(cwd, ".scratch/mindful-loop/state.md"));
	if (state) {
		snap.phase = firstMatch(state, /^Phase:\s*(.+)$/m);
		snap.ticketPath = firstMatch(state, /^Ticket:\s*(\S+)$/m);
		snap.criterion = firstMatch(state, /^Criterion:\s*(.+)$/m);
	}

	// Slug: from the ticket path, else the sole/first queue under .scratch.
	if (snap.ticketPath) {
		const m = snap.ticketPath.match(/\.scratch\/([^/]+)\/issues\//);
		if (m) snap.slug = m[1];
	}
	if (!snap.slug) {
		try {
			for (const entry of fs.readdirSync(path.join(cwd, ".scratch"), { withFileTypes: true })) {
				if (entry.isDirectory() && fs.existsSync(path.join(cwd, ".scratch", entry.name, "queue.md"))) {
					snap.slug = entry.name;
					break;
				}
			}
		} catch {
			/* no .scratch */
		}
	}

	if (snap.slug) {
		const queue = readIfFile(path.join(cwd, ".scratch", snap.slug, "queue.md"));
		if (queue) {
			for (const line of queue.split("\n")) {
				const m = line.match(/^\|\s*(\w+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(open|in-progress|done)\s*\|/);
				if (m) snap.rows.push({ id: m[1], title: m[2], blockedBy: m[3], status: m[4] });
			}
			snap.current = firstMatch(queue, /^Current:\s*(.+)$/m);
			snap.frontier = firstMatch(queue, /^Frontier:\s*(.+)$/m);
		}
	}

	if (snap.ticketPath) {
		const ticket = readIfFile(path.isAbsolute(snap.ticketPath) ? snap.ticketPath : path.join(cwd, snap.ticketPath));
		if (ticket) {
			const h = ticket.match(/^#\s*(\w+):\s*(.+)$/m);
			if (h) {
				snap.ticketId = h[1];
				snap.ticketTitle = h[2].trim();
			}
			for (const m of ticket.matchAll(/^- \[( |x)\] (.+)$/gm)) {
				snap.criteria.push({ done: m[1] === "x", text: m[2].trim() });
			}
		}
	}

	const anything = snap.phase || snap.rows.length > 0 || snap.criteria.length > 0;
	return anything ? snap : undefined;
}

// ── ticket autocomplete ─────────────────────────────────────────────────

interface TicketEntry {
	path: string; // relative, as mindful-loop expects it
	id: string;
	title: string;
	status: string;
	blockedBy: string;
	slug: string;
}

function listTickets(cwd: string): TicketEntry[] {
	const out: TicketEntry[] = [];
	const scratch = path.join(cwd, ".scratch");
	let slugs: string[];
	try {
		slugs = fs
			.readdirSync(scratch, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return out;
	}
	for (const slug of slugs) {
		let files: string[];
		try {
			files = fs
				.readdirSync(path.join(scratch, slug, "issues"))
				.filter((f) => f.endsWith(".md"))
				.sort();
		} catch {
			continue;
		}
		for (const f of files) {
			const text = readIfFile(path.join(scratch, slug, "issues", f));
			if (!text) continue;
			const h = text.match(/^#\s*(\w+):\s*(.+)$/m);
			out.push({
				path: `.scratch/${slug}/issues/${f}`,
				id: h?.[1] ?? f.replace(/\.md$/, ""),
				title: h?.[2]?.trim() ?? f,
				status: firstMatch(text, /^\*\*Status:\*\*\s*(.+)$/m) ?? "open",
				blockedBy: firstMatch(text, /^\*\*Blocked by:\*\*\s*(.+)$/m) ?? "",
			slug,
			});
		}
	}
	return out;
}

/** Runnable tickets ranked: in-progress, then unblocked open, then blocked open. */
function ticketSuggestions(cwd: string, partial: string) {
	const tickets = listTickets(cwd);
	const doneBySlug = new Map<string, Set<string>>();
	for (const t of tickets) {
		if (t.status === "done") {
			if (!doneBySlug.has(t.slug)) doneBySlug.set(t.slug, new Set());
			doneBySlug.get(t.slug)!.add(t.id);
		}
	}
	const blocked = (t: TicketEntry): boolean => {
		const ids = t.blockedBy.match(/\b\w*\d+\w*\b/g) ?? [];
		return ids.some((id) => !doneBySlug.get(t.slug)?.has(id));
	};
	const needle = partial.toLowerCase();
	return tickets
		.filter((t) => t.status !== "done")
		.filter((t) => !needle || `${t.path} ${t.id} ${t.title}`.toLowerCase().includes(needle))
		.map((t) => ({ t, rank: t.status === "in-progress" ? 0 : blocked(t) ? 2 : 1 }))
		.sort((a, b) => a.rank - b.rank || a.t.path.localeCompare(b.t.path))
		.map(({ t, rank }) => ({
			value: t.path,
			label: `${t.id} ${t.title}`,
			description:
				rank === 0
					? `${t.slug} · in-progress`
					: rank === 2
						? `${t.slug} · blocked by ${t.blockedBy}`
						: `${t.slug} · open`,
		}));
}

const MINDFUL_ARG = /^\/skill:mindful-loop\s+(\S*)$/;

// ── text utilities ──────────────────────────────────────────────────────
// Styled strings carry ANSI escapes, so width math walks visible chars and
// copies escape sequences wholesale. Local on purpose: keeps the file
// runnable outside pi for layout testing.

const ANSI = /\x1b\[[0-9;]*m/y;

function visibleWidth(s: string): number {
	let w = 0;
	for (let i = 0; i < s.length; ) {
		ANSI.lastIndex = i;
		const m = ANSI.exec(s);
		if (m) {
			i += m[0].length;
		} else {
			w++;
			i++;
		}
	}
	return w;
}

function truncAnsi(s: string, width: number): string {
	if (visibleWidth(s) <= width) return s;
	let out = "";
	let w = 0;
	let sawAnsi = false;
	for (let i = 0; i < s.length && w < width - 1; ) {
		ANSI.lastIndex = i;
		const m = ANSI.exec(s);
		if (m) {
			out += m[0];
			sawAnsi = true;
			i += m[0].length;
		} else {
			out += s[i];
			w++;
			i++;
		}
	}
	return out + "…" + (sawAnsi ? "\x1b[0m" : "");
}

/** Plain-text ellipsis truncation for strings styled afterwards. */
function fit(s: string, width: number): string {
	if (width <= 1) return "…";
	return s.length > width ? `${s.slice(0, width - 1)}…` : s;
}

function bar(done: number, total: number, width: number, theme: Theme): string {
	if (total === 0 || width < 2) return "";
	const filled = Math.round((done / total) * width);
	return (
		theme.fg("success", "▰".repeat(filled)) + theme.fg("dim", "▱".repeat(width - filled))
	);
}

function rule(label: string, width: number, theme: Theme): string {
	const head = label ? `─ ${label} ` : "";
	const rest = Math.max(0, width - head.length);
	return theme.fg("dim", head + "─".repeat(rest));
}

// ── layout ──────────────────────────────────────────────────────────────

function renderLines(snap: Snapshot, expanded: boolean, width: number, theme: Theme): string[] {
	const w = Math.max(24, width);
	const narrow = w < 72;
	const lines: string[] = [];
	const critDone = snap.criteria.filter((c) => c.done).length;
	const queueDone = snap.rows.filter((r) => r.status === "done").length;

	// Phase splits into number and the human part after the dash.
	const phaseM = snap.phase?.match(/^(\S+)\s*(?:—|-)\s*(.*)$/);
	const phaseNo = phaseM ? phaseM[1] : snap.phase;
	const phaseWait = phaseM ? phaseM[2] : undefined;

	// Header: ◉ mindful-loop · phase 4 — waiting on test approval
	let head = theme.fg("accent", "◉ ") + theme.bold(theme.fg("accent", "mindful-loop"));
	if (phaseNo) {
		head += theme.fg("dim", " · ") + theme.bold(`phase ${phaseNo}`);
		if (phaseWait && !narrow) head += theme.fg("dim", " — ") + theme.fg("warning", phaseWait);
	} else if (snap.slug) {
		head += theme.fg("dim", ` · ${snap.slug} — idle`);
	}
	lines.push(head);
	if (phaseWait && narrow) {
		lines.push("  " + theme.fg("warning", fit(phaseWait, w - 2)));
	}

	// Current ticket + criteria progress.
	if (snap.ticketId) {
		const barW = Math.max(6, Math.min(14, w - 14));
		const meter = `${bar(critDone, snap.criteria.length, barW, theme)} ${theme.bold(`${critDone}/${snap.criteria.length}`)}`;
		if (narrow) {
			const title = fit(`${snap.ticketId} ${snap.ticketTitle ?? ""}`.trim(), w - 4);
			lines.push("  " + theme.fg("accent", "▸ ") + theme.bold(title));
			lines.push(`    ${meter} ${theme.fg("muted", "criteria")}`);
		} else {
			const title = fit(`${snap.ticketId} ${snap.ticketTitle ?? ""}`.trim(), w - barW - 22);
			lines.push("  " + theme.fg("accent", "▸ ") + theme.bold(title) + "  " + meter + " " + theme.fg("muted", "criteria"));
		}
	}

	// Queue summary.
	if (snap.rows.length > 0) {
		const next =
			snap.frontier && snap.frontier !== "—"
				? theme.fg("dim", " · next ") + theme.fg("accent", snap.frontier)
				: "";
		const label = fit(snap.slug ?? "queue", narrow ? w - 12 : 24);
		lines.push(
			"  " +
				theme.fg("muted", "⧉ ") +
				theme.fg("muted", label) +
				" " +
				theme.bold(`${queueDone}/${snap.rows.length}`) +
				theme.fg("muted", " done") +
				next,
		);
	}

	if (expanded) {
		if (snap.rows.length > 0) {
			lines.push(rule("tickets", w, theme));
			for (const r of snap.rows) {
				const cur = r.id === snap.ticketId || snap.current === r.id;
				let glyph: string;
				if (cur || r.status === "in-progress") glyph = theme.fg("accent", "▶");
				else if (r.status === "done") glyph = theme.fg("success", "✔");
				else glyph = theme.fg("dim", "○");
				const blocked =
					r.status === "open" && r.blockedBy !== "—"
						? theme.fg("dim", ` ⊘${r.blockedBy.replace(/\s+/g, "")}`)
						: "";
				const title = fit(`${r.id} ${r.title}`, w - 8);
				const text = r.status === "done" ? theme.fg("dim", title) : cur ? theme.bold(title) : title;
				lines.push(` ${glyph} ${text}${blocked}`);
			}
		}
		if (snap.criteria.length > 0) {
			lines.push(rule(snap.ticketId ? `criteria · ${snap.ticketId}` : "criteria", w, theme));
			for (const c of snap.criteria) {
				const current = !c.done && snap.criterion !== undefined && c.text.startsWith(snap.criterion);
				const glyph = c.done ? theme.fg("success", "✔") : current ? theme.fg("accent", "▸") : theme.fg("dim", "○");
				const text = fit(c.text, w - 4);
				lines.push(` ${glyph} ${c.done ? theme.fg("dim", text) : current ? theme.bold(text) : text}`);
			}
		}
	}

	return lines.map((line) => truncAnsi(line, w));
}

// ── wiring ──────────────────────────────────────────────────────────────

type WidgetFactory = (tui: unknown, theme: Theme) => { render(width: number): string[]; invalidate(): void };

interface UiCtx {
	hasUI: boolean;
	ui: {
		setWidget(key: string, value?: string[] | WidgetFactory): void;
		addAutocompleteProvider?(factory: (current: AutocompleteProvider) => AutocompleteProvider): void;
	};
}

interface AutocompleteProvider {
	triggerCharacters?: string[];
	getSuggestions(
		lines: string[],
		line: number,
		col: number,
		options?: unknown,
	): Promise<{ prefix: string; items: { value: string; label: string; description?: string }[] } | undefined> | { prefix: string; items: { value: string; label: string; description?: string }[] } | undefined;
	applyCompletion(lines: string[], line: number, col: number, item: unknown, prefix: string): unknown;
	shouldTriggerFileCompletion?(lines: string[], line: number, col: number): boolean;
}

export default function (pi: ExtensionAPI) {
	let expanded = false;
	let hidden = false;
	let watcher: fs.FSWatcher | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let autocompleteArmed = false;

	const armAutocomplete = (ctx: UiCtx) => {
		if (autocompleteArmed || !ctx.ui.addAutocompleteProvider) return;
		autocompleteArmed = true;
		ctx.ui.addAutocompleteProvider((current) => ({
			// A space is what follows the command name, so it opens the menu;
			// while the menu is open, further keystrokes re-query and filter.
			triggerCharacters: [...(current.triggerCharacters ?? []), " "],
			getSuggestions(lines, line, col, options) {
				const beforeCursor = (lines[line] ?? "").slice(0, col);
				const m = line === 0 ? beforeCursor.match(MINDFUL_ARG) : null;
				if (!m) return current.getSuggestions(lines, line, col, options);
				const items = ticketSuggestions(process.cwd(), m[1] ?? "");
				if (items.length === 0) return current.getSuggestions(lines, line, col, options);
				return { prefix: m[1] ?? "", items };
			},
			applyCompletion(lines, line, col, item, prefix) {
				return current.applyCompletion(lines, line, col, item, prefix);
			},
			shouldTriggerFileCompletion(lines, line, col) {
				// Ticket suggestions replace path completion inside the command.
				const beforeCursor = (lines[line] ?? "").slice(0, col);
				if (line === 0 && MINDFUL_ARG.test(beforeCursor)) return false;
				return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
			},
		}));
	};

	const refresh = (ctx: UiCtx) => {
		if (!ctx.hasUI) return;
		if (hidden) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		const snap = collect(process.cwd());
		if (!snap) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		const wasExpanded = expanded;
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
			render(width: number): string[] {
				return renderLines(snap, wasExpanded, width, theme);
			},
			invalidate() {},
		}));
	};

	const armWatcher = (ctx: UiCtx) => {
		if (watcher) return;
		const dir = path.join(process.cwd(), ".scratch");
		if (!fs.existsSync(dir)) return;
		try {
			watcher = fs.watch(dir, { recursive: true }, () => {
				// Debounce: skill runs write several files back to back.
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => refresh(ctx), 300);
			});
		} catch {
			/* fall back to event-driven refreshes only */
		}
	};

	for (const event of ["session_start", "turn_start", "turn_end", "tool_execution_end"] as const) {
		pi.on(event, async (_e, ctx) => {
			refresh(ctx as unknown as UiCtx);
			armWatcher(ctx as unknown as UiCtx);
			if (event === "session_start" && (ctx as unknown as UiCtx).hasUI) {
				armAutocomplete(ctx as unknown as UiCtx);
			}
		});
	}

	pi.on("session_shutdown", async () => {
		watcher?.close();
		watcher = undefined;
	});

	pi.registerCommand("loop-status", {
		description: "Toggle the expanded mindful-loop panel (args: show | hide)",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim();
			if (arg === "hide") hidden = true;
			else if (arg === "show") hidden = false;
			else expanded = !expanded;
			refresh(ctx as unknown as UiCtx);
		},
	});
}
