/**
 * question_round — a QA UI for asking a whole round of questions at once.
 *
 * Built for the grilling skill: instead of dumping a numbered wall of
 * questions into a message, the agent hands the round to this tool and the
 * user answers one question at a time in a tabbed wizard, with a review
 * screen before anything is submitted. Each question can carry an optional
 * "exhibit": a preformatted monospace block (ASCII diagram, decision tree,
 * comparison table) rendered alongside the question.
 *
 * Written against pi's documented extension API, starting from the
 * questionnaire.ts example that ships with pi (MIT).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── Types ────────────────────────────────────────────────────────────────

interface RoundOption {
	label: string;
	value: string;
	description?: string;
	recommended?: boolean;
}

type RenderOption = RoundOption & { isOther?: boolean; isWriteIn?: boolean };

interface RoundQuestion {
	id: string;
	label: string;
	prompt: string;
	details?: string;
	exhibit?: string;
	options: RoundOption[];
	multiSelect: boolean;
	allowOther: boolean;
}

interface Selection {
	value: string;
	label: string;
	index?: number;
	wasCustom: boolean;
}

interface Answer {
	id: string;
	selections: Selection[];
}

interface RoundResult {
	title?: string;
	questions: RoundQuestion[];
	answers: Answer[];
	cancelled: boolean;
}

// ── Schema ───────────────────────────────────────────────────────────────

const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the option." }),
	value: Type.Optional(Type.String({ description: "Machine-readable value returned when selected. Defaults to the label." })),
	description: Type.Optional(Type.String({ description: "One-line detail shown below the label." })),
	recommended: Type.Optional(
		Type.Boolean({
			description: "Mark exactly one option per question as your recommended answer. It is highlighted and pre-focused.",
		}),
	),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this question within the round." }),
	label: Type.Optional(
		Type.String({ description: "Short tab label, e.g. 'Scope', 'Storage' (defaults to Q1, Q2, ...). Keep it to one or two words." }),
	),
	prompt: Type.String({ description: "The full question text." }),
	details: Type.Optional(
		Type.String({ description: "Optional context shown under the question: why it matters, trade-offs, what depends on it." }),
	),
	exhibit: Type.Optional(
		Type.String({
			description:
				"Optional preformatted monospace block rendered verbatim in a panel with the question: an ASCII/box-drawing diagram, decision tree, comparison table, or code sketch. Plain text only (no ANSI, no markdown fences). Keep it under ~30 lines and ~76 columns.",
		}),
	),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			description:
				"Choices for the question. Omit or pass an empty array for a free-form text question. A write-in escape is always offered.",
		}),
	),
	multiSelect: Type.Optional(Type.Boolean({ description: "Allow selecting several options (space toggles, enter confirms)." })),
	allowOther: Type.Optional(Type.Boolean({ description: "Offer a write-in answer alongside the options (default true)." })),
});

const QuestionRoundParams = Type.Object({
	title: Type.Optional(Type.String({ description: "Heading for the round, e.g. 'Round 2 · Storage decisions'." })),
	questions: Type.Array(QuestionSchema, { description: "The questions of this round, in the order to ask them." }),
});

// ── Shared UI mutex ──────────────────────────────────────────────────────
// ctx.ui.custom() can only host one component at a time, so every
// pop-up-style tool must serialize against the others (ask_user_question
// uses the same globalThis key), not just against itself.

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

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeQuestions(raw: any[]): RoundQuestion[] {
	return raw.map((q, i) => ({
		id: q.id,
		label: (q.label || "").trim() || `Q${i + 1}`,
		prompt: q.prompt,
		details: q.details?.trim() || undefined,
		exhibit: q.exhibit != null && String(q.exhibit).trim().length > 0 ? String(q.exhibit).replace(/\s+$/, "") : undefined,
		options: ((q.options || []) as any[])
			.map((o) => ({
				label: String(o.label || "").trim(),
				value: String(o.value || "").trim() || String(o.label || "").trim(),
				description: o.description?.trim() || undefined,
				recommended: o.recommended === true,
			}))
			.filter((o) => o.label.length > 0),
		multiSelect: q.multiSelect === true,
		allowOther: q.allowOther !== false,
	}));
}

function formatSelection(sel: Selection): string {
	if (sel.wasCustom) return `wrote: ${sel.label}`;
	return sel.index != null ? `selected ${sel.index}. ${sel.label}` : `selected ${sel.label}`;
}

function answerText(q: RoundQuestion, a: Answer | undefined): string {
	if (!a || a.selections.length === 0) return `${q.label}: (unanswered)`;
	if (a.selections.length === 1) return `${q.label}: ${formatSelection(a.selections[0])}`;
	return `${q.label}:\n${a.selections.map((s) => `  - ${formatSelection(s)}`).join("\n")}`;
}

function buildModelText(result: RoundResult): string {
	const lines: string[] = [];
	if (result.cancelled) {
		lines.push("User cancelled the round before submitting.");
	}
	const answered = result.questions.filter((q) => result.answers.some((a) => a.id === q.id && a.selections.length > 0));
	const unanswered = result.questions.filter((q) => !answered.includes(q));
	if (answered.length > 0) {
		lines.push(result.cancelled ? "Answers given before cancelling:" : "User answered:");
		for (const q of answered) {
			lines.push(answerText(q, result.answers.find((a) => a.id === q.id)));
		}
	}
	if (result.cancelled && unanswered.length > 0) {
		lines.push(`Unanswered: ${unanswered.map((q) => q.label).join(", ")}`);
	}
	if (lines.length === 0) {
		lines.push("User cancelled the round without answering anything.");
	}
	return lines.join("\n");
}

// ── Extension ────────────────────────────────────────────────────────────

export default function questionRound(pi: ExtensionAPI) {
	const sharedUiLock = getSharedUiLock();

	pi.registerTool({
		name: "question_round",
		label: "question_round",
		description:
			"Ask the user a round of related questions through an interactive wizard: one question on screen at a time, tab navigation, a write-in escape on every question, and a review screen before submission. Use it whenever you have two or more questions ready to ask together (an interview round, a set of clarifications); for a single quick question prefer ask_user_question. Each question may carry an 'exhibit': a preformatted monospace panel (ASCII diagram, decision tree, comparison table) shown with the question. Blocks until the user submits or cancels.",
		promptSnippet:
			"Use question_round to ask a batch of related questions in one interactive round instead of listing them in a message.",
		promptGuidelines: [
			"Bundle every question of the current round into one question_round call; never split a round across calls or fall back to numbered questions in a message.",
			"Give each question options whenever the answers are enumerable, and mark exactly one option per question recommended: true (your recommendation).",
			"Use a free-form question (no options) only when the answer is genuinely open-ended.",
			"Attach an exhibit when a picture says it better: a box-drawing diagram of the design, a comparison table of the options, a tree of what hangs off the decision. Plain monospace text, under ~30 lines by ~76 columns, no ANSI escapes.",
			"The user can cancel the round; the result then lists which questions were already answered, so re-ask only the remainder.",
		],
		parameters: QuestionRoundParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const questions = normalizeQuestions(params.questions as any[]);
			const title = (params.title as string | undefined)?.trim() || undefined;
			const bail = (message: string): any => ({
				content: [{ type: "text" as const, text: message }],
				details: { title, questions, answers: [], cancelled: true } as RoundResult,
			});

			if (questions.length === 0) return bail("Error: no questions provided");
			if (signal?.aborted) return bail("Round aborted before it was shown");
			if (ctx.mode !== "tui") return bail("question_round requires interactive mode UI; ask your questions in a plain message instead.");

			const ids = new Set(questions.map((q) => q.id));
			if (ids.size !== questions.length) return bail("Error: duplicate question ids in round");

			const result = await sharedUiLock.withLock(() =>
				ctx.ui.custom<RoundResult>((tui: any, theme: any, _kb: any, done: (r: RoundResult) => void) => {
					const totalTabs = questions.length + 1; // + review/submit tab
					let currentTab = 0;
					let optionIndex = 0;
					let editMode = false;
					let cachedLines: string[] | undefined;
					let cachedWidth = -1;
					// answers + per-question toggled state for multi-select
					const answers = new Map<string, Answer>();
					const toggled = new Map<string, Map<string, Selection>>();

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

					function question(): RoundQuestion | undefined {
						return questions[currentTab];
					}

					function renderOptionsFor(q: RoundQuestion): RenderOption[] {
						const opts: RenderOption[] = [...q.options];
						if (q.options.length === 0) {
							opts.push({ value: "__write__", label: "Write an answer", isWriteIn: true });
						} else if (q.allowOther) {
							opts.push({ value: "__other__", label: "Other (write your own)", isOther: true });
						}
						return opts;
					}

					function toggledFor(q: RoundQuestion): Map<string, Selection> {
						let m = toggled.get(q.id);
						if (!m) {
							m = new Map();
							toggled.set(q.id, m);
						}
						return m;
					}

					function customSelectionOf(q: RoundQuestion): Selection | undefined {
						if (q.multiSelect) return toggledFor(q).get("__custom__");
						return answers.get(q.id)?.selections.find((s) => s.wasCustom);
					}

					function enterTab(tab: number) {
						currentTab = tab;
						editMode = false;
						const q = question();
						optionIndex = 0;
						if (q && !answers.has(q.id) && !q.multiSelect) {
							const rec = q.options.findIndex((o) => o.recommended);
							if (rec >= 0) optionIndex = rec;
						}
						refresh();
					}

					function allAnswered(): boolean {
						return questions.every((q) => (answers.get(q.id)?.selections.length ?? 0) > 0);
					}

					function advance() {
						enterTab(currentTab < questions.length - 1 ? currentTab + 1 : questions.length);
					}

					editor.onSubmit = (value) => {
						const q = question();
						if (!q) return;
						const text = value.trim();
						if (!text) return;
						const sel: Selection = { value: text, label: text, wasCustom: true };
						if (q.multiSelect) {
							toggledFor(q).set("__custom__", sel);
							editMode = false;
							editor.setText("");
							refresh();
							return;
						}
						answers.set(q.id, { id: q.id, selections: [sel] });
						editMode = false;
						editor.setText("");
						advance();
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

						// Tab navigation
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
							enterTab((currentTab + 1) % totalTabs);
							return;
						}
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							enterTab((currentTab - 1 + totalTabs) % totalTabs);
							return;
						}

						// Review / submit tab
						if (currentTab === questions.length) {
							if (matchesKey(data, Key.enter) && allAnswered()) {
								done({ title, questions, answers: Array.from(answers.values()), cancelled: false });
								return;
							}
							if (matchesKey(data, Key.escape)) {
								done({ title, questions, answers: Array.from(answers.values()), cancelled: true });
							}
							return;
						}

						const q = question();
						if (!q) return;
						const opts = renderOptionsFor(q);

						if (matchesKey(data, Key.up)) {
							optionIndex = Math.max(0, optionIndex - 1);
							refresh();
							return;
						}
						if (matchesKey(data, Key.down)) {
							optionIndex = Math.min(opts.length - 1, optionIndex + 1);
							refresh();
							return;
						}

						const opt = opts[optionIndex];

						if (q.multiSelect && matchesKey(data, Key.space)) {
							if (opt.isOther || opt.isWriteIn) {
								const m = toggledFor(q);
								if (m.has("__custom__")) {
									m.delete("__custom__");
									refresh();
								} else {
									editMode = true;
									editor.setText("");
									refresh();
								}
								return;
							}
							const m = toggledFor(q);
							if (m.has(opt.value)) m.delete(opt.value);
							else m.set(opt.value, { value: opt.value, label: opt.label, index: optionIndex + 1, wasCustom: false });
							refresh();
							return;
						}

						if (matchesKey(data, Key.enter)) {
							if (opt.isOther || opt.isWriteIn) {
								editMode = true;
								editor.setText(customSelectionOf(q)?.label || "");
								refresh();
								return;
							}
							if (q.multiSelect) {
								// Enter toggles the focused option on, then confirms the set.
								const m = toggledFor(q);
								if (!m.has(opt.value)) {
									m.set(opt.value, { value: opt.value, label: opt.label, index: optionIndex + 1, wasCustom: false });
								}
								const selections = Array.from(m.values());
								if (selections.length === 0) return;
								answers.set(q.id, { id: q.id, selections });
								advance();
								return;
							}
							answers.set(q.id, {
								id: q.id,
								selections: [{ value: opt.value, label: opt.label, index: optionIndex + 1, wasCustom: false }],
							});
							advance();
							return;
						}

						if (matchesKey(data, Key.escape)) {
							done({ title, questions, answers: Array.from(answers.values()), cancelled: true });
						}
					}

					function render(width: number): string[] {
						// The cache MUST be keyed on width: pi-tui calls requestRender()
						// but NOT invalidate() on terminal resize, so render() can be
						// re-entered with a new width; returning stale wider lines trips
						// the TUI width guard and crashes the process.
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
						if (title) {
							addPrefixed(" ", theme.fg("accent", theme.bold(title)));
						}

						// Tab bar
						{
							const tabs: string[] = [];
							for (let i = 0; i < questions.length; i++) {
								const active = i === currentTab;
								const isAnswered = (answers.get(questions[i].id)?.selections.length ?? 0) > 0;
								const text = ` ${isAnswered ? "■" : "□"} ${questions[i].label} `;
								tabs.push(active ? theme.bg("selectedBg", theme.fg("text", text)) : theme.fg(isAnswered ? "success" : "muted", text));
							}
							const submitActive = currentTab === questions.length;
							const submitText = " ✓ Review ";
							tabs.push(
								submitActive
									? theme.bg("selectedBg", theme.fg("text", submitText))
									: theme.fg(allAnswered() ? "success" : "dim", submitText),
							);
							addPrefixed(" ", tabs.join(" "));
							lines.push("");
						}

						const q = question();

						if (currentTab === questions.length) {
							// Review tab
							addPrefixed(" ", theme.fg("accent", theme.bold("Review your answers")));
							lines.push("");
							for (const rq of questions) {
								const a = answers.get(rq.id);
								if (a && a.selections.length > 0) {
									const summary = a.selections
										.map((s) => (s.wasCustom ? `(wrote) ${s.label}` : s.label))
										.join(", ");
									addPrefixed("  ", `${theme.fg("muted", `${rq.label}: `)}${theme.fg("text", summary)}`);
								} else {
									addPrefixed("  ", `${theme.fg("muted", `${rq.label}: `)}${theme.fg("warning", "unanswered")}`);
								}
							}
							lines.push("");
							if (allAnswered()) {
								addPrefixed(" ", theme.fg("success", "Enter to submit the round"));
							} else {
								addPrefixed(" ", theme.fg("warning", "Answer the remaining questions before submitting (Tab to jump back)."));
							}
						} else if (q) {
							addPrefixed(" ", theme.fg("text", theme.bold(q.prompt)));
							if (q.details) {
								lines.push("");
								addPrefixed(" ", theme.fg("muted", q.details));
							}
							if (q.exhibit) {
								lines.push("");
								for (const raw of q.exhibit.split("\n")) {
									const body = truncateToWidth(raw, Math.max(1, renderWidth - 4));
									lines.push(truncateToWidth(`  ${theme.fg("dim", "│")} ${body}`, renderWidth));
								}
							}
							lines.push("");

							const opts = renderOptionsFor(q);
							const m = q.multiSelect ? toggledFor(q) : undefined;
							for (let i = 0; i < opts.length; i++) {
								const opt = opts[i];
								const focused = i === optionIndex && !editMode;
								const custom = customSelectionOf(q);
								const isCustomEntry = opt.isOther === true || opt.isWriteIn === true;
								const checked = q.multiSelect
									? isCustomEntry
										? m!.has("__custom__")
										: m!.has(opt.value)
									: isCustomEntry
										? custom != null
										: answers.get(q.id)?.selections.some((s) => !s.wasCustom && s.value === opt.value) === true;
								const marker = q.multiSelect ? (checked ? "[x]" : "[ ]") : checked ? "●" : " ";
								let label = isCustomEntry ? opt.label : `${i + 1}. ${opt.label}`;
								if (opt.recommended) label += " ★ recommended";
								if (isCustomEntry && custom) label += ` — ${custom.label}`;
								const prefix = focused ? theme.fg("accent", "> ") : "  ";
								const color = focused ? "accent" : checked ? "success" : "text";
								addPrefixed(prefix, theme.fg(color, `${marker} ${label}`.trimStart()));
								if (opt.description) {
									addPrefixed("     ", theme.fg("muted", opt.description));
								}
							}

							if (editMode) {
								lines.push("");
								addPrefixed(" ", theme.fg("muted", "Your answer:"));
								for (const line of editor.render(Math.max(1, renderWidth - 2))) {
									lines.push(truncateToWidth(` ${line}`, renderWidth));
								}
							}
						}

						lines.push("");
						const help = editMode
							? "Enter save • Esc back"
							: currentTab === questions.length
								? "Tab/←→ questions • Enter submit • Esc cancel round"
								: q?.multiSelect
									? "Tab/←→ questions • ↑↓ move • Space toggle • Enter confirm • Esc cancel round"
									: "Tab/←→ questions • ↑↓ move • Enter answer • Esc cancel round";
						addPrefixed(" ", theme.fg("dim", help));
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
			const qs = (args.questions as any[]) || [];
			const labels = qs.map((q, i) => q.label || `Q${i + 1}`).join(", ");
			let text = theme.fg("toolTitle", theme.bold("question_round "));
			if (args.title) text += theme.fg("muted", `${args.title} `);
			text += theme.fg("dim", `(${qs.length} question${qs.length !== 1 ? "s" : ""}: ${labels})`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as RoundResult | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			const lines: string[] = [];
			if (details.cancelled) {
				lines.push(theme.fg("warning", "Round cancelled"));
			}
			for (const q of details.questions) {
				const a = details.answers.find((x) => x.id === q.id);
				if (!a || a.selections.length === 0) {
					if (!details.cancelled) lines.push(`${theme.fg("warning", "○ ")}${theme.fg("muted", `${q.label}: unanswered`)}`);
					continue;
				}
				const summary = a.selections.map((s) => (s.wasCustom ? `(wrote) ${s.label}` : s.label)).join(", ");
				lines.push(`${theme.fg("success", "✓ ")}${theme.fg("accent", `${q.label}: `)}${summary}`);
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
