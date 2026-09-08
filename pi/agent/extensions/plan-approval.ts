/**
 * plan_approval — an approval UI for mindful-loop's phase 2 plan.
 *
 * Instead of dumping the plan into a message and asking for a "yes", the
 * agent hands the plan to this tool: the user sees it in a bordered panel
 * (plan lines, the file list, what "done" looks like) and either approves
 * it, objects with a written note (which becomes the next frontier
 * question), or cancels. Blocks until the user decides.
 *
 * Follows the conventions of question-round.ts (shared UI lock, width-keyed
 * render cache, Editor for the write-in note).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface ApprovalResult {
	title?: string;
	plan: string[];
	files: string[];
	done?: string;
	decision: "approved" | "objection" | "cancelled";
	objection?: string;
}

const PlanApprovalParams = Type.Object({
	title: Type.Optional(Type.String({ description: "Heading, e.g. 'Ticket 03 · plan'. Keep it short." })),
	plan: Type.Array(Type.String(), {
		description: "The plan, one line per entry, six lines or fewer, in the user's words.",
	}),
	files: Type.Optional(Type.Array(Type.String(), { description: "The files the plan touches, one path per entry." })),
	done: Type.Optional(Type.String({ description: "What 'done' looks like — observable, one line." })),
});

// Same key as question-round.ts / ask-user-question: one pop-up at a time.
const SHARED_UI_LOCK_KEY = "__piSharedUiLock";
function getSharedUiLock() {
	const g = globalThis as any;
	if (!g[SHARED_UI_LOCK_KEY]) {
		let chain: Promise<void> = Promise.resolve();
		g[SHARED_UI_LOCK_KEY] = {
			withLock<T>(fn: () => T | Promise<T>): Promise<T> {
				const prev = chain;
				let release: () => void;
				chain = new Promise<void>((r) => {
					release = r;
				});
				return prev.then(fn).finally(() => release!());
			},
		};
	}
	return g[SHARED_UI_LOCK_KEY] as { withLock<T>(fn: () => T | Promise<T>): Promise<T> };
}

function buildModelText(result: ApprovalResult): string {
	switch (result.decision) {
		case "approved":
			return "User approved the plan. Save it to the state file and continue.";
		case "objection":
			return `User objected to the plan: ${result.objection}\nThe objection is a new frontier question; the grill phase restarts.`;
		default:
			return "User cancelled without approving. The plan is not approved; wait for direction.";
	}
}

export default function planApproval(pi: ExtensionAPI) {
	const sharedUiLock = getSharedUiLock();

	pi.registerTool({
		name: "plan_approval",
		label: "plan_approval",
		description:
			"Present a short plan (six lines or fewer) for explicit user approval in an interactive panel: the plan, the files it touches, and what 'done' looks like, with Approve / Object actions. An objection carries the user's written note back. Use it when a phase requires the user's yes on a plan; blocks until the user decides.",
		promptSnippet: "Use plan_approval to present a plan for the user's yes instead of asking for approval in a message.",
		promptGuidelines: [
			"Pass the plan to plan_approval exactly as it will be saved: same lines, same words. Never show one plan and save another.",
			"An objection returned by plan_approval is a new frontier question — re-grill, revise the plan, and present it through plan_approval again.",
			"A cancelled plan_approval is not approval. Do not proceed; end the turn and wait.",
		],
		parameters: PlanApprovalParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const plan = ((params.plan as string[]) ?? []).map((l) => String(l).trim()).filter((l) => l.length > 0);
			const files = ((params.files as string[]) ?? []).map((f) => String(f).trim()).filter((f) => f.length > 0);
			const title = (params.title as string | undefined)?.trim() || undefined;
			const doneLine = (params.done as string | undefined)?.trim() || undefined;
			const base = { title, plan, files, done: doneLine };
			const bail = (message: string): any => ({
				content: [{ type: "text" as const, text: message }],
				details: { ...base, decision: "cancelled" } as ApprovalResult,
			});

			if (plan.length === 0) return bail("Error: empty plan");
			if (signal?.aborted) return bail("Approval aborted before it was shown");
			if (ctx.mode !== "tui") return bail("plan_approval requires interactive mode; write the plan in a message and ask for a yes instead.");

			const result = await sharedUiLock.withLock(() =>
				ctx.ui.custom<ApprovalResult>((tui: any, theme: any, _kb: any, done: (r: ApprovalResult) => void) => {
					const ACTIONS = [
						{ key: "approve", label: "Approve plan", description: "Lock scope; the loop moves to the read-only pass." },
						{ key: "object", label: "Object — write what's wrong", description: "Your note becomes the next frontier question." },
					] as const;
					let actionIndex = 0;
					let editMode = false;
					let cachedLines: string[] | undefined;
					let cachedWidth = -1;

					const editorTheme: EditorTheme = {
						borderColor: (s) => theme.fg("accent", s),
						selectList: {
							selectedPrefix: (t) => theme.fg("accent", t),
							selectedText: (t) => theme.fg("accent", t),
							description: (t) => theme.fg("muted", t),
							scrollInfo: (t) => theme.fg("dim", t),
							noMatch: (t) => theme.fg("warning", t),
						},
					};
					const editor = new Editor(tui, editorTheme);

					function refresh() {
						cachedLines = undefined;
						tui.requestRender();
					}

					editor.onSubmit = (value) => {
						const text = value.trim();
						if (!text) return;
						done({ ...base, decision: "objection", objection: text });
					};

					function handleInput(data: string) {
						if (editMode) {
							if (matchesKey(data, Key.escape)) {
								editMode = false;
								editor.setText("");
								refresh();
								return;
							}
							editor.handleInput(data);
							refresh();
							return;
						}
						if (matchesKey(data, Key.up)) {
							actionIndex = Math.max(0, actionIndex - 1);
							refresh();
							return;
						}
						if (matchesKey(data, Key.down)) {
							actionIndex = Math.min(ACTIONS.length - 1, actionIndex + 1);
							refresh();
							return;
						}
						if (matchesKey(data, Key.enter)) {
							if (ACTIONS[actionIndex].key === "approve") {
								done({ ...base, decision: "approved" });
							} else {
								editMode = true;
								editor.setText("");
								refresh();
							}
							return;
						}
						if (matchesKey(data, Key.escape)) {
							done({ ...base, decision: "cancelled" });
						}
					}

					function render(width: number): string[] {
						// Width-keyed cache: resize re-enters render() without invalidate().
						if (cachedLines && cachedWidth === width) return cachedLines;

						const lines: string[] = [];
						const renderWidth = Math.max(1, width);

						function addWrapped(text: string) {
							lines.push(...wrapTextWithAnsi(text, renderWidth));
						}

						function addPrefixed(prefix: string, text: string) {
							const prefixWidth = visibleWidth(prefix);
							if (prefixWidth >= renderWidth) {
								addWrapped(prefix + text);
								return;
							}
							const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
							const continuation = " ".repeat(prefixWidth);
							for (let i = 0; i < wrapped.length; i++) {
								lines.push(`${i === 0 ? prefix : continuation}${wrapped[i]}`);
							}
						}

						lines.push(theme.fg("accent", "─".repeat(renderWidth)));
						addPrefixed(" ", theme.fg("accent", theme.bold(title ?? "Plan approval")));
						lines.push("");

						const numWidth = String(plan.length).length;
						for (let i = 0; i < plan.length; i++) {
							const num = String(i + 1).padStart(numWidth);
							addPrefixed(`  ${theme.fg("dim", "│")} ${theme.fg("muted", num)} `, theme.fg("text", plan[i]));
						}

						if (files.length > 0) {
							lines.push("");
							addPrefixed("  ", theme.fg("muted", "Files: ") + files.join(", "));
						}
						if (doneLine) {
							addPrefixed("  ", theme.fg("muted", "Done when: ") + theme.fg("text", doneLine));
						}
						lines.push("");

						for (let i = 0; i < ACTIONS.length; i++) {
							const focused = i === actionIndex && !editMode;
							const prefix = focused ? theme.fg("accent", "> ") : "  ";
							const color = focused ? "accent" : "text";
							addPrefixed(prefix, theme.fg(color, `${focused ? "●" : "○"} ${ACTIONS[i].label}`));
							addPrefixed("     ", theme.fg("muted", ACTIONS[i].description));
						}

						if (editMode) {
							lines.push("");
							addPrefixed(" ", theme.fg("muted", "Your objection:"));
							for (const line of editor.render(Math.max(1, renderWidth - 2))) {
								lines.push(truncateToWidth(` ${line}`, renderWidth));
							}
						}

						lines.push("");
						addPrefixed(
							" ",
							theme.fg("dim", editMode ? "Enter submit objection • Esc back" : "↑↓ move • Enter choose • Esc cancel"),
						);
						lines.push(theme.fg("accent", "─".repeat(renderWidth)));

						cachedLines = lines;
						cachedWidth = width;
						return lines;
					}

					return {
						render,
						invalidate: () => {
							cachedLines = undefined;
						},
						handleInput,
					};
				}),
			);

			return {
				content: [{ type: "text" as const, text: buildModelText(result) }],
				details: result,
			};
		},

		renderCall(args, theme) {
			const n = ((args.plan as string[]) ?? []).length;
			let text = theme.fg("toolTitle", theme.bold("plan_approval "));
			if (args.title) text += theme.fg("muted", `${args.title} `);
			text += theme.fg("dim", `(${n} line${n !== 1 ? "s" : ""})`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as ApprovalResult | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.decision === "approved") return new Text(theme.fg("success", "✓ Plan approved"), 0, 0);
			if (details.decision === "objection")
				return new Text(`${theme.fg("warning", "✗ Objection: ")}${details.objection ?? ""}`, 0, 0);
			return new Text(theme.fg("warning", "Approval cancelled"), 0, 0);
		},
	});
}
