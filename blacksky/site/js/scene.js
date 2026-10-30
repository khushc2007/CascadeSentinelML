// BLACKSKY scene: the network at night. Procedural, instanced equipment built once per network from the shared layout (shared/three/layout.js);
// setView() only changes per-instance colour and scale from the shared view state (shared/core/encoding.js). The only light in the scene is
// served demand: lamp plates on each demand facility and the light pool beneath it scale with the served fraction the engine reports.
import { sceneLayout, pointAt, SEG } from "../shared/three/layout.js";
import { C } from "./palette.js";

export class BlackskyScene {
  constructor(T, canvas) {
    this.T = T; this.canvas = canvas;
    const r = (this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }));
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); r.outputColorSpace = T.SRGBColorSpace; r.setClearColor(C.bg, 1);
    this.scene = new T.Scene(); this.scene.background = new T.Color(C.bg);
    this.persp = new T.PerspectiveCamera(40, 1, 0.1, 2000); this.ortho = new T.OrthographicCamera(-10, 10, 10, -10, -500, 500); this.camera = this.persp;
    this.scene.add(new T.HemisphereLight(0x8a96a6, 0x07080a, 1.1));
    const key = new T.DirectionalLight(0xc8d4e2, 0.9); key.position.set(-30, 60, 20); this.scene.add(key);
    this.root = new T.Group(); this.scene.add(this.root);
    this.dirty = true; this.reduced = false; this.flowOn = true;
    this.fps = { frames: 0, t0: performance.now(), value: null };
    this.poolTex = this._poolTexture();
  }

  _poolTexture() {                                    // radial falloff for the light pool under each lit facility
    const T = this.T, c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.35, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    this.scene.remove(this.root); this.root = new this.T.Group(); this.scene.add(this.root);
  }

  build(model, { schematic = false } = {}) {
    const T = this.T; this.dispose(); this.model = model; this.schematic = schematic; const L = (this.L = sceneLayout(model, { schematic }));
    const std = (c, o = {}) => new T.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.2, ...o });
    const add = (o) => { this.root.add(o); return o; };
    const gsz = L.size * 2.6;
    const ground = add(new T.Mesh(new T.PlaneGeometry(gsz, gsz), new T.MeshBasicMaterial({ color: C.ground }))); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03;
    this.gridLines = add(new T.GridHelper(gsz, Math.round(gsz / 6), C.gridLine, C.gridLine)); this.gridLines.position.y = -0.02;
    this.scene.fog = schematic ? null : new T.Fog(C.bg, L.size * 1.2, L.size * 3.2);

    const m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    const inst = (geo, mat, n) => { const im = add(new T.InstancedMesh(geo, mat, Math.max(n, 1))); im.count = n; im.instanceMatrix.setUsage(T.DynamicDrawUsage);
      im.instanceColor = new T.InstancedBufferAttribute(new Float32Array(Math.max(n, 1) * 3), 3); im.frustumCulled = false; return im; };
    this.setM = (im, i, pos, quat, scale) => { m4.compose(v.set(...pos), quat || q.identity(), sc.set(...scale)); im.setMatrixAt(i, m4); };
    const hide = (im, i) => this.setM(im, i, [0, -80, 0], null, [0, 0, 0]);
    this.hide = hide;

    // buses: octagonal pad + cap (light = energised, dark = de-energised)
    const oct = new T.CylinderGeometry(1, 1, 1, 8); oct.rotateY(Math.PI / 8);
    this.pad = inst(oct, std(0xffffff, { flatShading: true }), model.nBus);
    this.cap = inst(oct.clone(), new T.MeshBasicMaterial({ color: 0xffffff }), model.nBus);
    L.bus.forEach((b, i) => { this.setM(this.pad, i, [b.x, b.y + b.h / 2, b.z], null, [b.r, b.h, b.r]); this.setM(this.cap, i, [b.x, b.top + 0.01, b.z], null, [b.r * 0.62, 0.03, b.r * 0.62]); });
    // voltage-tier masts
    const raised = L.bus.map((b, i) => [b, i]).filter(([b]) => b.y > 0.01);
    this.mast = inst(new T.CylinderGeometry(1, 1, 1, 6), std(0x2b3036), raised.length);
    raised.forEach(([b], j) => this.setM(this.mast, j, [b.x, b.y / 2, b.z], null, [0.06, b.y, 0.06]));
    // generators: housing + status ring (green online, grey isolated) + stub to the bus
    const nG = model.gens.length;
    this.housing = inst(new T.CylinderGeometry(0.8, 1, 1, 12), std(0xffffff), nG);
    this.ring = inst(new T.CylinderGeometry(1.04, 1.04, 0.14, 16, 1, true), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }), nG);
    this.stub = inst(new T.BoxGeometry(1, 1, 1), std(0x2b3036), nG);
    L.gen.forEach((g, i) => {
      const b = L.bus[model.gens[i].bus]; this.setM(this.housing, i, [g.x, g.y + g.h / 2, g.z], null, [g.s, g.h, g.s]);
      this.setM(this.ring, i, [g.x, g.y + g.h * 0.78, g.z], null, [g.s * 0.92, g.s * 1.1, g.s * 0.92]);
      const dx = g.x - b.x, dz = g.z - b.z, len = Math.hypot(dx, dz) || 1; q.setFromUnitVectors(new T.Vector3(1, 0, 0), new T.Vector3(dx / len, 0, dz / len));
      this.setM(this.stub, i, [(g.x + b.x) / 2, g.y + 0.05, (g.z + b.z) / 2], q, [len, 0.05, 0.07]);
    });
    // demand facilities: three blocks per load with lamp plates on the roofs, and a light pool on the ground
    const nL = model.loads.length; this.fac = [];
    model.loads.forEach((ld, i) => {
      const p = L.load[i], b = L.bus[ld.bus], dx = p.x - b.x, dz = p.z - b.z, n = Math.hypot(dx, dz) || 1, ax = [dx / n, dz / n], side = [-ax[1], ax[0]];
      const H = p.H * (schematic ? 1 : 0.95), w = 0.26;
      this.fac.push([[0, 0, 1], [w * 1.15, 0.4, 0.62], [-w * 1.15, 0.25, 0.42]].map(([o, f, hk]) => ({ x: p.x + side[0] * o + ax[0] * f * w, z: p.z + side[1] * o + ax[1] * f * w, y: p.y, h: Math.max(0.12, H * hk), w })));
    });
    this.block = inst(new T.BoxGeometry(1, 1, 1), std(0xffffff), nL * 3);
    this.plate = inst(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0xffffff }), nL * 3);
    this.pool = inst(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffffff, map: this.poolTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending }), nL);
    this.fac.forEach((blocks, i) => blocks.forEach((k, j) => { this.setM(this.block, i * 3 + j, [k.x, k.y + k.h / 2, k.z], null, [k.w, k.h, k.w]); this.setM(this.plate, i * 3 + j, [k.x, k.y + k.h + 0.012, k.z], null, [k.w * 0.82, 0.02, k.w * 0.82]); }));
    // transformers: mid-span block
    this.xIdx = model.branches.filter((b) => b.transformer).map((b) => b.l);
    this.xfmr = inst(new T.BoxGeometry(1, 1, 1), std(0xffffff), this.xIdx.length);
    // conductors (SEG instanced segments per branch), red dashed ghosts for removed branches, cut markers for initial outages
    const nB = model.nBranch, segGeo = new T.CylinderGeometry(1, 1, 1, 5, 1, true); segGeo.translate(0, 0.5, 0);
    this.cond = inst(segGeo, std(0xffffff, { roughness: 0.5, metalness: 0.4, side: T.DoubleSide }), nB * SEG);
    this.ghost = inst(segGeo.clone(), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), nB * SEG);
    this.cuts = inst(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0xffffff }), nB * 2);
    this.segQ = []; this.segInfo = [];
    L.branch.forEach((rt, l) => { for (let i = 0; i < SEG; i++) { const a = rt.pts[i], b = rt.pts[i + 1], d = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const len = d.length(); this.segQ[l * SEG + i] = new T.Quaternion().setFromUnitVectors(up, d.normalize()); this.segInfo[l * SEG + i] = { a, len }; } });
    // flow chevrons (direction of the signed DC flow; only where the engine recorded flows)
    this.flowN = L.branch.map((rt) => Math.max(1, Math.min(5, Math.round(rt.span / 3))));
    this.flowBase = []; let acc = 0; this.flowN.forEach((n) => { this.flowBase.push(acc); acc += n; });
    const cone = new T.ConeGeometry(1, 1, 3); cone.rotateX(Math.PI / 2);
    this.flow = inst(cone, new T.MeshBasicMaterial({ color: 0xffffff }), acc);
    this.flowPhase = new Float32Array(nB).map((_, l) => ((l * 0.618) % 1));
    // island discs (energised islands other than the largest)
    this.disc = inst(new T.CylinderGeometry(1, 1, 0.01, 28), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }), model.nBus);
    // selection / hover / armed-contingency overlays
    this.selGroup = add(new T.Group()); this.hovGroup = add(new T.Group()); this.armGroup = add(new T.Group());
    // APEX propagation effects: trip fronts (pulses running out along a tripped line) and outage rings; additive, so fading = darkening
    const fxMat = () => new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending });
    this.pulse = inst(new T.SphereGeometry(1, 10, 8), fxMat(), 96); this.pulse.count = 0; this.pulse.renderOrder = 8;
    this.burn = inst(segGeo.clone(), fxMat(), 48 * SEG); this.burn.count = 0; this.burn.renderOrder = 7;
    this.ringFx = inst(new T.TorusGeometry(1, 0.05, 6, 48).rotateX(Math.PI / 2), fxMat(), 24); this.ringFx.count = 0; this.ringFx.renderOrder = 8;
    this.fxList = []; this._tw = null; this._twReady = false; this.fxScale = this.fxScale || 1;
    this.view = null; this.dirty = true;
    return L;
  }

  setView(view, opts = {}) {
    const T = this.T, L = this.L, model = this.model; this.view = view; this.opts = opts; const col = new T.Color();
    const tweened = [this.plate, this.pool, this.cap, this.pad, this.block, this.cond];
    const before = opts.tween && !this.reduced && this._twReady ? tweened.map((im) => im.instanceColor.array.slice()) : null;
    const ov = opts.overlay || null;
    const setC = (im, i, hex) => { col.setHex(hex); im.setColorAt(i, col); };
    const lampC = (f) => col.setHex(C.plateOff).lerp(new T.Color(C.lamp), Math.max(0, Math.min(1, f)));
    // buses
    model.buses.forEach((b, i) => { const st = view.buses[i], p = L.bus[i];
      setC(this.pad, i, st.energized ? C.padBody : C.housingDead); setC(this.cap, i, st.energized ? C.padCap : C.padCapDead);
      const isl = !!view.frame && st.energized && !st.mainIsland && st.component != null;
      setC(this.disc, i, isl ? C.iceDim : 0); this.setM(this.disc, i, [p.x, p.y + 0.005, p.z], null, isl ? [p.r * 2.8, 1, p.r * 2.8] : [0, 0, 0]); });
    // generators
    model.gens.forEach((g, i) => { const on = view.gens[i].energized && g.in_service; setC(this.housing, i, on ? C.housing : C.housingDead); setC(this.ring, i, on ? C.green : C.grey); setC(this.stub, i, 0x2b3036); });
    // demand facilities: lamp plates = served fraction (unknown per-bus curtailment → energisation only)
    this.lampUnknown = false;
    model.loads.forEach((ld, i) => { const st = view.buses[ld.bus]; let f = st.served_fraction; if (f == null) { f = st.energized ? 1 : 0; if (view.frame) this.lampUnknown = true; }
      this.fac[i].forEach((_, j) => { setC(this.block, i * 3 + j, st.energized ? C.block : C.blockDead); lampC(f); this.plate.setColorAt(i * 3 + j, col); });
      const p = L.load[i], r = 2.8 + 3.0 * Math.sqrt(ld.demand_mw / L.maxLoad); lampC(f * 0.95); this.pool.setColorAt(i, col);
      this.setM(this.pool, i, [p.x, p.y + 0.002, p.z], null, !this.schematic ? [r, 1, r] : [0, 0, 0]); });
    // transformers
    this.xIdx.forEach((l, j) => { const m = L.branch[l].mid, st = view.branches[l].state, gone = st === "initial_outage" || st === "tripped";
      setC(this.xfmr, j, gone ? C.redDim : st === "deenergized" ? C.lineDead : C.xfmr); this.setM(this.xfmr, j, m, null, [0.36, 0.3, 0.36]); });
    // conductors
    const rad = this.schematic ? 0.055 : 0.07; let gi = 0, ci = 0;
    model.branches.forEach((br, l) => {
      const st = view.branches[l], s = st.state, gone = s === "initial_outage" || s === "tripped";
      let c = s === "overload" ? C.amber : s === "warning" ? C.amberDim : s === "deenergized" || s === "unavailable" ? C.lineDead : C.line;
      let w = s === "overload" ? rad * 2.3 : s === "warning" ? rad * 1.4 : rad;
      if (ov && !gone) { c = ov.color[l]; w = rad * ov.width[l]; }
      for (let i = 0; i < SEG; i++) { const k = l * SEG + i, si = this.segInfo[k];
        setC(this.cond, k, c); this.setM(this.cond, k, si.a, this.segQ[k], gone ? [0, 0, 0] : [w, si.len, w]);
        if (gone && i % 2 === 0) { const init = s === "initial_outage"; setC(this.ghost, gi, init ? C.red : C.redTrip);
          this.setM(this.ghost, gi++, si.a, this.segQ[k], init ? [rad * 1.15, si.len, rad * 1.15] : [rad * 0.42, si.len * 0.55, rad * 0.42]); } }
      if (s === "initial_outage") [0.1, 0.9].forEach((t) => { this.setM(this.cuts, ci, pointAt(L.branch[l], t), null, [0.2, 0.2, 0.2]); setC(this.cuts, ci++, C.red); });
    });
    this.ghost.count = gi; this.cuts.count = ci;
    [this.pad, this.cap, this.disc, this.housing, this.ring, this.stub, this.block, this.plate, this.pool, this.xfmr, this.cond, this.ghost, this.cuts].forEach((im) => {
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
    if (before) { const now = performance.now(); this._tw = { t0: now, dur: 520, items: tweened.map((im, i) => ({ im, from: before[i], to: im.instanceColor.array.slice() })) };
      this._tw.items.forEach((it) => it.im.instanceColor.array.set(it.from)); }
    else this._tw = null;
    this._twReady = true;
    this.flowOn = opts.flow !== false; this.hasFlowCached = this.hasFlow(); this._flow(0); this.dirty = true;
  }

  // APEX · propagation. Called by the shell when playback advances by one event. Trip events send a front out from the middle of each
  // tripped line to both of its ends; the initial outage adds an expanding ring at each outaged line. Durations are fixed; reduced motion
  // disables both (the state change itself is still shown).
  fx(ev) {
    if (this.reduced || !ev || !this.L) return; const now = performance.now();
    const lines = ev.entities.filter((k) => k.startsWith("branch:")).map((k) => +k.split(":")[1]).filter((l) => this.L.branch[l]).slice(0, 40);
    const k = this.fxScale || 1;
    if (ev.type === "trip") lines.forEach((l, i) => this.fxList.push({ kind: "run", l, t0: now + (i % 8) * 40 * k, dur: 1100 * k }));
    if (ev.type === "initial_outage") lines.forEach((l) => { this.fxList.push({ kind: "ring", l, t0: now, dur: 1500 * k }); this.fxList.push({ kind: "run", l, t0: now, dur: 1300 * k }); });
    this.dirty = true;
  }
  _fxStep(now) {
    const col = new this.T.Color(), red = new this.T.Color(C.red), hot = new this.T.Color(0xffd2c4); let np = 0, nr = 0, nb = 0; const rad = this.schematic ? 0.055 : 0.07;
    this.fxList = this.fxList.filter((f) => now - f.t0 < f.dur);
    for (const f of this.fxList) { const t = Math.max(0, (now - f.t0) / f.dur), e = 1 - (1 - t) ** 3, rt = this.L.branch[f.l];
      if (t <= 0) continue;
      if (f.kind === "run" && np + 2 <= this.pulse.instanceMatrix.count) { col.copy(hot).lerp(red, Math.min(1, t * 1.6)).multiplyScalar(1 - t);
        for (const d of [-1, 1]) { const p = pointAt(rt, 0.5 + d * 0.5 * e), r = 0.32 * (1 - 0.5 * t); this.setM(this.pulse, np, p, null, [r, r, r]); this.pulse.setColorAt(np++, col); }
        // the line itself burns out: bright, then red, then gone (the dashed ghost of the tripped line stays)
        col.copy(hot).lerp(red, Math.min(1, t * 2)).multiplyScalar(0.85 * (1 - t) ** 1.5);
        for (let i = 0; i < SEG && nb < this.burn.instanceMatrix.count; i++) { const kk = f.l * SEG + i, si = this.segInfo[kk]; this.setM(this.burn, nb, si.a, this.segQ[kk], [rad * 2.4, si.len, rad * 2.4]); this.burn.setColorAt(nb++, col); } }
      else if (f.kind === "ring" && nr < this.ringFx.instanceMatrix.count) { const r = 0.4 + 2.6 * e; col.copy(red).multiplyScalar(0.9 * (1 - t)); this.setM(this.ringFx, nr, rt.mid, null, [r, r * 1.6, r]); this.ringFx.setColorAt(nr++, col); } }
    this.pulse.count = np; this.ringFx.count = nr; this.burn.count = nb;
    for (const im of [this.pulse, this.ringFx, this.burn]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
  _twStep(now) {
    const w = this._tw, t = Math.min(1, (now - w.t0) / w.dur), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    for (const it of w.items) { const a = it.im.instanceColor.array; for (let i = 0; i < a.length; i++) a[i] = it.from[i] + (it.to[i] - it.from[i]) * e; it.im.instanceColor.needsUpdate = true; }
    if (t >= 1) this._tw = null;
  }
  get animating() { return !!this._tw || this.fxList.length > 0; }

  // layer visibility (Theater "Layers" menu): reference grid, light pools, generators, demand facilities; flow and labels are handled by
  // setView({ flow }) and labels.js. Picking ignores hidden generators / demand facilities.
  setLayers(l) {
    this.layers = l; if (!this.model) return;
    if (this.gridLines) this.gridLines.visible = l.grid !== false;
    if (this.pool) this.pool.visible = l.lights !== false;
    for (const im of [this.housing, this.ring, this.stub]) if (im) im.visible = l.gens !== false;
    for (const im of [this.block, this.plate]) if (im) im.visible = l.loads !== false;
    if (this.pool && l.loads === false) this.pool.visible = false;
    this.dirty = true;
  }

  hasFlow() { return !!(this.view && this.view.branches.some((b) => b.flow_mw != null)); }
  _flow(dt) {
    const v = this.view, L = this.L, col = new this.T.Color(); if (!v || !this.flow) return;
    this.model.branches.forEach((br, l) => {
      const st = v.branches[l], n = this.flowN[l], base = this.flowBase[l];
      const live = this.flowOn && st.flow_mw != null && Math.abs(st.flow_mw) > 0.5 && !["initial_outage", "tripped", "deenergized"].includes(st.state);
      const dir = st.flow_mw >= 0 ? 1 : -1, speed = this.reduced ? 0 : (0.04 + 0.3 * Math.min(st.u ?? 0, 1.3)) * (6 / Math.max(L.branch[l].span, 1));
      this.flowPhase[l] = (this.flowPhase[l] + dir * speed * dt + 1) % 1;
      for (let i = 0; i < n; i++) {
        const k = base + i; if (!live) { this.hide(this.flow, k); continue; }
        const t = (this.flowPhase[l] + i / n) % 1, a = pointAt(L.branch[l], t), b = pointAt(L.branch[l], Math.min(Math.max(t + dir * 0.01, 0), 1));
        const qq = new this.T.Quaternion(), d = new this.T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(); if (d.lengthSq() > 0) qq.setFromUnitVectors(new this.T.Vector3(0, 0, 1), d);
        this.setM(this.flow, k, a, qq, [0.07, 0.07, 0.17]); col.setHex(st.state === "overload" ? C.amber : st.state === "warning" ? C.amberDim : C.flow); this.flow.setColorAt(k, col);
      }
    });
    this.flow.instanceMatrix.needsUpdate = true; if (this.flow.instanceColor) this.flow.instanceColor.needsUpdate = true;
  }

  _clear(g) { g.children.slice().forEach((c) => { g.remove(c); c.geometry.dispose(); c.material.dispose(); }); }
  highlight(which, key) {
    const T = this.T, g = which === "sel" ? this.selGroup : this.hovGroup; this._clear(g); this.dirty = true;
    if (!key || !this.model || !this.model.byKey.has(key)) return;
    const [kind, vs] = key.split(":"), id = Number(vs), sel = which === "sel";
    const mat = new T.MeshBasicMaterial({ color: sel ? C.ice : 0x9fb3c2, transparent: true, opacity: sel ? 0.95 : 0.6, depthTest: false });
    const add = (geo, pos, flat = true) => { const m = new T.Mesh(geo, mat); if (pos) m.position.set(...pos); if (flat) m.rotation.x = Math.PI / 2; m.renderOrder = 10; g.add(m); return m; };
    if (kind === "branch") add(new T.TubeGeometry(new T.CatmullRomCurve3(this.L.branch[id].pts.map((p) => new T.Vector3(...p))), 48, sel ? 0.12 : 0.09, 6, false), null, false);
    else if (kind === "bus") { const b = this.L.bus[this.model.busById.get(id).i]; add(new T.TorusGeometry(b.r * 1.6, 0.05, 6, 40), [b.x, b.top + 0.04, b.z]); }
    else if (kind === "gen") { const p = this.L.gen[id]; add(new T.TorusGeometry(p.s * 1.6, 0.045, 6, 32), [p.x, p.y + p.h + 0.15, p.z]); }
    else if (kind === "load") { const i = this.model.loads.findIndex((l) => l.busId === id), p = this.L.load[i]; add(new T.TorusGeometry(0.62, 0.045, 6, 32), [p.x, p.y + 0.05, p.z]); }
  }
  arm(outage) {                                       // contingency being built in the Arena (not yet run): red tubes
    const T = this.T; this._clear(this.armGroup); this.dirty = true;
    for (const l of outage || []) { const rt = this.L.branch[l]; const m = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(rt.pts.map((p) => new T.Vector3(...p))), 40, 0.1, 6, false),
      new T.MeshBasicMaterial({ color: C.red, transparent: true, opacity: 0.85, depthTest: false })); m.renderOrder = 9; this.armGroup.add(m); }
  }

  entityPos(key) {
    const [kind, vs] = key.split(":"), id = Number(vs), L = this.L;
    if (kind === "branch") return L.branch[id].mid;
    if (kind === "bus") { const b = L.bus[this.model.busById.get(id).i]; return [b.x, b.top, b.z]; }
    if (kind === "gen") { const p = L.gen[id]; return [p.x, p.y + p.h, p.z]; }
    if (kind === "load") { const i = this.model.loads.findIndex((l) => l.busId === id); const f = this.fac[i][0]; return [f.x, f.y + f.h, f.z]; }
    return [0, 0, 0];
  }
  entityPoints(key) { const [kind, vs] = key.split(":"); return kind === "branch" ? this.L.branch[Number(vs)].pts : [this.entityPos(key)]; }
  project(p) { const v = new this.T.Vector3(...p).project(this.camera), r = this.canvas.getBoundingClientRect(); return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height, v.z]; }
  pick(x, y, tol = 9) {
    if (!this.model) return null; const L = this.L, m = this.model; let best = null, bd = Infinity;
    const consider = (key, d, pri) => { const s = d - pri; if (d < tol + pri && s < bd) { bd = s; best = key; } };
    m.buses.forEach((b, i) => { const p = this.project([L.bus[i].x, L.bus[i].top, L.bus[i].z]); if (p[2] < 1) consider(b.key, Math.hypot(p[0] - x, p[1] - y), 6); });
    const lay = this.layers || {};
    if (lay.gens !== false) m.gens.forEach((g, i) => { const p = this.project([L.gen[i].x, L.gen[i].y + L.gen[i].h, L.gen[i].z]); if (p[2] < 1) consider(g.key, Math.hypot(p[0] - x, p[1] - y), 4); });
    if (lay.loads !== false) m.loads.forEach((ld) => { const p = this.project(this.entityPos(ld.key)); if (p[2] < 1) consider(ld.key, Math.hypot(p[0] - x, p[1] - y), 3); });
    m.branches.forEach((br, l) => {
      const pts = L.branch[l].pts.map((p) => this.project(p)); let d = Infinity;
      for (let i = 0; i < SEG; i++) { const a = pts[i], b = pts[i + 1]; if (a[2] > 1 || b[2] > 1) continue; const vx = b[0] - a[0], vy = b[1] - a[1], ll = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / ll)); d = Math.min(d, Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t)); }
      consider(br.key, d, 0);
    });
    return best;
  }
  // shift the image so the network is centred in the part of the canvas not covered by a side panel (projection-level, so picking stays exact)
  setOffset(px) { this.offsetX = px; this.resize(); }
  resize() {
    const r = this.canvas.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height), dx = Math.round(this.offsetX || 0);
    this.renderer.setSize(w, h, false); this.persp.aspect = w / h; this.aspect = w / h;
    for (const c of [this.persp, this.ortho]) { if (dx) c.setViewOffset(w, h, -dx, 0, w, h); else c.clearViewOffset(); }
    this.persp.updateProjectionMatrix(); this.dirty = true;
  }
  _adapt(ms) {                                        // slow frames (software rendering): pixel ratio 1, then flow updates at 15 fps
    this.q = this.q || { level: 0, ema: 16, since: performance.now(), skip: 0 }; const q = this.q; q.ema = q.ema * 0.9 + ms * 0.1;
    if (q.ema > 45 && q.level < 2 && performance.now() - q.since > 1500) { q.level++; q.since = performance.now(); if (q.level === 1) { this.renderer.setPixelRatio(1); this.resize(); } }
    else if (q.ema > 110 && q.level === 2 && performance.now() - q.since > 2500) { q.level = 3; this.flowFrozen = true; }
  }
  qualityLabel() { return ["full", "pixel ratio 1", "pixel ratio 1, flow at 15 fps", "pixel ratio 1, flow arrows static (slow renderer)"][this.q ? this.q.level : 0]; }
  render(dt) {
    const animate = this.flowOn && !this.reduced && !this.flowFrozen && this.view && this.hasFlowCached;
    if (animate) { const q = this.q; if (!q || q.level < 2 || (q.skip = (q.skip + 1) % 4) === 0) { this._flow(q && q.level >= 2 ? dt * 4 : dt); this.dirty = true; } }
    if (this._tw || this.fxList.length) { const now = performance.now(); if (this._tw) this._twStep(now); if (this.fxList.length || this.pulse.count || this.ringFx.count || this.burn.count) this._fxStep(now); this.dirty = true; }
    if (!this.dirty) return false;
    const t0 = performance.now(); this.renderer.render(this.scene, this.camera); this.dirty = false;
    if (animate && this._lastDraw) this._adapt(Math.min(t0 - this._lastDraw, 500)); this._lastDraw = animate ? t0 : 0;
    const now = performance.now(); this.fps.frames++; if (now - this.fps.t0 > 1000) { this.fps.value = (1000 * this.fps.frames) / (now - this.fps.t0); this.fps.frames = 0; this.fps.t0 = now; }
    return true;
  }
  info() { const i = this.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, fps: this.fps.value, frameMs: this.q ? this.q.ema : null, quality: this.qualityLabel() }; }
}
