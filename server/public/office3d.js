import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as cloneSkeleton } from './vendor/SkeletonUtils.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

const COLORS = { claude: '#e3875f', codex: '#8fa3c9', gemini: '#a58be0', grok: '#868b94', antigravity: '#6dbf94' };
const BODY_COLORS = { claude: '#d88b62', codex: '#7096bd', gemini: '#9e84ce', grok: '#75818b', antigravity: '#60af8b' };
const ACCENT_COLORS = { claude: '#9f4c30', codex: '#3c5d88', gemini: '#67459c', grok: '#414b56', antigravity: '#267956' };
const ACTOR_SCALE = 1.25;
const LABEL_PRIORITY = { waiting: 0, working: 1, aborted: 2, done: 3, stalled: 4, idle: 5 };
const STATES = { working: '#3b82f6', waiting: '#f59e0b', done: '#22a05a', aborted: '#ef4444', stalled: '#526071', idle: '#64748b' };
const DESKS = [4.7, 2.4, -0.6].flatMap(y => [0.9, 3.4].map(x => [x, y]));
// render.py uses Z up and Y away from the camera. Three uses Y up.
const xyz = (x, y, z) => new THREE.Vector3(x, z, -y);
const ZONES = [[-3.0, 5.1, .86], [-2.45, 2.6, 1.00], [-2.9, .6, .495], [1.0, 6.65, .475], [3.32, 6.1, .61]];

