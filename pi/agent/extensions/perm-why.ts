/**
 * perm-why — a one-line explanation beside every permission ask.
 *
 * @pi-lab/permissions emits "permissions:ask" on the shared event bus right
 * before it shows its Allow/Deny dialog. This extension listens for that,
 * hands the command plus a sliver of recent context to a tiny model
 * (openrouter/openai/gpt-oss-20b), and floats the answer as a widget above
 * the editor while the dialog is open: a single 5-8 word sentence saying
 * what the command is about to do. Cleared as soon as the user decides.
 *
 * Purely advisory and fail-quiet: no registry entry, no auth, a slow or
 * failed completion — the ask dialog works exactly as before, just without
 * the explanation line.
 */

import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "perm-why";
const TINY_MODEL = { provider: "openrouter", id: "openai/gpt-oss-20b" };
const GENERATION_TIMEOUT_MS = 6_000;
const SNIPPET = 400;

function clip(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n)}…` : s;
}

function describeInput(toolName: string, input: unknown): string {
	if (input && typeof input === "object" && typeof (input as any).command === "string") {
		return (input as any).command;
	}
	try {
		return JSON.stringify(input);
	} catch {
		return String(input);
	}
}

export default function permWhy(pi: ExtensionAPI) {
	let lastCtx: ExtensionContext | undefined;
	let lastUserText = "";
	const pendingInputs = new Map<string, { toolName: string; input: unknown }>();
	let generation = 0;

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
	});

	pi.on("input", async (event, ctx) => {
		lastCtx = ctx;
		if (typeof event.text === "string" && event.text.trim()) lastUserText = event.text.trim();
		return { action: "continue" as const };
	});

	pi.on("tool_call", async (event, ctx) => {
		lastCtx = ctx;
		pendingInputs.set(event.toolCallId, { toolName: event.toolName, input: event.input });
		if (pendingInputs.size > 32) {
			pendingInputs.delete(pendingInputs.keys().next().value!);
		}
		return undefined;
	});

	const clear = () => {
		generation++;
		if (lastCtx?.hasUI) lastCtx.ui.setWidget(WIDGET_KEY, undefined);
	};

	pi.events.on("permissions:ask", (payload: { toolCallId?: string; toolName?: string }) => {
		const ctx = lastCtx;
		if (!ctx?.hasUI) return;
		const call = payload.toolCallId ? pendingInputs.get(payload.toolCallId) : undefined;
		const toolName = call?.toolName ?? payload.toolName ?? "tool";
		const command = clip(describeInput(toolName, call?.input ?? {}), SNIPPET);

		const token = ++generation;
		ctx.ui.setWidget(WIDGET_KEY, [` ⚖ …`]);

		void (async () => {
			try {
				const model = ctx.modelRegistry.find(TINY_MODEL.provider, TINY_MODEL.id);
				if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) return clearIfCurrent();

				const prompt =
					"You explain what a coding agent is about to run. " +
					"Reply with ONE sentence of 5-8 words, no preamble, no quotes.\n\n" +
					`Tool: ${toolName}\nCommand/input: ${command}\n` +
					(lastUserText ? `The user last asked: ${clip(lastUserText, SNIPPET)}\n` : "");

				const timeout = new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("timeout")), GENERATION_TIMEOUT_MS),
				);
				const response: any = await Promise.race([
					ctx.modelRegistry.complete(
						model,
						{
							messages: [
								{
									role: "user" as const,
									content: [{ type: "text" as const, text: prompt }],
									timestamp: Date.now(),
								},
							],
						},
						{ cacheRetention: "none", sessionId: uuidv7() },
					),
					timeout,
				]);
				if (token !== generation) return; // dialog already answered
				const text = ((response?.content ?? []) as any[])
					.filter((b) => b?.type === "text" && typeof b.text === "string")
					.map((b) => b.text)
					.join(" ")
					.replace(/\s+/g, " ")
					.trim()
					.split(/(?<=[.!?])\s/)[0];
				if (!text) return clearIfCurrent();
				ctx.ui.setWidget(WIDGET_KEY, [` ⚖ ${clip(text, 120)}`]);
			} catch {
				clearIfCurrent();
			}
			function clearIfCurrent() {
				if (token === generation && ctx?.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
			}
		})();
	});

	pi.events.on("permissions:user_select", clear);
	pi.events.on("permissions:deny", clear);
	pi.on("session_shutdown", async () => clear());
}
