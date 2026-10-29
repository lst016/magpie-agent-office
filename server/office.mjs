#!/usr/bin/env node
// Agent Office: reads Claude Code and Codex session logs on this computer and
// serves a little office view of them on 127.0.0.1, for magpie's page plugin.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const PORT = Number(process.env.AGENT_OFFICE_PORT || 47615);
const WINDOW_H = Number(process.env.AGENT_OFFICE_WINDOW_HOURS || 12);
const MAX_SESSIONS = 40;
const MAX_FILES = 120; // more files than shown: hidden subagent and bridge sessions take some
const PLUGIN = "magpie-agent-office";
const CLAUDE_DIR = path.join(HOME, ".claude", "projects");
const CLAUDE_LIVE_DIR = path.join(HOME, ".claude", "sessions");
const CODEX_DIR = path.join(HOME, ".codex", "sessions");
const CODEX_INDEX = path.join(HOME, ".codex", "session_index.jsonl");
const GROK_DIR = path.join(HOME, ".grok", "sessions");
const GEMINI_HOME = path.join(process.env.GEMINI_CLI_HOME || HOME, ".gemini");
const AG_DIR = path.join(HOME, ".gemini", "antigravity");
const CONF_DIR = path.join(HOME, ".config", "agent-office");
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const PLUGIN_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Status thresholds (ms). A tool call that could have asked you (see "waiting on
// you" below) and has no result after PENDING_MS is shown as waiting.
const PENDING_MS = 20_000;
const STALL_MS = 5 * 60_000;
const FRESH_DONE_MS = 30 * 60_000;
const STALE_MS = 2 * 3_600_000;
// magpie runs Claude Code in these folders to serve a Codex thread on Claude:
// the same work as that thread, so they're left out unless asked for.
const SHOW_BRIDGE = process.env.AGENT_OFFICE_SHOW_BRIDGE === "1";
const isBridge = (cwd) => /\/magpie-claude-work-\d+/.test(cwd || "");

function loadToken() {
  const f = path.join(CONF_DIR, "token");
  try {
    const t = fs.readFileSync(f, "utf8").trim();
    if (t.length >= 24) return t;
  } catch {}
  const t = crypto.randomBytes(24).toString("base64url");
  fs.mkdirSync(CONF_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, t + "\n", { mode: 0o600 });
  return t;
}
const TOKEN = loadToken();

// ---------- incremental JSONL reading ----------

const files = new Map(); // path -> { size, offset, rest, s }

function readNew(file, size, onEntry) {
  let st = files.get(file);
  if (st && size < st.offset) st = null; // truncated or replaced: start over
  if (!st) return null;
  if (size === st.offset) return st;
  const fd = fs.openSync(file, "r");
  try {
    const CHUNK = 4 << 20;
    const buf = Buffer.allocUnsafe(CHUNK);
    while (st.offset < size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - st.offset), st.offset);
      if (n <= 0) break;
      st.offset += n;
      const text = st.rest + buf.toString("utf8", 0, n);
      const lines = text.split("\n");
      st.rest = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        let d;
        try { d = JSON.parse(line); } catch { continue; }
        try { onEntry(st.s, d); } catch {}
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return st;
}

function track(file, size, init, onEntry) {
  if (!files.has(file) || size < files.get(file).offset) {
    files.set(file, { size: 0, offset: 0, rest: "", s: init() });
  }
  return readNew(file, size, onEntry).s;
}

const tsOf = (d) => (d.timestamp ? Date.parse(d.timestamp) || 0 : 0);
const clip = (s, n = 80) => {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
// Editors append context blocks like <editor-context>{…}</editor-context> to what you typed;
// keep only the typed part (an unclosed tag drops everything after it).
const typed = (s) => clip(String(s || "")
  .replace(/<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
  .replace(/(^|\s)<[a-z][\w-]*(\s|>)[\s\S]*$/i, " "));

// ---------- Claude Code ----------

const newSession = () => ({
  title: "", prompt: "", cwd: "", model: "", lastTs: 0, done: false, aborted: false,
  pending: new Map(), lastTool: "", tokens: 0, seen: new Set(), mode: "", asks: null, tools: new Map(),
});

// tool name -> calls, for the profile card's "skills"; MCP tools by their own name
function countTool(s, name) {
  const short = String(name || "").split("__").pop();
  if (short) s.tools.set(short, (s.tools.get(short) || 0) + 1);
}
const topTools = (s, n = 6) => [...s.tools].sort((a, b) => b[1] - a[1]).slice(0, n);

// ---------- "waiting on you" ----------
// Neither log records an approval prompt, so a pending tool call only counts as waiting
// when it could have stopped to ask under the session's permission settings. Claude's
// Bash is checked against running processes: a command that is executing isn't waiting.

const CLAUDE_ASKS = new Set(["AskUserQuestion", "ExitPlanMode"]); // always wait for an answer
const CLAUDE_EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const CLAUDE_MAY_PROMPT = new Set([...CLAUDE_EDITS, "Bash", "WebFetch", "Skill"]);

function claudeWait(s, name, input) {
  if (CLAUDE_ASKS.has(name)) return "question";
  if (s.mode === "bypassPermissions" || s.mode === "dontAsk") return ""; // never prompts
  if (CLAUDE_EDITS.has(name)) return s.mode === "acceptEdits" ? "" : "approval";
  if (name === "Bash" && input?.run_in_background) return ""; // returns at once
  return CLAUDE_MAY_PROMPT.has(name) || name.startsWith("mcp__") ? "approval" : "";
}

const CODEX_SHELLS = new Set(["exec_command", "shell", "shell_command", "local_shell", "container.exec"]);
// What a Codex turn may stop and ask the user for, from its approval policy and reviewer.
function codexAsks(policy, reviewer) {
  const user = !reviewer || reviewer === "user"; // auto_review: a model decides, nobody waits on you
  if (policy && typeof policy === "object") {
    const g = policy.granular || {};
    return { escalate: user && !!g.sandbox_approval, any: false, perms: user && !!g.request_permissions };
  }
  if (policy === "never" || !user) return { escalate: false, any: false, perms: false };
  // untrusted asks before most commands; on-failure asks again after a sandboxed failure
  return { escalate: true, any: policy === "untrusted" || policy === "on-failure", perms: true };
}
const CODEX_DEFAULT_ASKS = codexAsks("on-request", "user");

function codexWait(s, name, args) {
  if (name === "request_user_input") return "question";
  const a = s.asks || CODEX_DEFAULT_ASKS;
  if (name === "request_permissions") return a.perms ? "approval" : "";
  if (name === "apply_patch") return a.escalate ? "approval" : ""; // writes outside the sandbox ask
  if (!CODEX_SHELLS.has(name)) return ""; // MCP tools, write_stdin, agents...: just running
  if (a.any) return "approval";
  const escalated = /"sandbox_permissions"\s*:\s*"require_escalated"|"with_escalated_permissions"\s*:\s*true/.test(args || "");
  return a.escalate && escalated ? "approval" : "";
}

// Claude Code runs Bash as `zsh -c ... eval '<command>' ...`, so a running command is
// visible in `ps`. One process listing per snapshot, and only when a Bash call is pending.
let ps = { at: 0, text: null };
function processText() {
  if (Date.now() - ps.at > 1000) {
    let text = null;
    try { text = execFileSync("ps", ["-axww", "-o", "command="], { encoding: "utf8", maxBuffer: 64 << 20, timeout: 3000 }); } catch {}
    ps = { at: Date.now(), text };
  }
  return ps.text;
}
function bashRunning(cmd) {
  const t = processText();
  if (t == null || !cmd) return false;
  return [`'"'"'`, `'\\''`].some((q) => t.includes(`eval '${cmd.replaceAll("'", q)}'`));
}

// Claude Code keeps a live record per running process in ~/.claude/sessions/<pid>.json:
// status busy | idle | waiting, and for waiting what it waits for. That is its own state,
// so it beats anything read from the log. Kinds below follow Claude Code's own grouping.
const LIVE_APPROVAL = new Set(["permission prompt", "sandbox request", "worker request", "goal proposal"]);
const LIVE_QUESTION = new Set(["input needed"]);

// sessionId -> { status, waitingFor } for processes still running; null if there's no registry
function claudeLive() {
  let names;
  try { names = fs.readdirSync(CLAUDE_LIVE_DIR).filter((n) => /^\d+\.json$/.test(n)); } catch { return null; }
  const recs = [];
  for (const n of names) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(CLAUDE_LIVE_DIR, n), "utf8"));
      if (r.sessionId && Number(r.pid)) recs.push(r);
    } catch {}
  }
  if (!recs.length) return null;
  const alive = recs.map((r) => Number(r.pid)).filter((pid) => {
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
  });
  // the pid must still be the same process: compare its start time (procStart is UTC)
  const started = new Map();
  if (alive.length) {
    let out = "";
    try {
      out = execFileSync("ps", ["-o", "pid=,lstart=", "-p", alive.join(",")],
        { encoding: "utf8", env: { ...process.env, TZ: "UTC" }, timeout: 3000 });
    } catch (e) {
      out = String(e.stdout || ""); // exits 1 if one just ended, still listing the rest
    }
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(.+)$/);
      if (m) started.set(Number(m[1]), m[2].replace(/\s+/g, " ").trim());
    }
  }
  const live = new Map();
  for (const r of recs) {
    const st = started.get(Number(r.pid));
    if (!st || (r.procStart && st !== String(r.procStart).replace(/\s+/g, " ").trim())) continue;
    live.set(r.sessionId, { status: r.status, waitingFor: r.waitingFor || "" });
  }
  return live;
}

