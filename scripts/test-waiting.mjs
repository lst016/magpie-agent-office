// Checks when a pending tool call counts as "waiting on you":  npm test
// Writes made-up Claude Code and Codex logs into a temporary HOME, starts one shell the
// way Claude Code runs Bash (eval '<command>'), and reads `office.mjs --once`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const OFFICE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "office.mjs");
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const RUNNING = `sleep 30; echo 'ao-test-${process.pid}'`; // has a quote, like real commands do

function claude(home, name, mode, tool, input, secs = 60) {
  const dir = path.join(home, ".claude", "projects", "-tmp-" + name);
  fs.mkdirSync(dir, { recursive: true });
  const content = tool ? [{ type: "tool_use", id: "t1", name: tool, input }] : [{ type: "text", text: "done" }];
  const lines = [
    { type: "user", cwd: "/tmp/" + name, permissionMode: mode, timestamp: ago(secs + 5), message: { role: "user", content: name } },
    { type: "assistant", timestamp: ago(secs), message: { id: "m1", model: "claude-opus-5-5", content, stop_reason: tool ? "tool_use" : "end_turn" } },
  ];
  fs.writeFileSync(path.join(dir, name + ".jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

// Claude Code's live record of a running process (~/.claude/sessions/<pid>.json)
function live(home, sessionId, pid, procStart, status, waitingFor) {
  const dir = path.join(home, ".claude", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify({ pid, sessionId, procStart, status, waitingFor }));
}

const snapshot = (home) => {
  const out = JSON.parse(execFileSync(process.execPath, [OFFICE, "--once"], { env: { ...process.env, HOME: home }, encoding: "utf8" }));
  return Object.fromEntries(out.sessions.map((s) => [s.title, s.state + (s.why ? ":" + s.why : "")]));
};

function codex(home, name, policy, reviewer, tool, args) {
  const d = new Date();
  const dir = path.join(home, ".codex", "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  const lines = [
    { type: "session_meta", timestamp: ago(70), payload: { id, cwd: "/tmp/" + name } },
    { type: "turn_context", timestamp: ago(70), payload: { model: "gpt-6.1-sol", approval_policy: policy, approvals_reviewer: reviewer } },
    { type: "event_msg", timestamp: ago(70), payload: { type: "task_started" } },
    { type: "response_item", timestamp: ago(69), payload: { type: "message", role: "user", content: [{ type: "input_text", text: name }] } },
    { type: "response_item", timestamp: ago(60), payload: { type: "function_call", name: tool, call_id: "c1", arguments: JSON.stringify(args) } },
  ];
  fs.writeFileSync(path.join(dir, `rollout-x-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

test("waiting only when the call could have asked you", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ao-test-"));
  const sh = spawn("/bin/zsh", ["-c", `eval '${RUNNING.replaceAll("'", `'"'"'`)}'`], { stdio: "ignore" });
  try {
    claude(home, "cl-bash-running", "default", "Bash", { command: RUNNING });
    claude(home, "cl-bash-running-quiet", "default", "Bash", { command: RUNNING }, 600);
    claude(home, "cl-bash-blocked", "default", "Bash", { command: "rm -rf build" });
    claude(home, "cl-bypass-bash", "bypassPermissions", "Bash", { command: "rm -rf build" });
    claude(home, "cl-bypass-question", "bypassPermissions", "AskUserQuestion", { questions: [] });
    claude(home, "cl-acceptedits-edit", "acceptEdits", "Edit", { file_path: "/tmp/x" });
    claude(home, "cl-default-edit", "default", "Edit", { file_path: "/tmp/x" });
    claude(home, "cl-default-read", "default", "Read", { file_path: "/tmp/x" });
    codex(home, "cx-never-exec", "never", "user", "exec_command", { cmd: "npm test" });
    codex(home, "cx-onrequest-plain", "on-request", "user", "exec_command", { cmd: "npm test" });
    codex(home, "cx-onrequest-escalated", "on-request", "user", "exec_command", { cmd: "brew install x", sandbox_permissions: "require_escalated" });
    codex(home, "cx-autoreview-escalated", "on-request", "auto_review", "exec_command", { cmd: "brew install x", sandbox_permissions: "require_escalated" });
    codex(home, "cx-never-question", "never", "user", "request_user_input", { questions: [] });
    codex(home, "cx-never-mcp", "never", "user", "mcp__magpie__imagegen", { prompt: "x" });
    await new Promise((r) => setTimeout(r, 300)); // let the shell start

    assert.deepEqual(snapshot(home), {
      "cl-bash-running": "working",
      "cl-bash-running-quiet": "working", // 10 min without a log line, but the command is running
      "cl-bash-blocked": "waiting:approval",
      "cl-bypass-bash": "working",
      "cl-bypass-question": "waiting:question",
      "cl-acceptedits-edit": "working",
      "cl-default-edit": "waiting:approval",
      "cl-default-read": "working",
      "cx-never-exec": "working",
      "cx-onrequest-plain": "working",
      "cx-onrequest-escalated": "waiting:approval",
      "cx-autoreview-escalated": "working",
      "cx-never-question": "waiting:question",
      "cx-never-mcp": "working",
    });
  } finally {
    sh.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Claude Code's live record wins over the log", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ao-test-"));
  // live records need a running pid with a matching start time; each gets its own process
  const procs = [];
  const spawnOne = () => {
    const p = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
    procs.push(p);
    return p.pid;
  };
  const startOf = (pid) => execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { env: { ...process.env, TZ: "UTC" }, encoding: "utf8" }).trim();
  try {
    claude(home, "lv-busy-long-bash", "default", "Bash", { command: "make all" });
    claude(home, "lv-permission", "bypassPermissions", "Read", { file_path: "/tmp/x" });
    claude(home, "lv-question", "default", "AskUserQuestion", { questions: [] });
    claude(home, "lv-input", "default", "mcp__x__login", {});
    claude(home, "lv-idle", "default", null, null);
    claude(home, "lv-dialog", "default", "Bash", { command: "make all" });
    claude(home, "lv-gone", "default", "Bash", { command: "make all" });
    claude(home, "lv-reused-pid", "default", "Bash", { command: "make all" });
    const pids = Array.from({ length: 7 }, spawnOne);
    await new Promise((r) => setTimeout(r, 200));
    live(home, "lv-busy-long-bash", pids[0], startOf(pids[0]), "busy");
    live(home, "lv-permission", pids[1], startOf(pids[1]), "waiting", "permission prompt");
    live(home, "lv-question", pids[2], startOf(pids[2]), "waiting", "permission prompt");
    live(home, "lv-input", pids[3], startOf(pids[3]), "waiting", "input needed");
    live(home, "lv-idle", pids[4], startOf(pids[4]), "idle");
    live(home, "lv-dialog", pids[5], startOf(pids[5]), "waiting", "dialog open");
    live(home, "lv-reused-pid", pids[6], "Mon Jan  1 00:00:00 2024", "waiting", "permission prompt");
    live(home, "lv-gone", 999999, "Mon Jan  1 00:00:00 2024", "waiting", "permission prompt");

    assert.deepEqual(snapshot(home), {
      "lv-busy-long-bash": "working", // Bash pending a minute, not in ps, but Claude says busy
      "lv-permission": "waiting:approval", // the log alone would say working
      "lv-question": "waiting:question",
      "lv-input": "waiting:question",
      "lv-idle": "done",
      "lv-dialog": "waiting:approval", // no verdict from Claude: falls back to the log
      "lv-gone": "aborted", // process ended mid-turn: not waiting on anyone
      "lv-reused-pid": "aborted", // pid now belongs to another process
    });
  } finally {
    for (const p of procs) p.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("tools used, for the profile card", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ao-test-"));
  try {
    const dir = path.join(home, ".claude", "projects", "-tmp-tools");
    fs.mkdirSync(dir, { recursive: true });
    const use = (id, name) => ({ type: "tool_use", id, name, input: {} });
    const lines = [
      { type: "user", cwd: "/tmp/tools", timestamp: ago(30), message: { role: "user", content: "cl-tools" } },
      { type: "assistant", timestamp: ago(29), message: { id: "m1", content: [use("a", "Bash"), use("b", "Read")] } },
      // Claude Code can log one message more than once: count each call once
      { type: "assistant", timestamp: ago(29), message: { id: "m1", content: [use("a", "Bash")] } },
      { type: "user", timestamp: ago(28), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "a" }, { type: "tool_result", tool_use_id: "b" }] } },
      { type: "assistant", timestamp: ago(27), message: { id: "m2", content: [use("c", "Bash"), use("d", "mcp__magpie__web_search")] } },
    ];
    fs.writeFileSync(path.join(dir, "tools.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const out = JSON.parse(execFileSync(process.execPath, [OFFICE, "--once"], { env: { ...process.env, HOME: home }, encoding: "utf8" }));
    assert.deepEqual(out.sessions.find((s) => s.title === "cl-tools").tools, [["Bash", 2], ["Read", 1], ["web_search", 1]]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
