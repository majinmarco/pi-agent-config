import { strict as assert } from "node:assert";
import {
  isTerminalClass,
  classifyFocus,
  shouldAlert,
  soundFileFor,
  soundArgs,
  notifyArgs,
  loadConfig,
} from "./notify-offscreen.ts";

const SOUNDS = "/usr/share/sounds/freedesktop/stereo";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("isTerminalClass: common terminals match (case-insensitive, app ids)", () => {
  for (const c of [
    "foot",
    "kitty",
    "Alacritty",
    "io.alacritty",
    "com.mitchellh.ghostty",
    "org.wezfurlong.wezterm",
    "gnome-terminal-server",
  ]) {
    assert.equal(isTerminalClass(c), true, c);
  }
});

test("isTerminalClass: non-terminals and empty do not match", () => {
  for (const c of ["code", "firefox", "Google-chrome", "spotify", "stuff", ""]) {
    assert.equal(isTerminalClass(c), false, JSON.stringify(c));
  }
  assert.equal(isTerminalClass(undefined), false, "undefined");
});

test("classifyFocus maps active window class to focus state", () => {
  assert.equal(classifyFocus({ class: "foot" }), "focused");
  assert.equal(classifyFocus({ class: "code" }), "unfocused");
  assert.equal(classifyFocus(null), "unknown");
  assert.equal(classifyFocus(undefined), "unknown");
});

test("shouldAlert: alerts when unfocused/unknown, or when always set", () => {
  assert.equal(shouldAlert("focused", false), false);
  assert.equal(shouldAlert("unfocused", false), true);
  assert.equal(shouldAlert("unknown", false), true);
  assert.equal(shouldAlert("focused", true), true);
});

test("soundFileFor maps reason to a freedesktop sound", () => {
  assert.equal(soundFileFor("done"), `${SOUNDS}/complete.oga`);
  assert.equal(soundFileFor("permission"), `${SOUNDS}/bell.oga`);
  assert.equal(soundFileFor("question"), `${SOUNDS}/message-new-instant.oga`);
});

test("soundArgs builds the paplay argv", () => {
  assert.deepEqual(soundArgs("done"), ["paplay", `${SOUNDS}/complete.oga`]);
});

test("notifyArgs builds the notify-send argv", () => {
  assert.deepEqual(
    notifyArgs("Pi needs attention", "Allow bash?", "critical"),
    ["notify-send", "--app-name", "pi", "--urgency", "critical", "Pi needs attention", "Allow bash?"],
  );
});

test("loadConfig parses env toggles with safe defaults", () => {
  assert.deepEqual(loadConfig({}), { enabled: true, sound: true, always: false });
  assert.deepEqual(loadConfig({ PI_NOTIFY_OFFSCREEN: "0" }), { enabled: false, sound: true, always: false });
  assert.deepEqual(loadConfig({ PI_NOTIFY_SOUND: "0" }), { enabled: true, sound: false, always: false });
  assert.deepEqual(loadConfig({ PI_NOTIFY_ONSCREEN: "1" }), { enabled: true, sound: true, always: true });
});