/**
 * hunk-flow — glue around /skill:hunk-review so review starts itself.
 *
 * Two automations, both armed when a /skill:hunk-review invocation passes
 * through the input event (typed by the user or dispatched via invoke_skill):
 *
 *   1. If the repo has no live Hunk TUI session, and pi runs inside tmux,
 *      a pane opens next to pi (`tmux split-window -h -d`) running
 *      `hunk diff --watch`, then the input waits briefly for the session to
 *      register with the daemon — the skill's `hunk session comment` calls
 *      need it live. Outside tmux it just asks the user to open Hunk.
 *   2. When the response is fully finished (agent_settled — pi will not
 *      continue on its own), /hunk review is dispatched exactly as if the
 *      user typed it, opening pi-hunk's review checkpoint.
 *
 * Detection matches `hunk session list --json` repoRoot entries against the
 * git toplevel of pi's cwd; `hunk session get --repo` exits 0 even on a
 * miss, so the list is the only trustworthy probe.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const SKILL_RE = /^\/skill:hunk-review(\s|$)/;
const SESSION_WAIT_MS = 6000;
const SESSION_POLL_MS = 500;

async function repoRoot(cwd: string): Promise<string> {
	try {
		const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 3000 });
		return stdout.trim() || cwd;
	} catch {
		return cwd;
	}
}

async function hasLiveSession(root: string): Promise<boolean> {
	try {
		const { stdout } = await run("hunk", ["session", "list", "--json"], { timeout: 4000 });
		const parsed = JSON.parse(stdout) as { sessions?: { repoRoot?: string }[] };
		return (parsed.sessions ?? []).some((s) => s.repoRoot === root);
	} catch {
		return false;
	}
}

function openHunkPane(root: string): void {
	// -d keeps focus on the pi pane; --watch reloads the diff as it changes.
	spawn("tmux", ["split-window", "-h", "-d", "-c", root, "hunk", "diff", "--watch"], {
		stdio: "ignore",
		detached: true,
	}).unref();
}

export default function (pi: ExtensionAPI) {
	let pending = false;

	pi.on("input", async (event, ctx) => {
		if (!SKILL_RE.test(event.text.trim())) return { action: "continue" as const };
		pending = true;

		const root = await repoRoot(ctx.cwd);
		if (await hasLiveSession(root)) return { action: "continue" as const };

		if (!process.env.TMUX) {
			if (ctx.hasUI) ctx.ui.notify("No live Hunk session for this repo — open one (`hunk diff`) in another terminal.", "warning");
			return { action: "continue" as const };
		}

		if (ctx.hasUI) ctx.ui.notify("Opening Hunk in a tmux pane…", "info");
		openHunkPane(root);
		const deadline = Date.now() + SESSION_WAIT_MS;
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, SESSION_POLL_MS));
			if (await hasLiveSession(root)) return { action: "continue" as const };
		}
		if (ctx.hasUI) ctx.ui.notify("Hunk session did not register in time — the skill's session commands may fail.", "warning");
		return { action: "continue" as const };
	});

	pi.on("agent_settled", async (_event, _ctx) => {
		if (!pending) return;
		pending = false;
		// A beat after settle so pi-hunk's isIdle() check sees an idle session.
		setTimeout(() => {
			pi.sendUserMessage("/hunk review", { expandPromptTemplates: true });
		}, 400);
	});
}
