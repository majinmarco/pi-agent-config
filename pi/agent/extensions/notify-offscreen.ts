/**
 * notify-offscreen — desktop notification + sound when pi needs attention
 * while its terminal is not the focused window.
 *
 * Alerts on: permission required (permissions:ask), a blocking question/prompt
 * (ui_prompt_start), and completion (agent_settled).
 *
 * "Off-screen" is determined by asking Hyprland for the currently focused
 * window and checking whether its class is a terminal. If detection is
 * unavailable, it alerts anyway (fail-safe). On non-Hyprland systems the
 * check silently no-ops into "unknown", so the alert still fires.
 *
 * Environment toggles:
 *   PI_NOTIFY_OFFSCREEN=0  disable the extension entirely
 *   PI_NOTIFY_SOUND=0      notifications only, no sound
 *   PI_NOTIFY_ONSCREEN=1   alert even when the terminal is focused
 */

import { execFile, spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type AlertReason = "permission" | "question" | "done";
export type FocusState = "focused" | "unfocused" | "unknown";

export interface ActiveWindow {
  class?: string;
  pid?: number;
  address?: string;
}

export interface NotifyConfig {
  enabled: boolean;
  sound: boolean;
  always: boolean;
}

const SOUNDS_DIR = "/usr/share/sounds/freedesktop/stereo";

// Exact WM_CLASS / app-id matches (lowercased). Deliberately no substring
// matching so short names like "st" can't false-positive on "stuff".
const TERMINAL_CLASSES = new Set([
  "foot",
  "footclient",
  "kitty",
  "alacritty",
  "io.alacritty",
  "ghostty",
  "com.mitchellh.ghostty",
  "wezterm",
  "org.wezfurlong.wezterm",
  "xterm",
  "xterm-256color",
  "konsole",
  "org.kde.konsole",
  "gnome-terminal-server",
  "org.gnome.terminal",
  "org.gnome.terminator",
  "termite",
  "terminator",
  "tilix",
  "xfce4-terminal",
  "lxterminal",
  "rxvt",
  "urxvt",
  "rxvt-unicode",
  "tabby",
  "warp",
  "iterm2",
  "contour",
  "rio",
]);

export function isTerminalClass(cls: string | undefined): boolean {
  if (!cls) return false;
  return TERMINAL_CLASSES.has(cls.toLowerCase());
}

export function classifyFocus(aw: ActiveWindow | null | undefined): FocusState {
  if (!aw) return "unknown";
  if (isTerminalClass(aw.class)) return "focused";
  return "unfocused";
}

export function shouldAlert(focus: FocusState, always: boolean): boolean {
  if (always) return true;
  return focus !== "focused";
}

export function soundFileFor(reason: AlertReason): string {
  switch (reason) {
    case "done":
      return `${SOUNDS_DIR}/complete.oga`;
    case "permission":
      return `${SOUNDS_DIR}/bell.oga`;
    case "question":
      return `${SOUNDS_DIR}/message-new-instant.oga`;
  }
}

export function soundArgs(reason: AlertReason): string[] {
  return ["paplay", soundFileFor(reason)];
}

export function notifyArgs(
  title: string,
  body: string,
  urgency: "normal" | "critical" = "normal",
): string[] {
  return ["notify-send", "--app-name", "pi", "--urgency", urgency, title, body];
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): NotifyConfig {
  return {
    enabled: env.PI_NOTIFY_OFFSCREEN !== "0",
    sound: env.PI_NOTIFY_SOUND !== "0",
    always: env.PI_NOTIFY_ONSCREEN === "1",
  };
}

function spawnDetached(args: string[] | null): void {
  if (!args || args.length === 0) return;
  const [cmd, ...rest] = args;
  try {
    const child = spawn(cmd, rest, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // notification/sound are best-effort; never let them break pi
  }
}

function activeWindow(): Promise<ActiveWindow | null> {
  return new Promise((resolve) => {
    execFile(
      "hyprctl",
      ["activewindow", "-j"],
      { timeout: 1500 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          resolve(JSON.parse(stdout) as ActiveWindow);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export default function notifyOffscreen(pi: ExtensionAPI) {
  const cfg = loadConfig();
  if (!cfg.enabled) return;

  // `permissions:ask` fires right before the Allow/Deny dialog, which also
  // opens a ui_prompt; remember the timestamp so we don't double-alert.
  let lastPermissionAsk = 0;

  async function alert(
    reason: AlertReason,
    title: string,
    body: string,
    urgency: "normal" | "critical" = "normal",
  ): Promise<void> {
    const focus = classifyFocus(await activeWindow());
    if (!shouldAlert(focus, cfg.always)) return;
    spawnDetached(notifyArgs(title, body, urgency));
    if (cfg.sound) spawnDetached(soundArgs(reason));
  }

  pi.events.on("permissions:ask", (payload: { toolName?: string }) => {
    lastPermissionAsk = Date.now();
    const tool = payload?.toolName ?? "a tool";
    void alert("permission", "Pi needs permission", `Allow ${tool}?`, "critical");
  });

  pi.on("ui_prompt_start", (event: { reason?: string; kind?: string; title?: string }) => {
    // The permission dialog itself shows up as a ui prompt; skip the echo.
    if (Date.now() - lastPermissionAsk < 1500) return;
    const kind = event.kind ?? "prompt";
    const title = event.title ? truncate(event.title.replace(/\s+/g, " ").trim(), 120) : kind;
    void alert("question", "Pi needs your input", `[${kind}] ${title}`);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.isIdle() !== true) return;
    void alert("done", "Pi finished", "Ready for input", "normal");
  });
}