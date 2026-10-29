// Deterministic footage capture for the promo: virtual rAF clock + per-frame screenshots.
// usage: node capture.mjs <job.json>   job = { name, query, frames, fps, width, height, scale, az0, az1, zoom0, zoom1, warm, click:{frame,selector}, out }
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { name, query = '', frames = 120, fps = 24, width = 1920, height = 1080, scale = 1, warm = 48, angle = 'metal' } = job;
const token = readFileSync(process.env.HOME + '/.config/agent-office/token', 'utf8').trim();
const port = 49500 + Math.floor(Math.random() * 300);
const dir = `/tmp/ao-promo/frames/${name}`; mkdirSync(dir, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--hide-scrollbars', `--window-size=${width},${height}`, `--use-angle=${angle}`, '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/ao-promo/prof-${name}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets; for (let i = 0; i < 100; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch {} await sleep(100); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(), errors = [];
ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown' || m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params).slice(0, 300)); });
const cdp = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
try {
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    let now = 0, nid = 1; const q = [];
    performance.now = () => now;
    window.requestAnimationFrame = cb => { const id = nid++; q.push([id, cb]); return id; };
    window.cancelAnimationFrame = id => { const i = q.findIndex(e => e[0] === id); if (i >= 0) q.splice(i, 1); };
    window.__vt = { step(ms) { now += ms; window.__beforeFrame?.(); for (const [, cb] of q.splice(0)) { try { cb(now); } catch (e) { console.error(e); } } } };
  })();` });
  if (job.sceneOnly) await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.app{grid-template-columns:1fr!important;padding:0!important;gap:0!important}.side,.floor-head,.office-toolbar,.scene-help,.scene-legend{display:none!important}.floor{padding:0!important}'; document.head.append(st); });` });
  await cdp('Page.navigate', { url: `http://127.0.0.1:47615/?k=${encodeURIComponent(token)}&${query}` });
  for (let i = 0; i < 200; i++) { await ev('window.__vt?.step(42)').catch(() => {}); if (await ev("document.querySelector('#office3d')?.dataset.model==='xiaoque' && +document.querySelector('#office3d').dataset.actors>0").catch(() => false)) break; await sleep(100); }
  // Grab scene and camera from the first render after this point.
  await ev(`(async () => { const T = await import('/vendor/three.module.js'); T.Scene.prototype.onBeforeRender = function (r, s, c) { window.__cam = c; window.__scene = s; }; const C = (await import('/vendor/OrbitControls.js')).OrbitControls; const u = C.prototype.update; C.prototype.update = function (...a) { window.__controls = this; return u.apply(this, a); }; window.__T = T; })()`);
  for (let i = 0; i < warm; i++) await ev('__vt.step(42)');
  console.log(await ev("JSON.stringify({m:office3d.dataset.model,a:office3d.dataset.actors,r:office3d.dataset.ready,v:document.body.dataset.officeView,h:document.hidden,c:!!office3d.querySelector('canvas'),st:sceneStatus.textContent})"), errors);
  const has = await ev('!!window.__cam && !!window.__controls'); if (!has) throw new Error('camera not captured');
  // Drive the OrbitControls target and camera together: orbit (az), dolly (zoom) and pan (world offset).
  await ev(`(() => { const T = __T, c = __cam, ctl = __controls; window.__base = ctl.target.clone();
    const off = c.position.clone().sub(__base); window.__r = Math.hypot(off.x, off.z); window.__y = off.y;
    window.__z0 = c.zoom; window.__frame = 0;
    window.__plan = ${JSON.stringify({ frames, az0: job.az0, az1: job.az1, zoom0: job.zoom0, zoom1: job.zoom1, t0: job.t0, t1: job.t1 })};
    window.__beforeFrame = () => { const p = __plan; const k = Math.min(1, __frame / Math.max(1, p.frames - 1)); const e = k < .5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      const lerp = (a, b) => a + (b - a) * e;
      const b = __base.toArray(), p0 = p.t0 || b, p1 = p.t1 || p.t0 || b; const t = new T.Vector3(lerp(p0[0], p1[0]), lerp(p0[1], p1[1]), lerp(p0[2], p1[2]));
      const a = (p.az0 != null ? lerp(p.az0, p.az1 ?? p.az0) : Math.atan2(off.x, off.z) * 180 / Math.PI) * Math.PI / 180;
      ctl.target.copy(t); c.position.set(t.x + Math.sin(a) * __r, t.y + __y, t.z + Math.cos(a) * __r); c.lookAt(t);
      if (p.zoom0 != null) { c.zoom = __z0 * lerp(p.zoom0, p.zoom1 ?? p.zoom0); c.updateProjectionMatrix(); }
    }; })()`);
  if (job.probe) { console.log(await ev(`JSON.stringify((() => { const T = __T, out = []; const roots = new Set(); __scene.traverse(o => { if (o.isSkinnedMesh) { let r = o; while (r.parent && r.parent !== __scene) r = r.parent; roots.add(r); } });
    for (const r of roots) { const w = new T.Vector3(); r.getWorldPosition(w); const s = w.clone().project(__cam); out.push({ w: w.toArray().map(v => +v.toFixed(2)), sx: Math.round((s.x + 1) / 2 * innerWidth), sy: Math.round((1 - s.y) / 2 * innerHeight) }); }
    return { base: __base.toArray(), actors: out, tags: [...document.querySelectorAll('.scene-tag')].map(t => { const b = t.getBoundingClientRect(); return { st: t.dataset.state, txt: t.textContent.trim().slice(0, 12), x: Math.round(b.x + b.width / 2), y: Math.round(b.bottom) }; }) }; })())`)); }
  // The first orbit frame jumps to az0, so render it before recording.
  for (let i = 0; i < 6; i++) await ev('__vt.step(42)');
  for (let f = 0; f < frames; f++) {
    await ev(`window.__frame = ${f}; __vt.step(${(1000 / fps).toFixed(3)})`);
    if (job.click && f === job.click.frame) await ev(`document.querySelector(${JSON.stringify(job.click.selector)})?.click()`);
    const shot = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 93, captureBeyondViewport: false });
    writeFileSync(`${dir}/${String(f).padStart(5, '0')}.jpg`, Buffer.from(shot.data, 'base64'));
  }
  const model = await ev("document.querySelector('#office3d').dataset.model");
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/%05d.jpg`, '-c:v', 'libx264', '-crf', '15', '-preset', 'slow', '-pix_fmt', 'yuv420p', job.out]);
  console.log(JSON.stringify({ name, frames, model, errors }));
} finally { ws.close(); chrome.kill(); }
