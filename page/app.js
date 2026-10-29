// The page can't fetch (connect-src 'none'), so it hands its frame to the
// local office server, passing the theme and magpie's usage in the URL.
(async () => {
const theme = await magpie.ready;
const zh = String(theme?.lang || "").startsWith("zh");
const T = zh
  ? { msg: "正在打开办公室。如果下面出现无法连接，请先在终端启动本机服务：", go: "重新打开", none: "还没有配置服务地址。先在终端运行：" }
  : { msg: "Opening the office. If it can't connect, start the local server first:", go: "Open again", none: "No server is set up yet. Run this first:" };
// usage:summary's tokens may be a number or split by kind ({input, output, cache_read, ...})
function totalTokens(u) {
  const t = u?.tokens ?? u?.total_tokens;
  if (typeof t === "number") return t;
  if (t && typeof t === "object") {
    if (typeof t.total === "number") return t.total;
    return Object.values(t).reduce((a, v) => a + (typeof v === "number" ? v : typeof v === "object" && v ? Object.values(v).reduce((b, w) => b + (typeof w === "number" ? w : 0), 0) : 0), 0);
  }
  const parts = ["input_tokens", "output_tokens", "input", "output", "cache_read", "cache_write"].map((k) => u?.[k]).filter((v) => typeof v === "number");
  return parts.length ? parts.reduce((a, b) => a + b, 0) : "";
}
const $ = (id) => document.getElementById(id);
const opts = (await magpie.options.get()) || {};
// The server stores its folder in the options; before the first run we only know the shape.
const cmd = `node ${opts.dir || "<plugin folder>"}/server/office.mjs`;
$("cmd").textContent = cmd;
$("cmd").hidden = false;

if (!opts.port || !opts.token) {
  $("msg").textContent = T.none;
} else {
  $("msg").textContent = T.msg;
  const q = new URLSearchParams({ k: opts.token, dark: theme?.dark ? "1" : "0", lang: theme?.lang || "" });
  try {
    const u = await magpie.read("usage:summary", { period: "today" });
    q.set("calls", String(u?.calls ?? ""));
    q.set("tokens", String(totalTokens(u)));
    q.set("cost", String(u?.cost ?? ""));
  } catch {}
  const url = `http://127.0.0.1:${opts.port}/?${q}`;
  $("go").textContent = T.go;
  $("go").hidden = false;
  $("go").onclick = () => { location.href = url; };
  location.href = url;
}
})();
