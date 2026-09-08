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
 * `/loop-status` toggles the expanded panel (all tickets + all criteria).
 * `/loop-status hide` clears the widget for this session; `/loop-status show`
 * brings it back. Refreshes on turn/tool events and on fs.watch of .scratch.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "loop-status";
const MAX_WIDTH = 100;

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

function clamp(line: string): string {
	return line.length > MAX_WIDTH ? `${line.slice(0, MAX_WIDTH - 1)}…` : line;
}

function statusGlyph(status: string, isCurrent: boolean): string {
	if (isCurrent) return "▶";
	if (status === "done") return "✔";
	if (status === "in-progress") return "▶";
	return "·";
}

function render(snap: Snapshot, expanded: boolean): string[] {
	const lines: string[] = [];
	const doneCount = snap.rows.filter((r) => r.status === "done").length;
	const critDone = snap.criteria.filter((c) => c.done).length;

	let head = "◉ mindful-loop";
	if (snap.phase) head += ` · phase ${snap.phase}`;
	else if (snap.slug) head += ` · ${snap.slug} — no run in progress`;
	lines.push(head);

	const bits: string[] = [];
	if (snap.ticketId) {
		const bar = snap.criteria.map((c) => (c.done ? "✓" : "·")).join("");
		bits.push(`${snap.ticketId} ${snap.ticketTitle ?? ""} ${bar} ${critDone}/${snap.criteria.length}`);
	}
	if (snap.rows.length > 0) {
		bits.push(`queue ${snap.slug}: ${doneCount}/${snap.rows.length} done`);
		if (snap.frontier && snap.frontier !== "—") bits.push(`frontier ${snap.frontier}`);
	}
	if (bits.length > 0) lines.push(`  ${bits.join(" · ")}`);

	if (expanded) {
		if (snap.rows.length > 0) {
			lines.push("  ── tickets ──");
			for (const r of snap.rows) {
				const cur = r.id === snap.ticketId || snap.current === r.id;
				const blocked = r.status === "open" && r.blockedBy !== "—" ? `  (blocked by ${r.blockedBy})` : "";
				lines.push(`  ${statusGlyph(r.status, cur)} ${r.id} ${r.title}  ${r.status}${blocked}`);
			}
		}
		if (snap.criteria.length > 0) {
			lines.push(`  ── criteria (ticket ${snap.ticketId ?? "?"}) ──`);
			for (const c of snap.criteria) {
				const marker = !c.done && snap.criterion && c.text.startsWith(snap.criterion) ? "  ← current" : "";
				lines.push(`  [${c.done ? "x" : " "}] ${c.text}${marker}`);
			}
		}
	}

	return lines.map(clamp);
}

export default function (pi: ExtensionAPI) {
	let expanded = false;
	let hidden = false;
	let watcher: fs.FSWatcher | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const refresh = (ctx: { hasUI: boolean; ui: { setWidget(key: string, lines?: string[]): void } }) => {
		if (!ctx.hasUI) return;
		if (hidden) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		const snap = collect(process.cwd());
		ctx.ui.setWidget(WIDGET_KEY, snap ? render(snap, expanded) : undefined);
	};

	const armWatcher = (ctx: Parameters<typeof refresh>[0]) => {
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
			refresh(ctx);
			armWatcher(ctx);
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
			refresh(ctx);
		},
	});
}
