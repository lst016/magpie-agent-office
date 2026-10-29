(() => {
  const q = new URLSearchParams(location.search);
  const DEMO = ["1", "2"].includes(q.get("demo")) ? q.get("demo") : "";
  const KEY = q.get("k") || "";
  const ZH = (q.get("lang") || navigator.language || "zh").startsWith("zh");
  if (q.get("dark") === "1") document.documentElement.dataset.theme = "dark";
  const TW = q.get("lang") === "zh-TW";
  document.documentElement.lang = ZH ? (TW ? "zh-TW" : "zh-CN") : "en";

  const T = ZH ? {
    title: "Agent 办公室", lounge: "休息区", tokensToday: "magpie 今日 Token", callsToday: "请求", costToday: "花费",
    working: "进行中", waiting: "等你", done: "刚完成", all: "总计", list: "会话",
    s: { working: "干活中", waiting: "可能在等你", done: "已完成，待查看", stalled: "没动静了", aborted: "被中断", idle: "空闲" },
    why: { approval: "等你批准", question: "等你回答" },
    tool: "工具", ago: (m) => (m < 1 ? "刚刚" : m < 60 ? `${m} 分钟前` : `${Math.floor(m / 60)} 小时前`),
    note: (h) => `最近 ${h} 小时 · 每 3 秒刷新 · “等你”按权限设置与进程推断`, emptyLounge: "没人摸鱼",
    noKey: "缺少访问令牌。请从 magpie 的 Agent 办公室页打开，或使用服务启动时打印的地址。",
    down: "连不上本机服务。请确认 office.mjs 还在运行。",
  } : {
    title: "Agent Office", lounge: "Lounge", tokensToday: "magpie tokens today", callsToday: "Calls", costToday: "Cost",
    working: "Working", waiting: "Waiting", done: "Done", all: "Total", list: "Sessions",
    s: { working: "working", waiting: "maybe waiting on you", done: "done, unread", stalled: "gone quiet", aborted: "interrupted", idle: "idle" },
    why: { approval: "waiting for your approval", question: "waiting for your answer" },
    tool: "tool", ago: (m) => (m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`),
    note: (h) => `last ${h} h · refreshes every 3 s · "waiting" is inferred from permissions and processes`, emptyLounge: "nobody's slacking",
    noKey: "No access token. Open this from magpie's Agent Office page, or use the address the server printed.",
    down: "Can't reach the local server. Is office.mjs still running?",
  };
  Object.assign(T, ZH ? {
    filter: "Agent", allAgents: "全部 Agent", reset: "复位视角", sceneHelp: "拖拽旋转 · 滚轮缩放 · 双击复位",
    skills: "技能", activity: "最近活动", close: "关闭", fallback: "3D 不可用，已切换至 2D", loading: "正在准备 3D 办公室…", demo: "演示数据",
  } : {
    filter: "Agent", allAgents: "All agents", reset: "Reset view", sceneHelp: "Drag to orbit · Scroll to zoom · Double-click to reset",
    skills: "Skills", activity: "Last activity", close: "Close", fallback: "3D unavailable, showing 2D", loading: "Preparing the 3D office…", demo: "Demo data",
  });
  if (TW) Object.assign(T, {
    title: "Agent 辦公室", lounge: "休息區", callsToday: "請求", costToday: "花費", working: "進行中", done: "剛完成", all: "總計", list: "工作階段",
    s: { working: "工作中", waiting: "可能在等你", done: "已完成，待查看", stalled: "暫無動靜", aborted: "已中斷", idle: "閒置" },
    why: { approval: "等你批准", question: "等你回答" }, allAgents: "全部 Agent", reset: "重設視角",
    sceneHelp: "拖曳旋轉 · 滾輪縮放 · 連按兩下重設", activity: "最近活動", close: "關閉", fallback: "3D 無法使用，已切換至 2D", loading: "正在準備 3D 辦公室…", demo: "示範資料",
    note: h => `最近 ${h} 小時 · 每 3 秒更新 ·「等你」依權限設定與程序推斷`,
    ago: m => m < 1 ? "剛剛" : m < 60 ? `${m} 分鐘前` : `${Math.floor(m / 60)} 小時前`,
  });
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = T[el.dataset.t] ?? el.textContent;

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => {
    n = Number(n);
    if (!isFinite(n) || n < 0) return "—";
    if (ZH) return n >= 1e8 ? (n / 1e8).toFixed(2) + "亿" : n >= 1e4 ? (n / 1e4).toFixed(1) + "万" : String(Math.round(n));
    return n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // magpie's own usage, handed over in the URL by the plugin page
  if (q.get("tokens")) $("uTokens").textContent = fmt(q.get("tokens"));
  if (q.get("calls")) $("uCalls").textContent = fmt(q.get("calls"));
  if (q.get("cost") && isFinite(+q.get("cost"))) $("uCost").textContent = "$" + (+q.get("cost")).toFixed(2);

  // Sprites rendered in Blender from the Tripo model (see art/). Each desk is three stacked
  // layers - floor+chair, the creature, desk+laptop - so the creature can move on its own.
  const THEME = q.get("dark") === "1" ? "dark" : "light";
  const AGENTS = new Set(["claude", "codex", "gemini", "grok", "antigravity"]);
  // colour follows the model family (orange = Claude models), falling back to the harness
  const who = (s) => /claude|anthropic|opus|sonnet|haiku/i.test(s.model || "") ? "claude"
    : /gemini|google/i.test(s.model || "") ? "gemini"
    : /grok|xai/i.test(s.model || "") ? "grok"
    : /antigravity/i.test(s.model || "") ? "antigravity"
    : /gpt|codex|openai|o[134](?:-|$)/i.test(s.model || "") ? "codex"
    : s.model ? "codex" : AGENTS.has(s.agent) ? s.agent : "claude";
  const avatar3d = () => '/models/xiaoque_avatar.webp';
  const avatar = s => mode === "3d" ? avatar3d(who(s)) : solo(s);
  // Existing 2D sprites cover two families; other families use the Codex silhouette.
  const spriteFamily = s => who(s) === "claude" ? "claude" : "codex";
  const SCREEN = { working: "working", waiting: "waiting", done: "done", stalled: "stalled", aborted: "aborted" };
  let ver = ""; // ?v=<content hash> from meta.json, so fresh renders bypass the sprite cache
  const sprite = (name) => `sprites/${name}.webp${ver}`;
  const mascotFor = (s) => sprite(`mascot_${spriteFamily(s)}_${s.state === "stalled" ? "off" : SCREEN[s.state] || "off"}`);
  const solo = (s) => sprite(`mascot_${spriteFamily(s)}_solo`);
  const metaReady = fetch("sprites/meta.json", { cache: "no-store" }).then((r) => r.json()).then((m) => {
    if (m.v) ver = `?v=${encodeURIComponent(m.v)}`;
    if (!m.glow) return;
    document.documentElement.style.setProperty("--gx", m.glow[0] + "%");
    document.documentElement.style.setProperty("--gy", m.glow[1] + "%");
  }).catch(() => {}).then(() => { const art = $("loungeArt"); if (art) art.src = sprite(`lounge_${THEME}`); });

  const label = (s) => (s.state === "waiting" && T.why[s.why]) || T.s[s.state];
  const bubbleOf = { waiting: "!", done: "✓", stalled: "z", aborted: "×" };
  const ON_DESK = new Set(["working", "waiting", "done", "stalled", "aborted"]);
  const ORDER = { waiting: 0, working: 1, done: 2, aborted: 3, stalled: 4, idle: 5 };
  const mins = (iso, now) => Math.max(0, Math.round((now - Date.parse(iso)) / 60000));

  // sofa seats, as % of the lounge picture; extra guests stand on the rug
  const SEATS = [[19, 58], [28, 58], [37, 58], [46, 58], [55, 58], [24, 96], [42, 96], [76, 96], [90, 96], [10, 96]];

  let first = true;
  document.body.classList.add("intro");
  // Only touch what changed, so running animations aren't restarted every poll.
  const drawn = {};
  function setHTML(id, html) {
    if (drawn[id] === html) return;
    drawn[id] = html;
    $(id).innerHTML = html;
  }
  let latest = null;
  function render(data) {
    latest = data;
    const now = Date.parse(data.now) || Date.now();
    const list = data.sessions.filter(s => $("agentFilter").value === "all" || s.agent === $("agentFilter").value).sort((a, b) => ORDER[a.state] - ORDER[b.state] || Date.parse(b.lastAt) - Date.parse(a.lastAt));
    const desk = list.filter((s) => ON_DESK.has(s.state));
    const idle = list.filter((s) => !ON_DESK.has(s.state));
    $("note").textContent = `${DEMO ? T.demo + " · " : ""}${T.note(data.windowHours)}${sceneFailure ? " · " + T.fallback : ""}`;
    sceneApi?.update(list);
    if (selectedKey) { const selected = list.find(s => sessionKey(s) === selectedKey); if (selected) fillInfo(selected); else closeInfo(); }

    const cells = desk.map((s, i) => `
      <div class="desk s-${s.state}" style="--i:${first ? i : 0}" title="${esc(s.title)}">
        <div class="tag"><b>${esc(s.title)}</b><div class="sub"><span class="st">${esc(label(s))}</span>${s.tool ? " · " + esc(s.tool) : ""} · ${esc(s.project || s.agent)}</div></div>
        <div class="stage">
          <img src="${sprite("back_" + THEME)}" alt="">
          <img class="mascot" src="${mascotFor(s)}" alt="">
          <img src="${sprite(`front_${THEME}_${SCREEN[s.state] || "off"}`)}" alt="">
          ${s.state === "stalled" ? "" : '<div class="glow"></div>'}
          ${bubbleOf[s.state] ? `<div class="bubble">${bubbleOf[s.state]}</div>` : ""}
        </div>
      </div>`);
    // keep the room furnished: empty desks up to a row's worth
    for (let i = desk.length; i < Math.max(3, desk.length + (desk.length % 2)); i++) {
      cells.push(`<div class="desk empty" style="--i:${first ? i : 0}"><div class="tag"><b>-</b><div class="sub">-</div></div>
        <div class="stage"><img src="${sprite("back_" + THEME)}" alt=""><img src="${sprite(`front_${THEME}_off`)}" alt=""></div></div>`);
    }
    setHTML("desks", cells.join(""));

    setHTML("lounge", idle.length
      ? idle.slice(0, SEATS.length).map((s, i) => `<div class="sit s-idle" style="--i:${i};left:${SEATS[i][0]}%;bottom:${100 - SEATS[i][1]}%" data-title="${esc(s.title)} · ${esc(T.ago(mins(s.lastAt, now)))}"><img src="${solo(s)}" alt=""></div>`).join("")
      : `<div class="lounge-empty">${T.emptyLounge}</div>`);

    const n = (st) => list.filter((s) => s.state === st).length;
    $("nWorking").textContent = n("working");
    $("nWaiting").textContent = n("waiting");
    $("nDone").textContent = n("done");
    $("nAll").textContent = list.length;

    setHTML("list", list.map((s) => `
      <li class="s-${s.state}" style="--agent-color:${palette[who(s)]}" tabindex="0" data-session="${esc(sessionKey(s))}">
        <span class="av"><img src="${avatar(s)}" alt=""></span>
        <span class="t">${esc(s.title)}</span>
        <span class="st">${esc(label(s))}</span>
        <span class="m">${esc(s.project)} · ${esc(s.model || s.agent)} · ${fmt(s.tokens)} tok · ${esc(T.ago(mins(s.lastAt, now)))}</span>
      </li>`).join(""));
    if (first) setTimeout(() => document.body.classList.remove("intro"), 1500);
    first = false;
  }

  const palette = { claude: "#e3875f", codex: "#8fa3c9", gemini: "#a58be0", grok: "#868b94", antigravity: "#6dbf94" };
  const sessionKey = s => `${s.agent}:${s.id}`;
  let selectedKey = "", pinned = false, hoverTimer = 0;
  function fillInfo(s) {
    const tools = Array.isArray(s.tools) ? s.tools : [];
    const now = Date.parse(latest?.now) || Date.now();
    $("sessionInfo").innerHTML = `<button class="info-close" type="button" aria-label="${esc(T.close)}">×</button>
      <div class="info-heading"><span class="info-avatar" style="--agent-color:${palette[who(s)]};background:${mode === "3d" ? "transparent" : palette[who(s)]}">${mode === "3d" ? `<img src="${avatar3d(who(s))}" alt="">` : esc(who(s).slice(0, 1).toUpperCase())}</span><b>${esc(s.title)}</b></div>
      <p>${esc(s.project || "—")} · ${esc(s.model || s.agent)}</p><p class="info-state s-${s.state}">${esc(label(s))}</p>
      <div class="info-facts"><span>Token <b>${fmt(s.tokens)}</b></span><span>${esc(T.activity)} <b>${esc(T.ago(mins(s.lastAt, now)))}</b></span></div>
      ${s.tool ? `<p>${esc(T.tool)}: <b>${esc(s.tool)}</b></p>` : ""}
      ${tools.length ? `<p class="skills-title">${esc(T.skills)}</p><div class="info-skills">${tools.map(([name, count]) => `<span>${esc(name)} <b>${esc(count)}</b></span>`).join("")}</div>` : ""}`;
    $("sessionInfo").querySelector(".info-close").addEventListener("click", closeInfo);
  }
  function showInfo(s, anchor, pin) {
    if (pinned && !pin) return;
    clearTimeout(hoverTimer);
    selectedKey = sessionKey(s); pinned = pin; fillInfo(s);
    if (pin) sceneApi?.setSelection(selectedKey);
    const card = $("sessionInfo"); card.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(12, Math.min(innerWidth - card.offsetWidth - 12, rect.left));
    const top = Math.max(12, Math.min(innerHeight - card.offsetHeight - 12, rect.bottom + 10));
    card.style.left = `${left}px`; card.style.top = `${top}px`;
  }
  function closeInfo() { clearTimeout(hoverTimer); $("sessionInfo").hidden = true; selectedKey = ""; pinned = false; sceneApi?.setSelection(""); }
  function endHover() { clearTimeout(hoverTimer); if (!pinned) hoverTimer = setTimeout(() => { if (!pinned) closeInfo(); }, 160); }
  $("sessionInfo").addEventListener("mouseenter", () => clearTimeout(hoverTimer));
  $("sessionInfo").addEventListener("mouseleave", endHover);
  $("list").addEventListener("click", event => {
    const row = event.target.closest("[data-session]");
    const s = latest?.sessions.find(s => sessionKey(s) === row?.dataset.session);
    if (s) showInfo(s, row, true);
  });
  $("list").addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.target.click(); } });
  document.addEventListener("click", event => { if (!event.target.closest(".session-info, .scene-tag, [data-session]")) closeInfo(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeInfo(); });
  let sceneApi = null, scenePromise = null, sceneFailure = false, mode = "2d", fatal = false;
  function applyMode() {
    if (fatal) return;
    const is3d = mode === "3d";
    document.body.dataset.officeView = mode;
    $("office3d").hidden = !is3d;
    $("desks").hidden = is3d; $("loungeBox").hidden = is3d;
    document.querySelector(".floor").classList.toggle("has-3d", is3d);
    $("resetView").disabled = !is3d;
    document.querySelector('.floor-head .logo').src = is3d ? avatar3d('claude') : sprite('mascot_claude_solo');
    sceneApi?.setActive(is3d);
    // Refresh only the mode-dependent portraits; 2D art and demo state stay unchanged.
    if (latest) render(latest);
  }
  function fallback() {
    if (fatal) return;
    sceneFailure = true; mode = "2d";
    sceneApi?.dispose(); sceneApi = null; scenePromise = null;
    $("office3d").querySelectorAll("canvas").forEach(c => c.remove());
    $("sceneLabels").replaceChildren();
    applyMode(); if (latest) render(latest);
  }
  async function setMode(next) {
    mode = next; closeInfo();
    applyMode();
    if (next !== "3d") return;
    try {
      if (!scenePromise) {
        $("sceneStatus").textContent = T.loading;
        scenePromise = import("./office3d.js").then(m => m.createOffice3D({ host: $("office3d"), labels: $("sceneLabels"), dark: THEME === "dark", who, label, text: T, onSelect: showInfo, onClear: closeInfo, onHoverEnd: endHover, onFailure: fallback }));
      }
      sceneApi = await scenePromise;
      if (fatal) { sceneApi.dispose(); sceneApi = null; return; }
      sceneFailure = false; $("sceneStatus").textContent = "";
      applyMode(); if (latest) render(latest);
    } catch { fallback(); }
  }
  $("resetView").addEventListener("click", () => sceneApi?.reset());
  $("agentFilter").addEventListener("change", () => { closeInfo(); if (latest) render(latest); });
  // 3D is the only user-facing view; 2D stays as the automatic fallback when WebGL or the model fails.
  if (KEY || DEMO) setMode("3d");

  function demoData() {
    if (DEMO === "2") return {
      now: new Date().toISOString(), windowHours: 12,
      sessions: Array.from({ length: 10 }, (_,i) => ({
        id: `demo2-${i}`, agent: i === 0 ? "codex" : "claude", model: i === 0 ? "gpt-6.1" : "claude-sonnet",
        state: i === 0 ? "working" : i === 1 ? "stalled" : "idle", why: "",
        title: i === 0 ? "Evaluate tweet plugin feasibility and implement lazy loading" : i === 1 ? "Can we compress the module and load it lazily without breaking startup?" : `Run exactly this bash command and nothing else: sleep 45 (${i - 1})`,
        project: "agent-office", tokens: 12800 + i * 4700, lastAt: new Date(Date.now() - i * 60000).toISOString(),
        tool: i === 0 ? "Edit" : "", tools: [["Read", 12], ["Edit", 7], ["Bash", 3]],
      })),
    };
    const states = ["working", "waiting", "done", "aborted", "stalled", "idle", "idle", "idle", "idle", "idle"];
    const names = TW ? ["實作辦公室場景", "等候部署批准", "元件檢查完成", "建置已中斷", "等待新的活動", "來杯咖啡", "跑步休息一下", "短暫離席", "沙發上歇一會", "行軍床上補個覺"]
      : ZH ? ["实现办公室场景", "等待部署批准", "组件检查完成", "构建已中断", "等待新的活动", "来杯咖啡", "跑步休息一下", "短暂离席", "沙发上歇一会", "行军床上补个觉"]
      : ["Build the office", "Approve deployment", "Component review", "Build interrupted", "Waiting for activity", "Coffee break", "A quick run", "Away for a moment", "On the sofa", "Napping on the cot"];
    return { now: new Date().toISOString(), windowHours: 6, sessions: states.map((state, i) => ({
      id: `demo-${i}`, agent: ["codex", "claude", "gemini", "grok", "antigravity", "claude", "codex", "gemini", "grok", "antigravity"][i],
      model: ["gpt-6.1", "claude-opus", "gemini", "grok", "antigravity", "claude-sonnet", "gpt-6.1", "gemini", "grok", "antigravity"][i],
      state, why: state === "waiting" ? "approval" : "", title: names[i], project: "agent-office", tokens: 12800 + i * 4700,
      lastAt: new Date(Date.now() - i * 60000).toISOString(), tool: state === "working" ? "Edit" : state === "waiting" ? "Bash" : "",
      tools: [["Read", 12], ["Edit", 7], ["Bash", 3]],
    })) };
  }

  function fail(msg) {
    fatal = true;
    sceneApi?.dispose();
    document.querySelector(".app").innerHTML = `<p class="error">${esc(msg)}</p>`;
  }

  let failures = 0;
  async function tick() {
    try {
      if (DEMO) { render(demoData()); setTimeout(tick, 3000); return; }
      const r = await fetch(`/api/state?k=${encodeURIComponent(KEY)}`, { cache: "no-store" });
      if (r.status === 401) return fail(T.noKey);
      render(await r.json());
      failures = 0;
    } catch {
      if (++failures === 3) $("note").textContent = T.down;
    }
    setTimeout(tick, 3000);
  }
  if (!KEY && !DEMO) fail(T.noKey); else metaReady.then(tick);
})();