function claudeEntry(s, d) {
  if (d.type === "ai-title" && d.aiTitle) s.title = d.aiTitle;
  if (d.type === "custom-title" && (d.customTitle || d.title)) s.custom = d.customTitle || d.title;
  if (d.permissionMode) s.mode = d.permissionMode; // on user lines and "permission-mode" lines
  if (d.type !== "user" && d.type !== "assistant") return;
  if (d.isSidechain) return; // a subagent's lines, when they share the file
  const ts = tsOf(d);
  if (ts) s.lastTs = Math.max(s.lastTs, ts);
  if (d.cwd) s.cwd = d.cwd;
  const m = d.message || {};
  const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
  if (d.type === "user") {
    let results = false;
    for (const b of blocks) {
      if (b?.type === "tool_result") { results = true; s.pending.delete(b.tool_use_id); }
    }
    if (results) return;
    const text = blocks.filter((b) => b?.type === "text").map((b) => b.text || "").join(" ");
    if (/\[Request interrupted by user/.test(text)) { s.done = true; s.aborted = true; s.pending.clear(); return; }
    if (d.isMeta || /^\s*<(command-|local-command|system-reminder)/.test(text)) return;
    if (!s.prompt && text.trim() && !/^\s*</.test(text)) s.prompt = typed(text);
    s.done = false; s.aborted = false;
    return;
  }
  if (m.model && !m.model.startsWith("<")) s.model = m.model;
  if (m.id && m.usage && !s.seen.has(m.id)) {
    s.seen.add(m.id);
    const u = m.usage;
    s.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  }
  let tool = false;
  for (const b of blocks) {
    if (b?.type !== "tool_use") continue;
    tool = true;
    s.lastTool = b.name;
    if (!s.seen.has("t:" + b.id)) { s.seen.add("t:" + b.id); countTool(s, b.name); }
    s.pending.set(b.id, {
      name: b.name, since: ts, wait: claudeWait(s, b.name || "", b.input),
      cmd: b.name === "Bash" ? String(b.input?.command || "") : "",
    });
  }
  if (tool) s.done = false;
  else if (m.stop_reason === "end_turn" || m.stop_reason === "stop_sequence") s.done = true;
}

function scanClaude(since) {
  const out = [];
  let projects = [];
  try { projects = fs.readdirSync(CLAUDE_DIR); } catch { return out; }
  for (const p of projects) {
    const dir = path.join(CLAUDE_DIR, p);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue;
      const f = path.join(dir, n);
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < since) continue;
      out.push({ agent: "claude", id: n.slice(0, -6), file: f, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out;
}

// ---------- Codex ----------

function codexEntry(s, d) {
  const p = d.payload || {};
  const ts = tsOf(d);
  if (d.type === "session_meta") {
    s.cwd = p.cwd || s.cwd;
    s.sub = p.thread_source && p.thread_source !== "user";
    return;
  }
  if (d.type === "turn_context") {
    if (p.model) s.model = p.model;
    s.asks = codexAsks(p.approval_policy, p.approvals_reviewer);
  }
  if (ts && d.type !== "session_meta") s.lastTs = Math.max(s.lastTs, ts);
  if (d.type === "event_msg") {
    if (p.type === "task_started") { s.done = false; s.aborted = false; }
    else if (p.type === "task_complete") { s.done = true; s.pending.clear(); }
    else if (p.type === "turn_aborted") { s.done = true; s.aborted = true; s.pending.clear(); }
    else if (p.type === "token_count" && p.info?.total_token_usage) s.tokens = p.info.total_token_usage.total_tokens || s.tokens;
    return;
  }
  if (d.type !== "response_item") return;
  if (p.type === "function_call" || p.type === "custom_tool_call") {
    s.pending.set(p.call_id || p.id, { name: p.name, since: ts, wait: codexWait(s, p.name || "", p.arguments) });
    s.lastTool = p.name;
    countTool(s, p.name);
  } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
    s.pending.delete(p.call_id);
  } else if (p.type === "message" && p.role === "user" && !s.prompt) {
    const text = (p.content || []).map((c) => c.text || "").join(" ");
    if (text && !/^\s*(<|#\s*AGENTS\.md)/.test(text)) s.prompt = typed(text);
  }
}

function codexDays(since) {
  const days = [];
  for (let t = Date.now(); t >= since - 86_400_000; t -= 86_400_000) {
    const d = new Date(t);
    days.push(path.join(CODEX_DIR, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")));
  }
  return [...new Set(days)];
}

function scanCodex(since) {
  const out = [];
  for (const dir of codexDays(since)) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue;
      const f = path.join(dir, n);
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < since) continue;
      const id = (n.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/) || [])[1] || n;
      out.push({ agent: "codex", id, file: f, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out;
}

// Codex Desktop's thread names, appended to as threads are named or renamed.
const codexNames = new Map();
function readCodexNames() {
  let size;
  try { size = fs.statSync(CODEX_INDEX).size; } catch { return; }
  track(CODEX_INDEX, size, () => ({}), (_s, d) => { if (d.id && d.thread_name) codexNames.set(d.id, typed(d.thread_name)); });
}

// ---------- Grok CLI ----------
// ~/.grok/sessions/<url-encoded cwd>/<id>/: events.jsonl says when a turn starts and ends and
// when it asks for permission, so "waiting" needs no guessing; summary.json and usage.json
// hold the title, model and tokens.

function grokEntry(s, d) {
  const ts = tsOf({ timestamp: d.ts });
  if (ts) s.lastTs = Math.max(s.lastTs, ts);
  switch (d.type) {
    case "turn_started":
      s.done = false; s.aborted = false; s.pending.clear();
      if (d.model_id) s.model = d.model_id;
      return;
    case "tool_started":
      s.lastTool = d.tool_name;
      s.pending.set("t:" + d.tool_name, { name: d.tool_name, since: ts, wait: "" });
      countTool(s, d.tool_name);
      return;
    case "tool_completed": s.pending.delete("t:" + d.tool_name); return;
    case "permission_requested":
      s.pending.set("p:" + d.tool_name, { name: d.tool_name, since: ts, wait: "approval", sure: true });
      return;
    case "permission_resolved": s.pending.delete("p:" + d.tool_name); return;
    case "turn_ended":
      s.done = true; s.aborted = d.outcome !== "completed"; s.pending.clear();
      return;
  }
}

const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

function scanGrok(since) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(GROK_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    let ids = [];
    try { ids = fs.readdirSync(path.join(GROK_DIR, d.name)); } catch { continue; }
    for (const id of ids) {
      const base = path.join(GROK_DIR, d.name, id), f = path.join(base, "events.jsonl");
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < since) continue;
      out.push({
        agent: "grok", id, file: f, size: st.size, mtime: st.mtimeMs,
        after(s) {
          const m = readJSON(path.join(base, "summary.json")) || {};
          s.cwd = m.info?.cwd || s.cwd;
          s.title = m.generated_title || m.session_summary || s.title;
          s.model = m.current_model_id || s.model;
          s.sub = String(m.session_kind || "").startsWith("subagent");
          const u = readJSON(path.join(base, "usage.json"));
          if (u?.session?.totalTokens) s.tokens = u.session.totalTokens;
        },
      });
    }
  }
  return out;
}

// ---------- Gemini CLI ----------
// ~/.gemini/tmp/<project slug>/chats/session-*.jsonl: messages, with each tool call's status
// (awaiting_approval while it asks you). ~/.gemini/projects.json maps folders to slugs.

const GEMINI_RUNNING = new Set(["validating", "scheduled", "executing"]);
const geminiText = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map(geminiText).join("") : c && typeof c.text === "string" ? c.text : "";

function geminiEntry(s, d) {
  const meta = d.$set || (d.sessionId && !d.type ? d : null);
  if (meta) {
    if (meta.summary) s.title = meta.summary;
    if (Array.isArray(meta.directories) && meta.directories[0]) s.cwd = meta.directories[0];
    if (meta.kind === "subagent") s.sub = true;
    if (Array.isArray(meta.messages)) for (const m of meta.messages) geminiEntry(s, m);
    return;
  }
  if (!d.type) return;
  const ts = tsOf(d);
  if (ts) s.lastTs = Math.max(s.lastTs, ts);
  if (d.type === "user") {
    const text = geminiText(d.displayContent ?? d.content);
    if (!text.trim() || /^\s*</.test(text)) return; // session context, not something you typed
    if (!s.prompt) s.prompt = typed(text);
    s.done = false; s.aborted = false; s.pending.clear();
  } else if (d.type === "gemini") {
    if (d.model) s.model = d.model;
    if (d.tokens?.total) s.tokens += d.tokens.total;
    const calls = Array.isArray(d.toolCalls) ? d.toolCalls : [];
    s.pending.clear();
    for (const c of calls) {
      const name = c.name || c.displayName || "tool";
      if (c.id && !s.seen.has("t:" + c.id)) { s.seen.add("t:" + c.id); countTool(s, name); }
      if (c.status === "awaiting_approval") s.pending.set(c.id || name, { name, since: ts, wait: "approval", sure: true });
      else if (GEMINI_RUNNING.has(c.status)) s.pending.set(c.id || name, { name, since: ts, wait: "" });
      s.lastTool = name;
    }
    // text with nothing left to run is the end of the turn (a later line reopens it)
    s.done = !s.pending.size && !!geminiText(d.content).trim();
  } else if ((d.type === "info" || d.type === "warning") && /cancel|interrupt/i.test(geminiText(d.content))) {
    s.done = true; s.aborted = true; s.pending.clear();
  } else if (d.type === "error") {
    s.done = true; s.aborted = true; s.pending.clear();
  }
}

function scanGemini(since) {
  const out = [];
  const tmp = path.join(GEMINI_HOME, "tmp");
  const slugs = new Map(Object.entries(readJSON(path.join(GEMINI_HOME, "projects.json"))?.projects || {}).map(([dir, slug]) => [slug, dir]));
  let projects = [];
  try { projects = fs.readdirSync(tmp); } catch { return out; }
  for (const p of projects) {
    const chats = path.join(tmp, p, "chats");
    let names = [];
    try { names = fs.readdirSync(chats); } catch { continue; }
    for (const n of names) {
      if (!/^session-.*\.jsonl$/.test(n)) continue;
      const f = path.join(chats, n);
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < since) continue;
      out.push({ agent: "gemini", id: n.slice(0, -6), file: f, size: st.size, mtime: st.mtimeMs,
        after(s) { if (!s.cwd && slugs.has(p)) s.cwd = slugs.get(p); } });
    }
  }
  return out;
}

// ---------- Antigravity ----------
// ~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl lists the steps;
// conversation_summaries.db has the title, folder and run status, which plays the part of
// Claude Code's live record.

function agEntry(s, d) {
  const ts = tsOf({ timestamp: d.created_at });
  if (ts) s.lastTs = Math.max(s.lastTs, ts);
  const text = typeof d.content === "string" ? d.content : "";
  if (d.type === "USER_INPUT") {
    const ask = text.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
    if (ask && !s.prompt) s.prompt = typed(ask[1]);
    const model = text.match(/`Model Selection` from .*? to (.+?)\. /);
    if (model) s.model = model[1];
    s.done = false; s.aborted = false;
  } else if (d.type && d.type !== "USER_INPUT") {
    const name = d.tool_name || d.toolName || (d.type !== "PLANNER_RESPONSE" && d.type !== "GENERIC" ? d.type.toLowerCase() : "");
    if (name) { s.lastTool = name; countTool(s, name); }
  }
}

let agCache = { mtime: -1, map: new Map() };
function antigravityState() {
  const db = path.join(AG_DIR, "conversation_summaries.db");
  let mtime;
  try { mtime = fs.statSync(db).mtimeMs; } catch { return agCache.map; }
  try { mtime = Math.max(mtime, fs.statSync(db + "-wal").mtimeMs); } catch {} // new rows land in the WAL first
  if (mtime === agCache.mtime) return agCache.map;
  const map = new Map();
  const sql = "select conversation_id id, title, workspace_uris ws, status, killed from conversation_summaries";
  // read-only; a copy without its -shm file can only be opened as immutable
  for (const target of [["-readonly", db], [`file:${db}?immutable=1`]]) {
    try {
      const rows = JSON.parse(execFileSync("sqlite3", ["-json", ...target, sql],
        { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }) || "[]");
      for (const r of rows) map.set(r.id, r);
      break;
    } catch {}
  }
  agCache = { mtime, map };
  return map;
}

// the run status as a live record: RUNNING = busy, IDLE = idle, anything waiting = a prompt
function agLive(r) {
  if (!r) return undefined;
  if (Number(r.killed)) return null;
  const st = String(r.status || "");
  if (/WAIT|APPROV|PERMISSION/.test(st)) return { status: "waiting", waitingFor: "permission prompt" };
  if (/RUNNING|BUSY/.test(st)) return { status: "busy" };
  if (/IDLE|DONE|COMPLETE/.test(st)) return { status: "idle" };
  return undefined;
}

function scanAntigravity(since) {
  const out = [];
  const brain = path.join(AG_DIR, "brain");
  let ids = [];
  try { ids = fs.readdirSync(brain); } catch { return out; }
  for (const id of ids) {
    const f = path.join(brain, id, ".system_generated", "logs", "transcript.jsonl");
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (st.mtimeMs < since) continue;
    out.push({ agent: "antigravity", id, file: f, size: st.size, mtime: st.mtimeMs,
      after(s) {
        const ws = String(agCache.map.get(id)?.ws || "").split(/[\s,]+/)[0];
        if (ws && !s.cwd) s.cwd = decodeURIComponent(ws.replace(/^file:\/\//, ""));
      } });
  }
  return out;
}

const ENTRY = { claude: claudeEntry, codex: codexEntry, grok: grokEntry, gemini: geminiEntry, antigravity: agEntry };

// ---------- status ----------

// live: Claude Code's record for this session; null when the registry has none (its process
// ended), undefined when there's nothing to go by (Codex, or no registry)
function statusOf(s, now, live) {
  const age = now - s.lastTs;
  const finished = (aborted = s.aborted) => {
    if (aborted && age < FRESH_DONE_MS) return { state: "aborted", tool: "" };
    return { state: age < FRESH_DONE_MS ? "done" : "idle", tool: "" };
  };
  // the process ended mid-turn: whatever the log left pending, nobody is asking you anything
  if (live === null) return finished(s.aborted || !s.done);
  // Claude Code's own live state, when its process is running (live is undefined otherwise)
  if (live) {
    const asking = [...s.pending.values()].find((v) => v.wait === "question");
    if (live.status === "waiting" && LIVE_APPROVAL.has(live.waitingFor)) {
      return { state: "waiting", tool: asking ? asking.name : latestTool(s), why: asking ? "question" : "approval" };
    }
    if (live.status === "waiting" && LIVE_QUESTION.has(live.waitingFor)) return { state: "waiting", tool: latestTool(s), why: "question" };
    if (live.status === "busy") return { state: "working", tool: s.pending.size ? latestTool(s) : "" };
    if (live.status === "idle" && !asking) return finished();
    // "dialog open" and anything new: fall through to the log
  }
  if (!s.done) {
    let ask = null, busy = false, latest = null;
    for (const v of s.pending.values()) {
      if (!latest || v.since > latest.since) latest = v;
      if (!v.wait || !v.since || (!v.sure && now - v.since <= PENDING_MS)) continue;
      if (v.cmd && bashRunning(v.cmd)) { busy = true; continue; } // executing, not waiting on approval
      if (!ask || v.since < ask.since) ask = v;
    }
    if (ask) return { state: age > STALL_MS * 6 ? "stalled" : "waiting", tool: ask.name, why: ask.wait };
    // a long command writes nothing to the log while it runs, so the process keeps it "working"
    if (age < STALL_MS || busy) return { state: "working", tool: latest ? latest.name : "" };
    return { state: age < STALE_MS ? "stalled" : "idle", tool: "" };
  }
  return finished();
}

function latestTool(s) {
  let latest = null;
  for (const v of s.pending.values()) if (!latest || v.since > latest.since) latest = v;
  return latest ? latest.name : "";
}

function snapshot() {
  const now = Date.now();
  const since = now - WINDOW_H * 3_600_000;
  readCodexNames();
  const live = claudeLive();
  const ag = antigravityState();
  const found = [...scanClaude(since), ...scanCodex(since), ...scanGrok(since), ...scanGemini(since), ...scanAntigravity(since)]
    .sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES);
  const sessions = [];
  for (const f of found) {
    const s = track(f.file, f.size, newSession, ENTRY[f.agent]);
    if (f.after) f.after(s);
    if (!s.cwd && !s.tokens && !s.prompt) continue; // nothing said in it yet
    if (!SHOW_BRIDGE && f.agent === "claude" && isBridge(s.cwd)) continue;
    if (!s.lastTs) s.lastTs = f.mtime;
    const rec = f.agent === "claude" && live ? live.get(f.id) ?? null : f.agent === "antigravity" ? agLive(ag.get(f.id)) : undefined;
    const { state, tool, why = "" } = statusOf(s, now, rec);
    if (s.sub && state !== "working" && state !== "waiting") continue;
    if (sessions.length >= MAX_SESSIONS) break;
    const title = f.agent === "codex" ? codexNames.get(f.id) || s.prompt
      : f.agent === "antigravity" ? ag.get(f.id)?.title || s.prompt : s.custom || s.title || s.prompt;
    sessions.push({
      agent: f.agent, id: f.id, state, tool, why,
      title: clip(title || path.basename(s.cwd || "") || f.id, 60),
      project: path.basename(s.cwd || ""),
      model: s.model, tokens: s.tokens, sub: !!s.sub, tools: topTools(s),
      lastAt: new Date(s.lastTs).toISOString(),
    });
  }
  // drop parse state of files that left the window
  const keep = new Set(found.map((f) => f.file).concat(CODEX_INDEX));
  for (const k of files.keys()) if (!keep.has(k)) files.delete(k);
  return { now: new Date(now).toISOString(), windowHours: WINDOW_H, sessions };
}

// ---------- HTTP ----------

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".json": "application/json",
};
const okHost = (h) => h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
const sameToken = (k) => {
  const a = Buffer.from(String(k || "")), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

let cache = { at: 0, body: "" };
const server = http.createServer((req, res) => {
  // Host check keeps DNS-rebinding pages out; the token keeps other local pages out.
  if (!okHost(req.headers.host)) { res.writeHead(421).end(); return; }
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === "/api/state") {
    const h = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
    if (!sameToken(u.searchParams.get("k"))) { res.writeHead(401, h).end('{"error":"token"}'); return; }
    if (Date.now() - cache.at > 1500) cache = { at: Date.now(), body: JSON.stringify(snapshot()) };
    res.writeHead(200, h).end(cache.body);
    return;
  }
  // Only flat public files and whitelisted asset directories; basename prevents traversal.
  const name = u.pathname === "/" ? "office.html" : path.basename(u.pathname);
  const folder = /^\/(sprites|vendor|models)\/[^/]+$/.exec(u.pathname)?.[1] || "";
  if (u.pathname !== "/" && u.pathname !== `/${name}` && !folder) { res.writeHead(404).end(); return; }
  const sprite = folder === "sprites";
  const file = path.join(PUBLIC, folder, name);
  if (!TYPES[path.extname(name)] || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  // 'self' can mean nothing to an opaque (sandboxed) origin, so name the server too
  const me = `'self' http://${req.headers.host}`;
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(name)],
    "Access-Control-Allow-Origin": "*", // the frame's origin is opaque (sandboxed)
    // sprite URLs carry ?v=<content hash>; meta.json holds that hash, so it must stay fresh
    "Cache-Control": sprite && name !== "meta.json" ? "max-age=3600" : "no-cache",
    "Content-Security-Policy": `default-src ${me}; style-src ${me} 'unsafe-inline'; img-src ${me} data: blob:; connect-src ${me}`,
  });
  fs.createReadStream(file).pipe(res);
});

// Installed from npm the plugin goes by its package name; from a folder, by its path.
function tellMagpie(names = [PLUGIN, PLUGIN_DIR]) {
  const opts = JSON.stringify({ port: PORT, token: TOKEN, dir: PLUGIN_DIR });
  const [name, ...rest] = names;
  execFile("magpie", ["plugin", "options", name, opts], (err, _out, stderr) => {
    if (!err) return console.log(`magpie's page knows the address now (${name}).`);
    if (rest.length) return tellMagpie(rest);
    console.log(`magpie plugin options didn't take it (${clip(stderr || err.message, 160)}).\nInstall the plugin first (magpie plugin add <this folder>), then restart this server.`);
  });
}

if (process.argv.includes("--once")) {
  console.log(JSON.stringify(snapshot(), null, 2));
} else {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Agent Office on http://127.0.0.1:${PORT}/?k=${TOKEN}`);
    if (!process.argv.includes("--no-magpie")) tellMagpie();
  });
}