export async function createOffice3D({ host, labels, dark, who, label, text, onSelect, onClear, onHoverEnd, onFailure }) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = dark ? 1.35 : 1.12;
  renderer.domElement.setAttribute('aria-label', text.sceneHelp);
  renderer.domElement.setAttribute('role', 'img');
  host.prepend(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-6, 6, 5, -5, .1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = .1;
  controls.minPolarAngle = Math.PI / 7;
  controls.maxPolarAngle = Math.PI * .42;
  controls.minZoom = .75;
  controls.maxZoom = 2.6;
  controls.rotateSpeed = .65;
  controls.zoomSpeed = .75;
  controls.target.copy(xyz(0, 2.4, .45));
  const target = controls.target.clone();
  const query = new URLSearchParams(location.search);
  const requestedAz = Number(query.get('az') ?? 24);
  const requestedZoom = Number(query.get('zoom') || 1);
  const initialZoom = Number.isFinite(requestedZoom) ? THREE.MathUtils.clamp(requestedZoom, .75, 2.6) : 1;
  const azimuth = Number.isFinite(requestedAz) ? requestedAz * Math.PI / 180 : 0;
  const reset = () => {
    const damping = controls.enableDamping;
    controls.enableDamping = false; controls.update(); // Flush any residual orbit inertia.
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(Math.sin(azimuth) * 17.14, 12, Math.cos(azimuth) * 17.14));
    camera.zoom = initialZoom;
    camera.updateProjectionMatrix();
    controls.update();
    fitRoom();
    controls.enableDamping = damping;
    dirty = true;
  };
  let dirty = true, active = true, disposed = false, raf = 0, lastFrame = 0, interacting = false;
  let width = 1, height = 1, sessions = [], overflow = 0;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const actors = new Map(), geometries = new Map(), materials = new Map();
  let xiaoque = null, modelScale = 1, nativeHip = new THREE.Vector3(), standingHip = .86;
  const modelClips = new Map();
  const screenTextures = [], workstationMeshes = [], deskActors = Array(6).fill(null);
  let hovered = null, selectedKey = '', tap = null;
  const pointer = { x: 0, y: 0, inside: false, type: 'mouse' };
  const keyOf = a => `${a.session.agent}:${a.session.id}`;
  const mat = (color, roughness = .78) => {
    const key = `${color}:${roughness}`;
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness }));
    return materials.get(key);
  };
  const white = mat(dark ? '#424953' : '#fcfcfc');
  const legs = mat(dark ? '#303640' : '#dce0e3');
  const wall = mat(dark ? '#343b46' : '#f7f9fa');
  const charcoal = mat(dark ? '#141b25' : '#3d4653');
  const silver = mat(dark ? '#73808e' : '#b8c1c9', .38);
  const leaf = mat('#7aa88c');
  function mesh(geo, material, x, y, z, parent = scene) {
    const m = new THREE.Mesh(geo, material);
    m.position.copy(xyz(x, y, z));
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function box(w, d, h, x, y, z, material = white, radius = .025, parent = scene) {
    const r = Math.min(radius, w / 3, d / 3, h / 3);
    const key = `box:${w},${d},${h},${r}`;
    if (!geometries.has(key)) geometries.set(key, new RoundedBoxGeometry(w, h, d, 2, r));
    return mesh(geometries.get(key), material, x, y, z, parent);
  }
  function cyl(r, h, x, y, z, material = white, parent = scene) {
    const key = `cyl:${r},${h}`;
    if (!geometries.has(key)) geometries.set(key, new THREE.CylinderGeometry(r, r, h, 24));
    return mesh(geometries.get(key), material, x, y, z, parent);
  }
  function ball(r, x, y, z, material, parent = scene, scale = [1, 1, 1]) {
    const key = `ball:${r}`;
    if (!geometries.has(key)) geometries.set(key, new THREE.SphereGeometry(r, 20, 12));
    const m = mesh(geometries.get(key), material, x, y, z, parent);
    m.scale.set(...scale); return m;
  }
  const hemi = new THREE.HemisphereLight(dark ? '#bdd5ff' : '#ffffff', dark ? '#313744' : '#bbc3ca', dark ? 2.5 : 2.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(dark ? '#d7e5ff' : '#fff6e8', dark ? 2.1 : 2.6);
  sun.position.set(-3, 12, 7); sun.target.position.copy(xyz(0, 2, 0));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: .1, far: 35 });
  sun.shadow.normalBias = .035; sun.shadow.bias = -.00015;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#d3e4ff', dark ? .8 : 1.2);
  fill.position.set(7, 5, -4); scene.add(fill);

  // A soft reusable contact patch supplements the directional shadow at each chair.
  const patch = document.createElement('canvas'); patch.width = patch.height = 64;
  const pc = patch.getContext('2d'), gradient = pc.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(16,25,38,.38)'); gradient.addColorStop(1, 'rgba(16,25,38,0)');
  pc.fillStyle = gradient; pc.fillRect(0, 0, 64, 64);
  const contactTexture = new THREE.CanvasTexture(patch);
  const contactMaterial = new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false });
  const contactGeo = new THREE.PlaneGeometry(1.4, 1.1);
  function contact(x, y) {
    const m = new THREE.Mesh(contactGeo, contactMaterial);
    m.rotation.x = -Math.PI / 2; m.position.copy(xyz(x, y, .036)); scene.add(m);
  }
  box(9.7, 9.35, .14, .05, 2.35, -.08, mat(dark ? '#252c35' : '#d5dde4'), .06);
  box(3.4, 2.7, .025, -2.6, 5.25, .01, mat(dark ? '#303944' : '#e2e9e6'));
  box(3.4, 3, .025, -2.6, -.3, .01, mat(dark ? '#2e3945' : '#c9d6df'));
  box(.08, 8.48, 1, -4.34, 2.4, .5, wall);
  box(3.48, .08, 1, -2.6, 6.6, .5, wall);
  box(3.48, .08, .55, -2.6, 1.2, .275, wall);
  box(.08, 1.5, .55, -.86, .45, .275, wall);
  // Low perimeter edging separates the matte room floor from the page.
  const trim = mat(dark ? '#4b5868' : '#b9c6d0');
  box(9.65, .045, .035, .05, -2.27, .025, trim, .009);
  box(.045, 9.25, .035, 4.84, 2.35, .025, trim, .009);
  box(9.65, .045, .035, .05, 6.98, .025, trim, .009);
  // Compact lounge furniture leaves the aisle in front of the desks clear.
  box(1.28, .57, .17, 1.0, 6.65, .34, white, .06);
  box(1.28, .1, .51, 1.0, 6.94, .62, white, .04);
  for (const x of [.34, 1.66]) box(.1, .57, .28, x, 6.65, .48, white, .03);
  for (const x of [.49, 1.51]) cyl(.035, .22, x, 6.65, .14, silver);
  // The window sits behind the cot so its frame cannot hide the sleeper.
  box(1.65, .07, 1.1, 3.77, 6.94, .94, wall);
  box(1.47, .015, .85, 3.77, 6.895, .98, mat(dark ? '#57718d' : '#b4cddd'));
  box(.035, .025, .89, 3.77, 6.88, .98, white);
  box(1.73, .12, .05, 3.77, 6.88, .53, white);
  // Tea room: L counter, cupboard seams, cups and espresso machine.
  box(3, .56, .84, -2.75, 6.26, .44);
  box(3.06, .62, .055, -2.75, 6.26, .885);
  box(.56, 1.2, .84, -3.97, 5.42, .44);
  box(.62, 1.26, .055, -3.97, 5.42, .885);
  for (const x of [-3.85, -3.15, -2.45, -1.75]) {
    box(.012, .012, .7, x, 5.971, .45, legs);
    box(.17, .025, .025, x + .22, 5.955, .7, silver);
  }
  for (let i = 0; i < 6; i++) {
    const x = -3.62 + i % 3 * .2, y = 6.22 + Math.floor(i / 3) * .19;
    cyl(.052, .11, x, y, .965, mat(i < 3 ? '#cda784' : '#d9dfe3'));
    cyl(.055, .015, x, y, 1.026);
  }
  box(.46, .4, .44, -1.75, 6.3, 1.13, silver, .04);
  box(.3, .025, .16, -1.75, 6.085, 1.2, charcoal);
  box(.26, .15, .025, -1.75, 6.06, .93, charcoal);
  cyl(.02, .08, -1.75, 6.07, 1.06, silver);
  cyl(.05, .08, -1.75, 6.06, .99, mat(COLORS.claude));
  // Treadmill, oriented to the left, as in render.py.
  box(1.8, .66, .12, -2.55, 2.6, .08, legs, .04);
  box(1.56, .5, .014, -2.5, 2.6, .149, charcoal);
  for (const y of [2.3, 2.9]) {
    box(.06, .05, 1.08, -3.28, y, .64, silver);
    box(.64, .035, .035, -2.99, y, 1.06, silver);
  }
  box(.24, .72, .27, -3.38, 2.6, 1.2, charcoal, .04);
  box(.018, .43, .13, -3.247, 2.6, 1.24, mat('#8fa3c9'));
  // WC: cistern, oval bowl with dark opening, seat ring, paper roll and basin.
  box(.46, .2, .4, -2.9, 1.03, .62, white, .05);
  const bowl = cyl(.21, .4, -2.9, .71, .2); bowl.scale.z = 1.3;
  const seat = cyl(.23, .045, -2.9, .69, .42); seat.scale.z = 1.32;
  const hole = cyl(.155, .008, -2.9, .67, .448, mat(dark ? '#6b7886' : '#9baab4')); hole.scale.z = 1.3;
  box(.16, .06, .025, -2.3, 1.13, .78, silver);
  const roll = cyl(.067, .14, -2.3, 1.09, .72); roll.rotation.z = Math.PI / 2;
  box(.1, .012, .16, -2.3, 1.02, .62);
  box(.6, .44, .7, -1.45, .92, .35);
  box(.46, .32, .065, -1.45, .91, .73);
  box(.29, .19, .008, -1.45, .9, .768, legs);
  cyl(.018, .14, -1.45, 1.05, .81, silver);
  box(.13, .025, .025, -1.4, 1.05, .88, silver);
  function plant(x, y, small = false) {
    const k = small ? .7 : 1;
    cyl(.18 * k, .3 * k, x, y, .16 * k, mat(dark ? '#686357' : '#dadbd2'));
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4;
      ball(.12 * k, x + Math.cos(a) * .13 * k, y + Math.sin(a) * .13 * k, (.48 + i % 3 * .11) * k, leaf, scene, [1, 1.7, .7]);
    }
  }
  plant(-1.3, 3.5); plant(-3.95, -1.45, true);

  // Folding cot: long axis X, entirely behind the last row of workstations.
  const canvas = mat(dark ? '#687d79' : '#95aaa0');
  const blanketMaterial = mat(dark ? '#658c83' : '#7da99b');
  function tubeBetween(from, to, radius, material, parent = scene) {
    const start = xyz(...from), end = xyz(...to), delta = end.clone().sub(start);
    const tube = cyl(radius, delta.length(), 0, 0, 0, material, parent);
    tube.position.copy(start).add(end).multiplyScalar(.5);
    tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return tube;
  }
  const cot = new THREE.Group(); cot.name = 'cot'; cot.position.copy(xyz(3.35, 6.1, 0)); scene.add(cot);
  for (const y of [-.43, .43]) {
    tubeBetween([-1.11, y, .43], [1.11, y, .43], .025, silver, cot);
    for (const x of [-.73, .73]) {
      tubeBetween([x - .20, y, .04], [x + .20, y, .43], .022, silver, cot);
      tubeBetween([x + .20, y, .04], [x - .20, y, .43], .022, silver, cot);
      ball(.037, x, y, .235, charcoal, cot);
    }
  }
  for (const x of [-1.08, 1.08]) tubeBetween([x, -.43, .43], [x, .43, .43], .025, silver, cot);
  box(2.14, .82, .055, 0, 0, .445, canvas, .018, cot);
  box(.44, .64, .1, .65, 0, .52, mat('#e5e7dd'), .045, cot);
  box(1.40, .79, .06, -.22, 0, .78, blanketMaterial, .025, cot);
  // Thin cover with loose sides; the body and feet fit beneath the raised canvas.
  for (const y of [-.405, .405]) box(1.40, .035, .29, -.22, y, .65, blanketMaterial, .012, cot);
  box(.025, .80, .065, .49, 0, .78, mat('#c9d8ce'), .008, cot);

  function screen(x, y) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 144;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    box(.62, .004, .36, x, y, 1.12, material, .001);
    const info = { canvas, texture, material, state: 'idle', frame: -1 };
    screenTextures.push(info); return info;
  }
  const screens = DESKS.map(([x, y], deskIndex) => {
    const firstPart = scene.children.length;
    box(1.5, .74, .065, x, y, .75, white, .025);
    for (const dx of [-.7, .7]) for (const dy of [-.32, .32]) box(.045, .045, .72, x + dx, y + dy, .36, legs, .01);
    box(.42, .56, .6, x + .42, y + .02, .3, white, .03);
    for (const z of [.47, .3, .13]) {
      box(.36, .01, .008, x + .42, y - .265, z - .075, legs);
      box(.12, .02, .018, x + .42, y - .275, z, silver);
    }
    box(.26, .18, .02, x - .15, y + .22, .79, legs);
    box(.05, .04, .22, x - .15, y + .25, .88, silver);
    box(.68, .045, .42, x - .15, y + .2, 1.12, charcoal, .015);
    const scr = screen(x - .15, y + .174);
    box(.4, .14, .02, x - .15, y - .16, .797, legs, .007);
    for (let k = 0; k < 3; k++) box(.34, .009, .002, x - .15, y - .2 + k * .04, .809, silver);
    ball(.035, x + .17, y - .17, .8, legs, scene, [1, .4, 1.35]);
    box(.16, .3, .34, x + .59, y + .07, .95, legs, .018);
    box(.08, .004, .015, x + .59, y - .083, 1.05, charcoal);
    const cy = y - .50, cx = x - .15;
    box(.5, .46, .07, cx, cy, .45, white, .035);
    const back = box(.48, .065, .46, cx, cy - .24, .77, white, .03); back.rotation.x = .14;
    cyl(.028, .32, cx, cy, .25, silver);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + .3;
      const spoke = box(.3, .04, .035, cx + Math.cos(a) * .15, cy + Math.sin(a) * .15, .07, silver, .01);
      spoke.rotation.y = a;
      ball(.033, cx + Math.cos(a) * .29, cy + Math.sin(a) * .29, .04, charcoal);
    }
    for (const dx of [-.29, .29]) box(.04, .27, .035, cx + dx, cy, .68, legs);
    for (const part of scene.children.slice(firstPart)) if (part.isMesh) {
      part.userData.deskIndex = deskIndex; workstationMeshes.push(part);
    }
    contact(cx, cy); return scr;
  });
  function drawScreen(scr, frame) {
    if (scr.frame === frame) return;
    scr.frame = frame;
    const c = scr.canvas.getContext('2d'), state = scr.state;
    c.fillStyle = state === 'idle' ? '#05080d' : state === 'stalled' ? '#1b2634' : state === 'waiting' ? (frame % 2 ? '#ffbf47' : '#ec9419') : STATES[state] || STATES.idle;
    c.fillRect(0, 0, 256, 144);
    c.fillStyle = 'rgba(255,255,255,.9)';
    if (state === 'working') {
      for (let i = 0; i < 5; i++) c.fillRect(24, 22 + i * 23, 60 + (i * 37 + frame * 13) % 145, 6);
      c.fillRect(24 + frame % 5 * 18, 125, 8, 8);
    } else if (state !== 'idle') {
      c.font = 'bold 66px system-ui'; c.textAlign = 'center';
      c.fillText(({ waiting: '!', done: '✓', aborted: '×', stalled: 'zzz' })[state] || '·', 128, 97);
      c.textAlign = 'start';
    }
    scr.texture.needsUpdate = true;
  }
  // All actors share low-poly geometry and matte materials. Local forward is -Z.
  // Head/body proportions are unchanged at 1.25x; seating and IK targets use the enlarged dimensions.
  function actorGeometry(key, make) {
    if (!geometries.has(key)) geometries.set(key, make());
    return geometries.get(key);
  }
  const bodyMaterial = mat(dark ? '#cdd4dc' : '#e8ecef', .95);
  const jointMaterial = mat(dark ? '#85949f' : '#a3afb8', .9);
  const limbGeo = actorGeometry('actor-limb', () => new THREE.CylinderGeometry(.038, .035, 1, 8));
  const jointGeo = actorGeometry('actor-joint', () => new THREE.SphereGeometry(.043, 8, 6));
  const headGeo = actorGeometry('actor-head', () => new THREE.SphereGeometry(.17, 12, 8));
  const torsoGeo = actorGeometry('actor-torso', () => new THREE.CapsuleGeometry(.105, .19, 3, 10));
  const eyeGeo = actorGeometry('actor-eye', () => new THREE.SphereGeometry(.019, 6, 4));
  const antennaGeo = actorGeometry('actor-antenna', () => new THREE.CylinderGeometry(.009, .009, .09, 6));
  const tipGeo = actorGeometry('actor-tip', () => new THREE.SphereGeometry(.035, 8, 6));
  const shoeGeo = actorGeometry('actor-shoe', () => new THREE.SphereGeometry(1, 8, 6));
  const scarfGeo = actorGeometry('actor-scarf', () => new THREE.CylinderGeometry(.115, .115, .065, 10));
  const sashGeo = actorGeometry('actor-sash', () => new THREE.BoxGeometry(.065, .18, .025));
  const bodyPart = (geo, material, parent) => mesh(geo, material, 0, 0, 0, parent);
  const symbols = new Map();
  function symbolTexture(value) {
    if (!symbols.has(value)) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.font = value === '!' ? 'bold 58px system-ui' : 'bold 36px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 7; ctx.strokeStyle = dark ? '#26313c' : '#f6f8fa';
      ctx.strokeText(value, 64, 32);
      ctx.fillStyle = value === '!' ? '#ed9c23' : dark ? '#b6cfdf' : '#587389'; ctx.fillText(value, 64, 32);
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, toneMapped: false });
      symbols.set(value, material);
    }
    return symbols.get(value);
  }
  function makeLimb(parent, x, y, lengthA, lengthB, foot = false) {
    const upper = new THREE.Group(); upper.position.set(x, y, 0); parent.add(upper);
    bodyPart(jointGeo, jointMaterial, upper);
    const segment = bodyPart(limbGeo, bodyMaterial, upper); segment.scale.y = lengthA; segment.position.y = -lengthA / 2;
    const lower = new THREE.Group(); lower.position.y = -lengthA; upper.add(lower);
    bodyPart(jointGeo, jointMaterial, lower);
    const end = bodyPart(limbGeo, bodyMaterial, lower); end.scale.y = lengthB; end.position.y = -lengthB / 2;
    const hand = bodyPart(foot ? shoeGeo : jointGeo, bodyMaterial, lower);
    hand.position.set(0, -lengthB, foot ? -.035 : 0);
    if (foot) hand.scale.set(.055, .037, .10);
    else hand.scale.set(1.3, 1.5, .8);
    return { upper, lower, hand, lengthA, lengthB };
  }
  function makeFallbackActor(s) {
    const group = new THREE.Group(); scene.add(group);
    const body = new THREE.Group(); body.scale.setScalar(ACTOR_SCALE); group.add(body);
    const torso = new THREE.Group(); body.add(torso);
    const trunk = bodyPart(torsoGeo, bodyMaterial, torso); trunk.position.y = .205;
    const headPivot = new THREE.Group(); headPivot.position.y = .54; torso.add(headPivot);
    bodyPart(headGeo, bodyMaterial, headPivot).scale.set(1, 1, .88);
    for (const x of [-.055, .055]) { const eye = bodyPart(eyeGeo, charcoal, headPivot); eye.position.set(x, .01, -.143); }
    const antenna = bodyPart(antennaGeo, silver, headPivot); antenna.position.y = .205;
    const tip = bodyPart(tipGeo, mat(COLORS[who(s)]), headPivot); tip.position.y = .26;
    const scarf = bodyPart(scarfGeo, mat(COLORS[who(s)]), torso); scarf.position.y = .34;
    const sash = bodyPart(sashGeo, mat(COLORS[who(s)]), torso); sash.position.set(.05, .22, -.105); sash.rotation.z = -.18;
    for (const x of [-.16, .16]) {
      const shoulder = bodyPart(limbGeo, jointMaterial, torso);
      shoulder.position.set(x, .355, 0); shoulder.scale.y = .11; shoulder.rotation.z = Math.PI / 2;
    }
    const arms = [-.215, .215].map(x => makeLimb(torso, x, .355, .25, .25));
    const thighs = [-.085, .085].map(x => makeLimb(body, x, 0, .28, .34, true));
    const cup = new THREE.Group(); arms[0].lower.add(cup); cup.position.set(0, -.25, -.035);
    const cupGeo = actorGeometry('actor-cup', () => new THREE.CylinderGeometry(.045, .036, .085, 10));
    bodyPart(cupGeo, mat('#d6b99c'), cup);
    const coffeeGeo = actorGeometry('actor-coffee', () => new THREE.CircleGeometry(.038, 10));
    const coffee = bodyPart(coffeeGeo, mat('#6b4835'), cup); coffee.rotation.x = -Math.PI / 2; coffee.position.y = .044;
    const head = new THREE.Object3D(); head.name = 'label-anchor';
    const status = new THREE.Sprite(symbolTexture('zzz')); status.scale.set(.43, .215, 1); group.add(status, head);
    const tag = document.createElement('button'); tag.type = 'button'; tag.className = 'scene-tag';
    const badge = document.createElement('span'); badge.className = 'state-bubble';
    const title = document.createElement('b'), extra = document.createElement('span'); extra.className = 'scene-overflow';
    const familyDot = document.createElement('span'); familyDot.className = 'scene-family-dot'; familyDot.setAttribute('aria-hidden', 'true');
    tag.append(familyDot, title, extra); labels.append(tag);
    const stem = document.createElement('span'); stem.className = 'scene-label-stem'; stem.hidden = true; labels.append(stem);
    badge.classList.add('scene-hand-bubble'); labels.append(badge);
    const surfaces = [], joints = [];
    body.traverse(o => { if (o.material === bodyMaterial) surfaces.push(o); else if (o.material === jointMaterial) joints.push(o); });
    const a = { group, body, surfaces, joints, torso, headPivot, head, arms, thighs, cup, status, accents: [tip, scarf, sash],
      tag, title, extra, badge, stem, session: s, family: '', zone: '', index: 0,
      pose: null, poseFrom: null, poseKey: '', transitionStart: 0 };
    tag.addEventListener('mouseenter', () => { hovered = a; onSelect(a.session, tag, false); });
    tag.addEventListener('mouseleave', event => {
      if (!event.relatedTarget?.closest?.('.session-info')) { hovered = null; onHoverEnd(); }
    });
    tag.addEventListener('focus', () => onSelect(a.session, tag, false));
    tag.addEventListener('click', () => onSelect(a.session, tag, true));
    return a;
  }
  const boneKey = name => name.replace(/^mixamorig[:_]?/i, '');
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0), axisY = new THREE.Vector3(0, 1, 0);
  function snapshotRig(a) {
    return a.boneList.map(b => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
  }
  function restoreRig(a, pose) {
    a.boneList.forEach((b, i) => { b.position.copy(pose[i].p); b.quaternion.copy(pose[i].q); b.scale.copy(pose[i].s); });
  }
  function familyRing(a, family) {
    if (!a.ring) {
      const geo = actorGeometry('family-ring', () => new THREE.RingGeometry(.30, .355, 40));
      const halo = actorGeometry('family-halo', () => new THREE.RingGeometry(.355, .43, 40));
      a.ring = new THREE.Group(); a.ring.name = 'agent-family-ring'; a.group.add(a.ring);
      for (const geometry of [geo, halo]) {
        const m = new THREE.Mesh(geometry); m.rotation.x = -Math.PI / 2; a.ring.add(m);
      }
    }
    a.ring.children.forEach((m, i) => {
      const key = `ring:${family}:${i}`;
      if (!materials.has(key)) materials.set(key, new THREE.MeshBasicMaterial({ color: COLORS[family], transparent: true, opacity: i ? .15 : .9, depthWrite: false, toneMapped: false }));
      m.material = materials.get(key);
    });
  }
  function makeActor(s) {
    const a = makeFallbackActor(s);
    if (!xiaoque) return a;
    a.group.remove(a.body);
    a.body = new THREE.Group(); a.body.name = 'xiaoque-body'; a.group.add(a.body);
    const frame = new THREE.Group(); frame.rotation.y = Math.PI / 2; frame.scale.setScalar(modelScale); a.body.add(frame);
    a.rig = cloneSkeleton(xiaoque); a.rig.name = 'xiaoque-instance';
    a.rig.position.sub(nativeHip); frame.add(a.rig);
    a.bones = {}; a.boneList = [];
    a.rig.traverse(o => {
      if (o.isBone) { a.bones[boneKey(o.name)] = o; a.boneList.push(o); }
      if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; }
    });
    a.rest = snapshotRig(a); a.mixer = new THREE.AnimationMixer(a.rig);
    a.actions = new Map(); a.animationKey = ''; a.currentAction = null; a.poseFromRig = null;
    a.surfaces = a.joints = a.accents = [];
    a.group.name = 'xiaoque-actor';
    a.group.userData.sessionKey = `${s.agent}:${s.id}`;
    return a;
  }
  function disposeActor(a) {
    if (a.mixer) { a.mixer.stopAllAction(); a.mixer.uncacheRoot(a.rig); a.rig.traverse(o => { if (o.isSkinnedMesh) o.skeleton.dispose(); }); }
    scene.remove(a.group); a.tag.remove(); a.stem.remove(); a.badge.remove();
  }
  function aimBone(bone, child, target) {
    bone.getWorldPosition(v0); child.getWorldPosition(v1);
    v1.sub(v0).normalize(); v2.copy(target).sub(v0).normalize();
    qa.setFromUnitVectors(v1, v2);
    bone.getWorldQuaternion(qb); qb.premultiply(qa);
    bone.parent.getWorldQuaternion(qc).invert(); bone.quaternion.copy(qc.multiply(qb));
    bone.updateWorldMatrix(false, true);
  }
  const ikStart = new THREE.Vector3(), ikEnd = new THREE.Vector3(), ikDir = new THREE.Vector3(), ikBend = new THREE.Vector3(), ikElbow = new THREE.Vector3();
  function solveBoneChain(a, upper, lower, end, localTarget, preference) {
    upper.getWorldPosition(ikStart); lower.getWorldPosition(v0); end.getWorldPosition(v1);
    const l1 = ikStart.distanceTo(v0), l2 = v0.distanceTo(v1);
    ikEnd.copy(localTarget); a.group.localToWorld(ikEnd);
    ikDir.copy(ikEnd).sub(ikStart); const d = THREE.MathUtils.clamp(ikDir.length(), Math.abs(l1 - l2) + .001, l1 + l2 - .001); ikDir.normalize();
    ikEnd.copy(ikStart).addScaledVector(ikDir, d);
    ikBend.copy(preference).applyAxisAngle(axisY, a.group.rotation.y);
    ikBend.addScaledVector(ikDir, -ikBend.dot(ikDir)).normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    ikElbow.copy(ikStart).addScaledVector(ikDir, along).addScaledVector(ikBend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
    aimBone(upper, lower, ikElbow); aimBone(lower, end, ikEnd);
  }
  const poseTarget = new THREE.Vector3(), posePreference = new THREE.Vector3();
  function leanBone(a, bone, angle) {
    bone.parent.getWorldQuaternion(qa).invert();
    v0.copy(axisX).applyQuaternion(a.group.quaternion).applyQuaternion(qa); qb.setFromAxisAngle(v0, angle); bone.quaternion.premultiply(qb);
    bone.updateWorldMatrix(false, true);
  }
  function programRig(a, t) {
    restoreRig(a, a.rest); a.group.updateWorldMatrix(true, true);
    const seated = a.zone === 'desk' || a.zone === 'wc' || a.zone === 'sofa';
    if (seated) {
      for (const side of ['Left', 'Right']) {
        const sign = side === 'Left' ? -1 : 1;
        // Feet are placed ahead of the seat; the knee bends naturally below the desk.
        poseTarget.set(sign * .11, .17 - a.group.position.y, -.38);
        solveBoneChain(a, a.bones[side + 'UpLeg'], a.bones[side + 'Leg'], a.bones[side + 'Foot'], poseTarget, posePreference.set(0, 0, -1));
      }
    }
    if (a.zone === 'desk') {
      leanBone(a, a.bones.Spine, ['stalled', 'offline'].includes(a.session.state) ? -.55 : -.12);
      if (['stalled', 'offline'].includes(a.session.state)) leanBone(a, a.bones.Neck, -.35);
    } else if (a.zone === 'tea') leanBone(a, a.bones.Spine, Math.sin(t * 1.7) * .018);
    else if (a.zone === 'cot') leanBone(a, a.bones.Spine, -.12);
    for (const side of ['Left', 'Right']) {
      const sign = side === 'Left' ? -1 : 1;
      if (a.zone === 'desk') {
        poseTarget.set(sign * .14, .865 - a.group.position.y + Math.sin(t * 11 + sign) * .008, -.34);
        posePreference.set(sign, .25, .15);
      } else if (a.zone === 'tea' && side === 'Left') {
        poseTarget.set(sign * .19, -.04, -.18); posePreference.set(sign, 0, 0);
      } else {
        poseTarget.set(sign * .20, -.12, -.04); posePreference.set(sign, 0, 0);
      }
      // Lying-down bones remain in their bind pose; it keeps the wings under the blanket.
      if (a.zone !== 'cot') solveBoneChain(a, a.bones[side + 'Arm'], a.bones[side + 'ForeArm'], a.bones[side + 'Hand'], poseTarget, posePreference);
    }
  }
  function posedClip(a) {
    const tracks = [];
    a.boneList.forEach(b => {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, .3], [...b.quaternion.toArray(), ...b.quaternion.toArray()]));
      tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, [0, .3], [...b.position.toArray(), ...b.position.toArray()]));
    });
    return new THREE.AnimationClip('procedural-bridge', .3, tracks);
  }
  function poseXiaoque(a, time, dt) {
    const t = motion.matches ? 0 : time / 1000 + a.index;
    const key = `${a.zone}:${a.session.state}`;
    const clipName = a.zone === 'run' ? 'run' : a.zone === 'desk' ? ({ waiting: 'greet', done: 'cheer', aborted: 'frustrated' }[a.session.state] || '') : '';
    if (key !== a.poseKey) {
      a.poseFromRig = snapshotRig(a); a.transitionStart = time;
      a.rotationFrom = a.body.rotation.x; a.poseKey = key; a.pose = [];
      if (clipName) {
        let action = a.actions.get(clipName);
        if (!action) { action = a.mixer.clipAction(modelClips.get(clipName)); a.actions.set(clipName, action); }
        const previous = a.currentAction;
        action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
        if (previous && previous !== action) previous.crossFadeTo(action, .3, false);
        else if (!previous) {
          if (a.bridgeClip) a.mixer.uncacheClip(a.bridgeClip);
          a.bridgeClip = posedClip(a); const bridge = a.mixer.clipAction(a.bridgeClip).play(); bridge.crossFadeTo(action, .3, false);
        }
        a.currentAction = action;
      } else { a.mixer.stopAllAction(); a.currentAction = null; }
      a.animationKey = clipName;
      a.group.userData.animation = clipName || 'procedural';
    }
    const progress = motion.matches ? 1 : THREE.MathUtils.clamp((time - a.transitionStart) / 300, 0, 1);
    const smooth = progress * progress * (3 - 2 * progress);
    a.body.rotation.x = THREE.MathUtils.lerp(a.rotationFrom || 0, a.zone === 'cot' ? Math.PI / 2 : 0, smooth);
    const blend = motion.matches ? 1 : 1 - Math.exp(-Math.min(dt, 60) / 65);
    if (motion.matches) { a.group.position.copy(a.basePosition); a.group.rotation.y = a.facing; }
    else {
      a.group.position.lerp(a.basePosition, blend);
      a.group.rotation.y += Math.atan2(Math.sin(a.facing - a.group.rotation.y), Math.cos(a.facing - a.group.rotation.y)) * blend;
    }
    if (clipName) {
      if (motion.matches) {
        a.currentAction.paused = true; a.currentAction.time = Math.min(a.currentAction.getClip().duration * .4, 1.2);
        a.currentAction.stopFading(); a.currentAction.setEffectiveWeight(1);
        a.mixer.update(0);
      } else { a.currentAction.paused = false; a.mixer.update(Math.min(dt / 1000, .08)); }
    } else {
      programRig(a, t);
      if (smooth < 1) a.boneList.forEach((b, i) => {
        b.position.lerpVectors(a.poseFromRig[i].p, b.position.clone(), smooth);
        b.quaternion.slerpQuaternions(a.poseFromRig[i].q, b.quaternion.clone(), smooth);
      });
    }
    a.group.updateWorldMatrix(true, true);
    a.bones.Head.getWorldPosition(headWorld); a.group.worldToLocal(headWorld);
    a.head.position.copy(headWorld); a.head.position.y += .38;
    a.status.visible = a.zone === 'cot' || ['stalled', 'offline'].includes(a.session.state);
    a.status.position.copy(a.head.position); a.status.position.y += .1 + (motion.matches ? 0 : Math.sin(t * 1.6) * .04);
    a.ring.position.y = (a.zone === 'run' ? .16 : .037) - a.group.position.y;
  }
  // Pose fields: body X, torso X, head X, left/right wrist Y/Z,
  // left/right thigh X, left/right knee X. Angles interpolate over 300 ms.
  const sit = () => [0, 0, 0, -.07, -.16, -.07, -.16, 1.38, 1.38, -.76, -.76];
  const type = t => [0, -.045, -.08, .256 + Math.sin(t * 12) * .007, -.368, .256 + Math.cos(t * 12) * .007, -.368, 1.38, 1.38, -1.03, -1.03];
  const raiseHand = () => { const p = type(0); p[1] = p[2] = 0; p[5] = .8549; p[6] = 0; return p; };
  const slump = () => [0, -.80, -.30, .256, -.368, .256, -.368, 1.38, 1.38, -1.03, -1.03];
  const stretch = t => [0, .20, .10, .76, -.12, .76, -.12, 1.34 + Math.sin(t) * .015, 1.34, -1.03, -1.03];
  const headInHands = () => [0, -.25, -.40, .49, -.24, .49, -.24, 1.38, 1.38, -1.03, -1.03];
  const stand = () => [0, 0, 0, .24, -.25, -.10, -.02, 0, 0, .04, .04];
  const run = t => [0, -.13, 0, .18, -.24 - Math.sin(t * 8) * .12, .18, -.24 + Math.sin(t * 8) * .12,
    Math.sin(t * 8) * .7, -Math.sin(t * 8) * .7, -.35 - Math.max(0, -Math.sin(t * 8)) * .8, -.35 - Math.max(0, Math.sin(t * 8)) * .8];
  const lieDown = () => [Math.PI / 2, 0, .03, -.10, -.025, -.10, -.025, 0, 0, 0, 0];
  const poseFor = (a, t) => a.zone === 'cot' ? lieDown() : a.zone === 'run' ? run(t) : a.zone === 'tea' ? stand()
    : a.zone !== 'desk' ? sit() : ({ working: type, waiting: raiseHand, stalled: slump, done: stretch, aborted: headInHands }[a.session.state] || sit)(t);
  const wrist = new THREE.Vector3();
  const torsoInverse = new THREE.Quaternion(), lowerRotation = new THREE.Quaternion();
  const direction = new THREE.Vector3(), bendDirection = new THREE.Vector3(), elbow = new THREE.Vector3(), lowerDirection = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  function poseActor(a, time, dt) {
    if (a.rig) { poseXiaoque(a, time, dt); return; }
    const t = motion.matches ? 0 : time / 1000 + a.index;
    const next = poseFor(a, t), poseKey = `${a.zone}:${a.session.state}`;
    if (poseKey !== a.poseKey) {
      a.poseFrom = a.pose?.slice() || next.slice(); a.transitionStart = time; a.poseKey = poseKey;
    }
    const progress = motion.matches ? 1 : THREE.MathUtils.clamp((time - a.transitionStart) / 300, 0, 1);
    const smooth = progress * progress * (3 - 2 * progress);
    a.pose = next.map((value, i) => THREE.MathUtils.lerp(a.poseFrom[i], value, smooth));
    const p = a.pose;
    a.body.rotation.x = p[0]; a.torso.rotation.x = p[1]; a.headPivot.rotation.x = p[2];
    a.headPivot.position.z = -.12 * Math.min(1, Math.abs(p[0]) / (Math.PI / 2));
    torsoInverse.copy(a.torso.quaternion).invert();
    for (let i = 0; i < 2; i++) {
      const arm = a.arms[i];
      // Wrist targets stay in pelvis coordinates as the upper body leans.
      const raised = i === 1 && a.session.state === 'waiting' && a.zone === 'desk';
      const rest = a.zone === 'tea' || a.zone === 'cot';
      const x = raised || rest ? arm.upper.position.x : (i ? .12 : -.12);
      wrist.set(x, p[3 + i * 2], p[4 + i * 2]).applyQuaternion(torsoInverse);
      direction.copy(wrist).sub(arm.upper.position);
      const distance = THREE.MathUtils.clamp(direction.length(), .015, .49999); direction.normalize();
      // An outward elbow bend keeps enlarged forearms above the desk edge.
      bendDirection.set(i ? 1 : -1, -.15, 0).addScaledVector(direction, -bendDirection.dot(direction)).normalize();
      elbow.copy(arm.upper.position).addScaledVector(direction, distance / 2)
        .addScaledVector(bendDirection, Math.sqrt(.25 ** 2 - (distance / 2) ** 2));
      lowerDirection.copy(elbow).sub(arm.upper.position).normalize();
      arm.upper.quaternion.setFromUnitVectors(down, lowerDirection);
      lowerDirection.copy(wrist).sub(elbow).normalize();
      lowerRotation.setFromUnitVectors(down, lowerDirection);
      arm.lower.quaternion.copy(arm.upper.quaternion).invert().multiply(lowerRotation);
      a.thighs[i].upper.rotation.x = p[7 + i]; a.thighs[i].lower.rotation.x = p[9 + i];
    }
    a.cup.visible = a.zone === 'tea';
    const desired = a.basePosition;
    const blend = motion.matches ? 1 : 1 - Math.exp(-dt / 65);
    if (motion.matches) { a.group.position.copy(desired); a.group.rotation.y = a.facing; }
    else {
      a.group.position.lerp(desired, blend);
      a.group.rotation.y += Math.atan2(Math.sin(a.facing - a.group.rotation.y), Math.cos(a.facing - a.group.rotation.y)) * blend;
    }
    const showZ = a.zone === 'cot' || ['stalled', 'offline'].includes(a.session.state);
    a.status.visible = showZ;
    // Label and sleep marker rise vertically above the head, including when lying down.
    a.headPivot.getWorldPosition(headWorld); a.group.worldToLocal(headWorld);
    a.head.position.copy(headWorld); a.head.position.y += .33;
    a.status.position.copy(a.head.position); a.status.position.y += .10 + (!motion.matches && showZ ? Math.sin(t * 1.6) * .045 : 0);
    a.ring.position.y = (a.zone === 'run' ? .16 : .037) - a.group.position.y;
  }
  function sync() {
    const deskSessions = sessions.filter(s => s.state !== 'idle');
    const idle = sessions.filter(s => s.state === 'idle').slice(0, 5);
    const visible = deskSessions.slice(0, 6).concat(idle);
    overflow = Math.max(0, deskSessions.length - 6);
    const keys = new Set(visible.map(s => `${s.agent}:${s.id}`));
    for (const [id, a] of actors) if (!keys.has(id)) { disposeActor(a); if (hovered === a) hovered = null; actors.delete(id); }
    deskActors.fill(null);
    screens.forEach((scr, i) => { scr.state = deskSessions[i]?.state || 'idle'; scr.frame = -1; });
    visible.forEach((s, i) => {
      const key = `${s.agent}:${s.id}`;
      let a = actors.get(key);
      if (!a) { a = makeActor(s); actors.set(key, a); }
      a.session = s; a.index = i;
      const family = who(s);
      if (a.family !== family) {
        a.surfaces.forEach(part => { part.material = mat(BODY_COLORS[family], .96); });
        a.joints.forEach(part => { part.material = mat(ACCENT_COLORS[family], .94); });
        a.accents.forEach(part => { part.material = mat(ACCENT_COLORS[family], .94); });
        familyRing(a, family); a.family = family;
      }
      const seatIndex = deskSessions.indexOf(s);
      const zoneIndex = idle.indexOf(s);
      a.deskIndex = seatIndex; if (seatIndex >= 0) deskActors[seatIndex] = a;
      const p = seatIndex >= 0 ? [DESKS[seatIndex][0] - .15, DESKS[seatIndex][1] - .50, .535] : ZONES[zoneIndex];
      a.zone = seatIndex >= 0 ? 'desk' : ['tea', 'run', 'wc', 'sofa', 'cot'][zoneIndex];
      if (a.rig) {
        if (a.zone === 'desk' && ['waiting', 'done', 'aborted'].includes(s.state)) { p[0] -= .72; p[1] -= .28; p[2] = standingHip + .035; }
        if (a.zone === 'tea') p[2] = standingHip + .035;
        if (a.zone === 'run') p[2] = standingHip + .16;
        if (a.zone === 'cot') { p[0] = 3.52; p[2] = .64; }
      }
      a.group.userData.zone = a.zone; a.group.userData.state = s.state; a.group.userData.family = family;
      a.basePosition = xyz(...p);
      a.facing = a.zone === 'cot' ? Math.PI / 2 : a.zone === 'run' ? Math.PI / 2 : a.zone === 'tea' ? -.45 : ['sofa', 'wc'].includes(a.zone) ? Math.PI : 0;
      if (!a.pose) { a.group.position.copy(a.basePosition); a.group.rotation.y = a.facing; }
      const chars = Array.from(s.title || s.agent);
      a.title.textContent = `${chars.slice(0, 12).join('')}${chars.length > 12 ? '…' : ''}`;
      a.extra.textContent = seatIndex === 5 && overflow ? `+${overflow}` : '';
      a.extra.hidden = !a.extra.textContent;
      a.tag.className = `scene-tag s-${s.state}`;
      a.tag.style.setProperty('--agent-color', COLORS[family]);
      a.badge.textContent = s.state === 'waiting' ? '!' : '';
      a.badge.hidden = !a.badge.textContent;
      a.tag.setAttribute('aria-label', `${s.title} · ${label(s)}`);
      a.tag.dataset.session = key; a.tag.dataset.state = s.state;
    });
    host.dataset.actors = String(actors.size); dirty = true;
  }
  const projected = new THREE.Vector3(), headWorld = new THREE.Vector3();
  const pickRay = new THREE.Raycaster(), pickPoint = new THREE.Vector3();
  const pickBounds = new THREE.Box3(), pickCenter = new THREE.Vector3(), pickSize = new THREE.Vector3();
  const intersects = (a, b) => a.x < b.x + b.w + 4 && a.x + a.w + 4 > b.x && a.y < b.y + b.h + 3 && a.y + a.h + 3 > b.y;
  function projectLabels() {
    const occupied = [];
    const manyIdle = sessions.filter(s => s.state === 'idle').length > 3;
    const sorted = [...actors.values()].sort((a, b) => LABEL_PRIORITY[a.session.state] - LABEL_PRIORITY[b.session.state]);
    for (const a of sorted) {
      a.tag.hidden = a.stem.hidden = a.badge.hidden = true;
      if (a.session.state === 'waiting') {
        (a.rig ? a.bones.RightHand : a.arms[1].hand).getWorldPosition(headWorld); projected.copy(headWorld).project(camera);
        const handX = (projected.x * .5 + .5) * width, handY = (-projected.y * .5 + .5) * height;
        if (projected.z > -1 && projected.z < 1 && handX > 0 && handX < width && handY > 0 && handY < height) {
          a.badge.hidden = false; a.badge.style.transform = `translate(${handX + 8}px, ${handY - 29}px)`;
        }
      }
      // Active labels always get first choice; a crowded lounge only labels its hovered/selected actor.
      if (manyIdle && a.session.state === 'idle' && a !== hovered && keyOf(a) !== selectedKey) continue;
      a.head.getWorldPosition(headWorld);
      projected.copy(headWorld).project(camera);
      const x = (projected.x * .5 + .5) * width, y = (-projected.y * .5 + .5) * height;
      const measured = Array.from(a.title.textContent + a.extra.textContent).reduce((n, c) => n + (/[^\u0000-\u007f]/.test(c) ? 11 : 6), 46);
      const w = Math.min(142, measured), h = 25, gap = 6;
      if (projected.z < -1 || projected.z > 1 || x - w / 2 < 4 || x + w / 2 > width - 4 || y > height - 8) continue;
      let placed = null;
      // Only another label can move this pill. Never shift it sideways or away from its own head.
      for (const offset of a.session.state === 'waiting' ? [24, 36, 48] : [0, 12, 24]) {
        const r = { x: x - w / 2, y: y - h - gap - offset, w, h };
        const footprint = a.session.state === 'waiting' ? { ...r, y: r.y - 17, h: h + 17, w: w + 5 } : r;
        if (footprint.y < 4 || footprint.x + footprint.w > width - 4 || occupied.some(o => intersects(footprint, o))) continue;
        placed = r; occupied.push(footprint); break;
      }
      if (!placed) continue;
      a.tag.hidden = false;
      a.tag.style.width = `${w}px`; a.tag.style.transform = `translate(${placed.x}px, ${placed.y}px)`;
      const length = y - placed.y - h;
      a.stem.hidden = false;
      a.stem.style.height = `${length}px`; a.stem.style.transform = `translate(${x}px, ${placed.y + h}px)`;
    }
  }
  function pickActor(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
    pickRay.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), camera);
    let actor = null, distance = Infinity;
    for (const a of actors.values()) {
      if (a.rig) {
        // The bind-pose mesh box does not follow animated arms. Bound the live joints instead.
        pickBounds.makeEmpty();
        for (const name of ['Hips', 'Spine2', 'Head', 'HeadTop_End', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot']) {
          a.bones[name].getWorldPosition(pickPoint); pickBounds.expandByPoint(pickPoint);
        }
        pickBounds.expandByScalar(.17);
      } else pickBounds.setFromObject(a.body);
      pickBounds.getCenter(pickCenter); pickBounds.getSize(pickSize).multiplyScalar(1.3);
      pickBounds.setFromCenterAndSize(pickCenter, pickSize);
      if (pickRay.ray.intersectBox(pickBounds, pickPoint)) {
        const d = pickRay.ray.origin.distanceTo(pickPoint);
        if (d < distance) { distance = d; actor = a; }
      }
    }
    // A desk/monitor hit selects that desk's occupant, even when the body is behind it.
    const furniture = pickRay.intersectObjects(workstationMeshes, false)[0];
    if (furniture && furniture.distance < distance) return deskActors[furniture.object.userData.deskIndex];
    return actor;
  }
  function pointAnchor(x, y) {
    return { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }) };
  }
  function updateHover() {
    if (!pointer.inside || pointer.type === 'touch' || tap || interacting) return;
    const next = pickActor(pointer.x, pointer.y);
    renderer.domElement.style.cursor = next ? 'pointer' : 'grab';
    if (next === hovered) return;
    hovered = next;
    if (next) onSelect(next.session, pointAnchor(pointer.x, pointer.y), false);
    else onHoverEnd();
  }
  function onPointerDown(event) {
    tap = event.isPrimary && event.button === 0 ? { id: event.pointerId, x: event.clientX, y: event.clientY, travel: 0 } : null;
  }
  function onPointerMove(event) {
    Object.assign(pointer, { x: event.clientX, y: event.clientY, inside: true, type: event.pointerType });
    if (tap) tap.travel = Math.max(tap.travel, Math.hypot(event.clientX - tap.x, event.clientY - tap.y));
    updateHover();
  }
  function onPointerUp(event) {
    const start = tap; tap = null;
    if (!start || start.id !== event.pointerId || start.travel >= 5 || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5) return;
    const a = pickActor(event.clientX, event.clientY);
    hovered = a;
    if (a) onSelect(a.session, pointAnchor(event.clientX, event.clientY), true);
    else onClear();
  }
  function onPointerLeave() {
    pointer.inside = false;
    if (!tap) { hovered = null; onHoverEnd(); renderer.domElement.style.cursor = 'grab'; }
  }
  function onPointerCancel() { tap = null; onPointerLeave(); }
  // The synthetic click must not reach the document's outside-click closer after pointerup opened the card.
  const onCanvasClick = event => event.stopPropagation();
  const pointerEvents = { pointerdown: onPointerDown, pointermove: onPointerMove, pointerup: onPointerUp, pointerleave: onPointerLeave, pointercancel: onPointerCancel, click: onCanvasClick };
  for (const [event, handler] of Object.entries(pointerEvents)) renderer.domElement.addEventListener(event, handler);
  // Fit the whole room in view space, then center it. This also works after orbiting.
  const roomBounds = new THREE.Box3(new THREE.Vector3(-4.8, -.15, -7.05), new THREE.Vector3(4.9, 1.8, 2.35));
  function fitRoom() {
    if (!width || !height) return;
    camera.updateMatrixWorld(true);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [roomBounds.min.x, roomBounds.max.x]) for (const y of [roomBounds.min.y, roomBounds.max.y]) for (const z of [roomBounds.min.z, roomBounds.max.z]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const aspect = width / height;
    const h = Math.max((maxY - minY) / .88, (maxX - minX) / (aspect * .9));
    const shift = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar((minX + maxX) / 2)
      .addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), (minY + maxY) / 2);
    camera.position.add(shift); controls.target.add(shift);
    camera.left = -h * aspect / 2; camera.right = h * aspect / 2; camera.top = h / 2; camera.bottom = -h / 2;
    if (initialZoom > 1) {
      const focus = query.get('focus') === 'cot' ? xyz(3.35, 6.1, .8) : xyz(2.25, 4.7, .9);
      camera.position.add(focus.clone().sub(controls.target)); controls.target.copy(focus);
    }
    camera.zoom = initialZoom; camera.updateProjectionMatrix(); controls.update(); dirty = true;
  }
  function resize() {
    if (host.hidden || !host.clientWidth || !host.clientHeight) return;
    width = host.clientWidth; height = host.clientHeight;
    fitRoom();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(width, height, false); dirty = true;
  }
  const observer = new ResizeObserver(resize); observer.observe(host);
  const onDouble = () => reset(); renderer.domElement.addEventListener('dblclick', onDouble);
  controls.addEventListener('start', () => { interacting = true; dirty = true; });
  controls.addEventListener('end', () => { interacting = false; dirty = true; });
  controls.addEventListener('change', () => { dirty = true; });
  const onMotion = () => { dirty = true; }; motion.addEventListener('change', onMotion);
  function loop(time) {
    if (disposed || !active || document.hidden) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    const cameraMoved = controls.update();
    const animate = [...actors.values()].some(a => !a.pose || a.poseKey !== `${a.zone}:${a.session.state}` || time - a.transitionStart < 320 || a.group.position.distanceToSquared(a.basePosition) > .00001)
      || !motion.matches && [...actors.values()].some(a => ['working', 'waiting', 'done', 'stalled', 'aborted'].includes(a.session.state) || ['run', 'cot', 'tea'].includes(a.zone));
    const draw = cameraMoved || interacting || ((dirty || animate) && time - lastFrame >= (animate ? 1000 / 24 : 1000 / 5));
    if (draw) {
      lastFrame = time;
      const t = time / 1000;
      const dt = time - (loop.poseTime || time - 42); loop.poseTime = time;
      for (const a of actors.values()) poseActor(a, time, dt);
      for (const scr of screens) drawScreen(scr, ['working', 'waiting'].includes(scr.state) && !motion.matches ? Math.floor(t * 4) : 0);
      try { renderer.render(scene, camera); dirty = false; }
      catch (error) { active = false; cancelAnimationFrame(raf); raf = 0; onFailure(error); return; }
    }
    // Projection follows the current camera on every RAF, including damping after a drag.
    camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
    if (cameraMoved) updateHover();
    projectLabels();
  }
  const wake = () => { if (active && !document.hidden && !raf && !disposed) raf = requestAnimationFrame(loop); };
  const onVisibility = () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else { dirty = true; wake(); }
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onLost = event => { event.preventDefault(); onFailure(new Error('WebGL context lost')); };
  renderer.domElement.addEventListener('webglcontextlost', onLost);
  reset(); resize();
  host.dataset.model = 'loading';
  let modelWarning = null;
  try {
    const loader = new GLTFLoader().register(parser => {
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager).setCrossOrigin(parser.options.crossOrigin);
      return { name: 'office-embedded-images' };
    });
    const gltf = await loader.loadAsync('./models/xiaoque.glb');
    if (disposed) return;
    xiaoque = gltf.scene; xiaoque.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(xiaoque, true), size = bounds.getSize(new THREE.Vector3());
    const bones = []; xiaoque.traverse(o => { if (o.isBone) bones.push(o); });
    const hips = bones.find(b => boneKey(b.name) === 'Hips');
    if (!hips || !bones.find(b => boneKey(b.name) === 'Head')) throw new Error('Xiaoque skeleton missing');
    modelScale = 1.55 / size.y; nativeHip.copy(hips.getWorldPosition(new THREE.Vector3()));
    standingHip = (nativeHip.y - bounds.min.y) * modelScale;
    for (const original of gltf.animations) {
      const clip = original.clone();
      for (const track of clip.tracks) if (/Hips\.position$/.test(track.name)) {
        for (let i = 0; i < track.values.length; i += 3) { track.values[i] = hips.position.x; track.values[i + 2] = hips.position.z; }
      }
      modelClips.set(clip.name, clip);
    }
    host.dataset.model = 'xiaoque';
    host.dataset.modelInfo = JSON.stringify({ bones: bones.map(b => b.name), nativeSize: size.toArray(), scale: modelScale, clips: gltf.animations.map(c => ({ name: c.name, duration: c.duration })) });
  } catch (error) {
    xiaoque = null; host.dataset.model = 'fallback';
    modelWarning = document.createElement('div'); modelWarning.className = 'scene-model-warning';
    modelWarning.textContent = '小鹊模型載入失敗，已使用備用角色'; host.append(modelWarning);
  }
  host.dataset.ready = 'true';
  wake();
  return {
    update(list) { sessions = list; sync(); },
    reset,
    setSelection(key) { selectedKey = key; },
    setActive(value) { active = value; if (value) { resize(); dirty = true; wake(); } else { cancelAnimationFrame(raf); raf = 0; } },
    dispose() {
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); controls.dispose();
      document.removeEventListener('visibilitychange', onVisibility); motion.removeEventListener('change', onMotion);
      renderer.domElement.removeEventListener('dblclick', onDouble); renderer.domElement.removeEventListener('webglcontextlost', onLost);
      for (const [event, handler] of Object.entries(pointerEvents)) renderer.domElement.removeEventListener(event, handler);
      for (const a of actors.values()) disposeActor(a);
      modelWarning?.remove();
      const geo = new Set(), mats = new Set(), textures = new Set();
      xiaoque?.traverse(o => { if (o.geometry) geo.add(o.geometry); for (const m of o.material ? Array.isArray(o.material) ? o.material : [o.material] : []) { mats.add(m); for (const v of Object.values(m)) if (v?.isTexture) textures.add(v); } });
      scene.traverse(o => { if (o.geometry) geo.add(o.geometry); for (const m of o.material ? Array.isArray(o.material) ? o.material : [o.material] : []) { mats.add(m); for (const v of Object.values(m)) if (v?.isTexture) textures.add(v); } });
      for (const m of symbols.values()) { mats.add(m); textures.add(m.map); }
      for (const g of geometries.values()) geo.add(g);
      for (const m of materials.values()) mats.add(m);
      for (const s of screenTextures) { mats.add(s.material); textures.add(s.texture); }
      geo.add(contactGeo); mats.add(contactMaterial); textures.add(contactTexture);
      for (const g of geo) g.dispose(); for (const m of mats) m.dispose(); for (const t of textures) t.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
