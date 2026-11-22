// The 3D palace (proposal step 4). The building itself comes from settings.js;
// this file adds what every setting shares: the numbered stops and the dotted
// path between them, the objects the reader placed, and the camera (tours,
// walking, clicking objects). Plain three.js, no addons.
import * as THREE from 'three';
import { buildObject } from './objects.js';
import { SETTINGS, disposeSetting } from './settings.js';

const EYE = 1.7;
const OBJECT_SCALE = 1.35;
// Candidates: the objects offered for a stop float on a tilted ring around it.
// scroll-to-move speed: one mouse-wheel notch (about 100 px) is 0.14 m
const WHEEL_METRES_PER_PX = 0.0014;
const WHEEL_MAX_STEP = 0.18; // per wheel event
const WHEEL_MAX_GLIDE = 1.2; // most that can be queued up by fast scrolling
const CAND_RADIUS = 1.25;
const CAND_TILT = THREE.MathUtils.degToRad(55); // the far side of the ring is higher
const CAND_HEIGHT = 1.4;                        // ring centre above the stop
const CAND_SIZE = 0.8;                          // every candidate is shown at about this size
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const angleLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

function disposeObject(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) m.dispose();
  });
}

function labelTexture(text, fg, bg) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = fg; g.stroke();
  g.fillStyle = fg;
  g.font = 'bold 64px Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Room {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 100);
    this.camera.rotation.order = 'YXZ';
    this.yaw = 0;
    this.pitch = -0.05;
    this.camera.position.set(0, EYE, 6.2);
    this.env = null;       // the current setting: { group, stops, entrance, overview, clamp }

    this.slots = [];       // { pos, marker, ring, label, object, objectId }
    this.pathGroup = new THREE.Group();
    this.scene.add(this.pathGroup);
    this.mode = 'landing';
    this.tween = null;
    this.keys = new Set();
    this.glide = 0;        // metres still to move from scrolling (eased in frame())
    this.panelInset = { right: 0, bottom: 0 };
    this.onPick = () => {};
    this.hovered = null;
    this.spawning = [];
    this.cand = null;      // candidates floating around one stop (see showCandidates)
    this.pulses = [];
    this.onCandidateHover = () => {};   // (k | null)
    this.onCandidatePick = () => {};    // (k)
    this.onCandidatesMove = () => {};   // ([{ k, x, y, visible }]) screen position under each candidate
    this.onLanded = () => {};           // (slot) a picked candidate has reached its stop
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();

    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- Setting ---------------------------------------------------------------

  /** Switch to another building. Stops are laid out again and placed objects are kept. */
  setTheme(theme) {
    if (this.env && this.theme?.id === theme.id) return;
    const kept = this.slots.map((s) => s.objectId);
    if (this.env) {
      this.scene.remove(this.env.group);
      disposeSetting(this.env.group);
    }
    this.theme = theme;
    this.env = (SETTINGS[theme.id] || SETTINGS.library)();
    this.scene.add(this.env.group);
    this.scene.background = new THREE.Color(theme.bg);
    if (kept.length) {
      this.setSlotCount(kept.length);
      kept.forEach((id, i) => this.placeObject(i, id, false));
    }
  }

  // ---- Slots + path -------------------------------------------------------

  setSlotCount(n) {
    this.clearCandidates();
    for (const s of this.slots) {
      this.scene.remove(s.group);
    }
    this.slots = [];
    const all = this.env.stops;
    const idx = n === 0 ? [] : n === 1 ? [Math.floor(all.length / 2)]
      : Array.from({ length: Math.min(n, all.length) }, (_, i) => Math.round((i * (all.length - 1)) / (Math.min(n, all.length) - 1)));
    idx.forEach((k, i) => {
      const { pos, view, maxDist } = all[k];
      const group = new THREE.Group();
      group.position.copy(pos);
      const accent = this.theme?.accent || '#b5651d';

      const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.8, 40), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.8 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;

      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.2, 0),
        new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.8, roughness: 0.2, transparent: true, opacity: 0.9 }),
      );
      marker.scale.y = 1.6;
      marker.position.y = 1.3;
      marker.castShadow = true;
      marker.userData.slot = i;

      // number tile on the floor, on the side the visitor stands
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.42),
        new THREE.MeshBasicMaterial({ map: labelTexture(String(i + 1), '#3a2a1a', '#f6f0e0'), transparent: true }),
      );
      label.rotation.x = -Math.PI / 2;
      label.rotation.z = Math.atan2(view.x, view.z);
      label.position.copy(view.clone().multiplyScalar(1.05)).setY(0.014);

      group.add(ring, marker, label);
      group.userData.slot = i;
      this.scene.add(group);
      this.slots.push({ pos, view, maxDist, group, ring, marker, label, object: null, objectId: null });
    });
    this.drawPath();
  }

  drawPath() {
    this.pathGroup.clear();
    if (!this.slots.length) return;
    const pts = [this.env.entrance, ...this.slots.map((s) => s.pos)];
    const mat = new THREE.MeshBasicMaterial({ color: this.theme?.accent || '#b5651d', transparent: true, opacity: 0.85 });
    const geo = new THREE.CircleGeometry(0.09, 12);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const steps = Math.floor(flat(a, b) / 0.42);
      for (let k = 1; k < steps; k++) {
        const p = a.clone().lerp(b, k / steps);
        if (flat(p, b) < 1.15 || (i > 0 && flat(p, a) < 1.15)) continue;
        const dot = new THREE.Mesh(geo, mat);
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(p.x, 0.012, p.z);
        this.pathGroup.add(dot);
      }
    }
  }

  setPathVisible(v) {
    this.pathGroup.visible = v;
    for (const s of this.slots) s.group.visible = v || !!s.object;
    for (const s of this.slots) { s.ring.visible = v; s.label.visible = v; }
  }

  placeObject(i, id, animate = true) {
    const s = this.slots[i];
    if (!s) return;
    if (s.object) s.group.remove(s.object);
    s.object = null;
    s.objectId = id;
    s.marker.visible = !id;
    if (!id) return;
    const obj = buildObject(id);
    // face the visitor
    obj.rotation.y = Math.atan2(s.view.x, s.view.z);
    if (obj.userData.faceX) obj.rotation.y -= Math.PI / 2;
    obj.userData.slot = i;
    obj.scale.setScalar(OBJECT_SCALE);
    s.group.add(obj);
    s.object = obj;
    if (animate) {
      obj.scale.setScalar(0.001);
      this.spawning.push({ obj, t: 0 });
    }
  }

  // ---- Candidates ---------------------------------------------------------
  // While the reader chooses an object for a stop, the suggested objects float on
  // a tilted ring around it: small, slowly circling, each turning on its own axis.
  // Pointing at one shows a faint full-size preview on the stop; clicking it sends
  // it down to the stop, where it grows to its real size.

  showCandidates(i, ids) {
    const key = `${this.theme?.id}:${i}:${ids.join(',')}:${this.slots[i]?.objectId || ''}`;
    if (this.cand?.key === key && !this.cand.landing) return;
    this.clearCandidates();
    const s = this.slots[i];
    if (!s || !ids.length) return;
    const accent = this.theme?.accent || '#b5651d';
    const group = new THREE.Group();
    this.scene.add(group);
    const center = s.pos.clone().setY(s.pos.y + CAND_HEIGHT);
    const right = new THREE.Vector3(s.view.z, 0, -s.view.x);
    const rise = new THREE.Vector3(-s.view.x * Math.cos(CAND_TILT), Math.sin(CAND_TILT), -s.view.z * Math.cos(CAND_TILT));

    // the ring they travel on
    const line = new THREE.Mesh(
      new THREE.TorusGeometry(CAND_RADIUS, 0.007, 6, 96),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    line.position.copy(center);
    line.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, rise, right.clone().cross(rise)));
    group.add(line);

    // Around an empty stop they circle on the whole ring. When an object already
    // stands there (the reader came back to swap it), they wait on the two sides
    // instead, where it cannot hide them.
    const occupied = !!s.object;
    const sideAngle = (k) => {
      const onLeft = k % 2 === 1;
      const count = onLeft ? Math.floor(ids.length / 2) : Math.ceil(ids.length / 2);
      const spread = count > 1 ? (Math.floor(k / 2) / (count - 1) - 0.5) * 1.5 : 0;   // about ±43°
      return onLeft ? Math.PI - spread : spread;
    };

    const list = ids.map((id, k) => {
      const obj = buildObject(id);
      obj.traverse((o) => { o.castShadow = false; });
      const b = new THREE.Box3().setFromObject(obj);
      const rad = Math.max(Math.hypot(b.min.x, b.min.z), Math.hypot(b.max.x, b.max.z), Math.hypot(b.min.x, b.max.z), Math.hypot(b.max.x, b.min.z));
      const mini = CAND_SIZE / Math.max(b.max.y - b.min.y, 1.6 * rad);   // long, flat objects may be a little wider
      const cy = (b.max.y + b.min.y) / 2;
      obj.position.y = -cy;                 // the middle of the object sits on the ring
      const turn = new THREE.Group();       // turns the object on its own axis
      turn.add(obj);
      turn.scale.setScalar(0.001);
      const pad = new THREE.Mesh(
        new THREE.RingGeometry(0.27, 0.31, 40),
        new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = -CAND_SIZE / 2 - 0.05;
      // generous invisible target so small or thin objects are easy to point at
      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(CAND_SIZE * 0.6, 12, 8),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.userData.cand = k;
      const holder = new THREE.Group();
      holder.add(turn, pad, hit);
      group.add(holder);
      return { id, k, holder, turn, obj, pad, hit, mini, cy, angle: occupied ? sideAngle(k) : Math.PI / 2 - (k / ids.length) * Math.PI * 2, hot: 0, grow: -k * 0.12, out: null, land: null };
    });
    this.cand = { key, slot: i, group, line, list, center, right, rise, spin: 0, still: occupied, hot: null, ghost: null, landing: null };
  }

  /** Remove the candidates. A candidate that was on its way down is placed at once. */
  clearCandidates() {
    const c = this.cand;
    if (!c) return;
    this.cand = null;
    const s = this.slots[c.slot];
    if (c.ghost) { s?.group.remove(c.ghost); disposeObject(c.ghost); }
    if (c.landing) this.placeObject(c.slot, c.landing.id, false);
    else if (s) s.marker.visible = !s.object;
    this.scene.remove(c.group);
    disposeObject(c.group);
    this.canvas.style.cursor = '';
    this.onCandidatesMove([]);
  }

  /** Point at candidate k (or null): it grows, and a faint preview shows where it would stand. */
  setCandidateHover(k) {
    const c = this.cand;
    if (!c || c.landing) return;
    if (k !== null && (!c.list[k] || c.list[k].out !== null)) k = null;
    if (c.hot === k) return;
    c.hot = k;
    const s = this.slots[c.slot];
    if (c.ghost) { s.group.remove(c.ghost); disposeObject(c.ghost); c.ghost = null; }
    if (k !== null && !s.object) {
      const g = buildObject(c.list[k].id);
      g.rotation.y = Math.atan2(s.view.x, s.view.z) - (g.userData.faceX ? Math.PI / 2 : 0);
      g.scale.setScalar(OBJECT_SCALE);
      g.traverse((o) => {
        if (!o.isMesh) return;
        o.material.transparent = true;
        o.material.opacity *= 0.3;
        o.material.depthWrite = false;
        o.castShadow = false;
      });
      s.group.add(g);
      c.ghost = g;
    }
    s.marker.visible = !s.object && !c.ghost;
    this.onCandidateHover(k);
  }

  /** Send candidate k down to its stop. Returns false if it cannot fly right now. */
  landCandidate(k) {
    const c = this.cand;
    const m = c?.list[k];
    if (!m || c.landing || m.out !== null) return false;
    this.setCandidateHover(null);
    const s = this.slots[c.slot];
    this.placeObject(c.slot, null);   // an object that stood here before makes way
    s.marker.visible = false;
    s.objectId = m.id;
    const rot = m.turn.rotation.y;
    let rotTo = Math.atan2(s.view.x, s.view.z) - (m.obj.userData.faceX ? Math.PI / 2 : 0);
    rotTo += Math.PI * 2 * Math.ceil((rot - rotTo) / (Math.PI * 2)); // keep turning the same way, end facing the visitor
    m.land = { t: 0, from: m.holder.position.clone(), scale: m.turn.scale.x, rot, rotTo };
    m.obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    c.landing = m;
    c.line.visible = false;
    for (const o of c.list) if (o !== m) o.out = 0;
    this.canvas.style.cursor = '';
    return true;
  }

  candidateAt(e) {
    const c = this.cand;
    if (!c || c.landing) return null;
    this.aim(e);
    const hit = this.raycaster.intersectObjects(c.list.filter((m) => m.out === null).map((m) => m.hit), false)[0];
    return hit ? hit.object.userData.cand : null;
  }

  /** dt drives the gentle motion; real (uncapped-ish) time drives the short animations so slow frames cannot stall them. */
  updateCandidates(t, dt, real) {
    const c = this.cand;
    if (!c) return;
    const s = this.slots[c.slot];
    if (c.hot === null && !c.landing && !c.still) c.spin += dt * 0.12;   // hold still while the reader points at one
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const labels = [];
    const v = new THREE.Vector3();
    for (const m of c.list) {
      if (m.land) {
        const L = m.land;
        L.t = Math.min(1, L.t + real / 0.85);
        const k = ease(L.t);
        m.holder.position.lerpVectors(L.from, s.pos, k);
        m.holder.position.y += Math.sin(Math.PI * k) * 0.45;   // a small arc on the way down
        m.obj.position.y = -m.cy * (1 - k);                     // from "centred on the ring" to "standing on the floor"
        m.turn.scale.setScalar(THREE.MathUtils.lerp(L.scale, OBJECT_SCALE, k));
        m.turn.rotation.y = THREE.MathUtils.lerp(L.rot, L.rotTo, k);
        m.pad.material.opacity = 0.7 * (1 - k);
        continue;
      }
      if (m.out !== null) {
        m.out = Math.min(1, m.out + real / 0.3);
        m.holder.scale.setScalar(Math.max(0.001, 1 - m.out));
        m.holder.visible = m.out < 1;
        continue;
      }
      const a = m.angle + c.spin;
      m.holder.position.copy(c.center)
        .addScaledVector(c.right, CAND_RADIUS * Math.cos(a))
        .addScaledVector(c.rise, CAND_RADIUS * Math.sin(a));
      m.holder.position.y += Math.sin(t * 1.4 + m.k * 1.7) * 0.05;
      m.turn.rotation.y += dt * 0.7;
      m.grow = Math.min(1, m.grow + real / 0.5);
      m.hot += ((c.hot === m.k ? 1 : 0) - m.hot) * Math.min(1, dt * 10);
      m.turn.scale.setScalar(Math.max(0.001, m.mini * easeBack(Math.max(0, m.grow)) * (1 + 0.32 * m.hot)));
      m.pad.material.opacity = Math.min(1, 0.55 + 0.2 * Math.sin(t * 2.2 + m.k) + 0.3 * m.hot);
      v.copy(m.holder.position);
      v.y -= CAND_SIZE / 2 + 0.14;
      v.project(this.camera);
      labels.push({ k: m.k, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z < 1 && m.grow > 0.5 });
    }
    if (c.landing && c.landing.land.t >= 1) {
      const id = c.landing.id;
      this.cand = null;
      this.placeObject(c.slot, id, false);
      this.scene.remove(c.group);
      disposeObject(c.group);
      // a ring of light spreads over the floor where it landed
      const pulse = new THREE.Mesh(
        new THREE.RingGeometry(0.74, 0.8, 48),
        new THREE.MeshBasicMaterial({ color: this.theme?.accent || '#b5651d', transparent: true, opacity: 0.9, depthWrite: false }),
      );
      pulse.rotation.x = -Math.PI / 2;
      pulse.position.copy(s.pos).setY(s.pos.y + 0.02);
      this.scene.add(pulse);
      this.pulses.push({ mesh: pulse, t: 0 });
      this.onCandidatesMove([]);
      this.onLanded(c.slot);
      return;
    }
    this.onCandidatesMove(labels);
  }

  // ---- Camera ---------------------------------------------------------------

  setInset(right, bottom) {
    this.panelInset = { right, bottom };
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const { right, bottom } = this.panelInset;
    // Shift the projection centre so the focused object sits in the visible area
    // instead of behind the reading panel: render the canvas as a window onto a
    // larger virtual screen. Aspect and FOV describe that virtual screen.
    const fullW = w + right;
    const fullH = h + bottom;
    this.camera.aspect = fullW / fullH;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(31)) * (fullH / h)));
    if (right || bottom) this.camera.setViewOffset(fullW, fullH, right, bottom, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  flyTo(pos, look, duration = 1.4) {
    const d = look.clone().sub(pos).normalize();
    this.tween = {
      t: 0, duration,
      from: { pos: this.camera.position.clone(), yaw: this.yaw, pitch: this.pitch },
      to: { pos: pos.clone(), yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(d.y) },
    };
  }

  /** Stand in front of a stop. `wide` steps back a little so the ring of candidates fits. */
  focusSlot(i, duration, wide = false) {
    const s = this.slots[i];
    if (!s) return;
    // step further back when the visible area is narrow (phones, side panel),
    // but never further than the building allows at this stop
    const visW = window.innerWidth - this.panelInset.right;
    const visH = window.innerHeight - this.panelInset.bottom;
    const base = wide ? 4.0 : 3.4;
    let dist = base * Math.max(1, 1.15 / (visW / visH));
    // the ring of candidates is about 3.5 m across: on a narrow screen, step back until it fits
    if (wide) dist = Math.max(dist, (3.5 * window.innerHeight) / (2 * visW * Math.tan(THREE.MathUtils.degToRad(31))));
    dist = Math.min(dist, s.maxDist ?? 6.0);
    const pos = s.pos.clone().add(s.view.clone().multiplyScalar(dist)).setY(s.pos.y + EYE + 0.15);
    this.flyTo(pos, s.pos.clone().setY(s.pos.y + (wide ? 1.35 : 1.05)), duration);
  }

  overview(duration) {
    this.flyTo(this.env.overview.pos, this.env.overview.look, duration);
  }

  entrance(duration) {
    const e = this.env.entrance;
    this.flyTo(new THREE.Vector3(e.x, EYE, e.z), new THREE.Vector3(0, EYE - 0.1, 0), duration);
  }

  // ---- Input ------------------------------------------------------------------

  bindInput() {
    const c = this.canvas;
    let down = null;
    c.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (down) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (!down.moved && Math.hypot(dx, dy) > 4) down.moved = true;
        if (down.moved && this.mode !== 'landing') {
          this.tween = null;
          this.yaw += dx * 0.0042;
          this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0042, -1.2, 1.2);
          down.x = e.clientX;
          down.y = e.clientY;
          c.classList.add('dragging');
        }
      } else {
        this.updateHover(e);
      }
    });
    const end = (e) => {
      if (down && !down.moved) this.click(e);
      down = null;
      c.classList.remove('dragging');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => { down = null; });
    c.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.setCandidateHover(null); });
    c.addEventListener('wheel', (e) => {
      if (this.mode === 'landing') return;
      e.preventDefault();
      this.tween = null;
      // Scroll moves the camera gently: the distance follows how far the wheel or
      // trackpad actually moved (a trackpad sends dozens of small events per swipe),
      // and frame() glides there instead of jumping.
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const step = THREE.MathUtils.clamp(-px * WHEEL_METRES_PER_PX, -WHEEL_MAX_STEP, WHEEL_MAX_STEP);
      this.glide = THREE.MathUtils.clamp(this.glide + step, -WHEEL_MAX_GLIDE, WHEEL_MAX_GLIDE);
    }, { passive: false });

    const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    window.addEventListener('keydown', (e) => {
      if (typing()) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) {
        this.keys.add(k);
        if (k.startsWith('arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Point the raycaster at the pointer. */
  aim(e) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  pickAt(e) {
    this.aim(e);
    const targets = this.slots.filter((s) => s.group.visible).flatMap((s) => (s.object ? [s.object] : [s.marker]));
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    if (!hit) return null;
    let o = hit.object;
    while (o && o.userData.slot === undefined) o = o.parent;
    return o ? o.userData.slot : null;
  }

  click(e) {
    if (this.mode === 'landing') return;
    if (this.cand && !this.cand.landing) {
      const k = this.candidateAt(e);
      // no hover on touch screens: the first tap shows what the object stands for, the second places it
      if (e.pointerType === 'touch' && this.cand.hot !== k) { this.setCandidateHover(k); if (k !== null) return; }
      if (k !== null) { this.onCandidatePick(k); return; }
    }
    const slot = this.pickAt(e);
    if (slot !== null) this.onPick(slot);
  }

  updateHover(e) {
    if (this.mode === 'landing') return;
    if (this.cand && !this.cand.landing) {
      const k = this.candidateAt(e);
      this.setCandidateHover(k);
      if (k !== null) {
        this.setHighlight(this.hovered, false);
        this.hovered = null;
        this.canvas.style.cursor = 'pointer';
        return;
      }
    }
    const slot = this.pickAt(e);
    if (slot === this.hovered) return;
    this.setHighlight(this.hovered, false);
    this.hovered = slot;
    this.setHighlight(slot, true);
    this.canvas.style.cursor = slot !== null ? 'pointer' : '';
  }

  setHighlight(i, on) {
    const s = this.slots[i];
    if (!s?.object) return;
    s.object.traverse((o) => {
      if (!o.isMesh) return;
      if (on) {
        o.userData.baseIntensity ??= o.material.emissiveIntensity;
        o.material.emissive.set(this.theme?.accent || '#ffaa55');
        o.material.emissiveIntensity = 0.35;
      } else if (o.userData.baseEmissive) {
        o.material.emissive.copy(o.userData.baseEmissive);
        o.material.emissiveIntensity = o.userData.baseIntensity ?? 1;
      }
    });
  }

  walk(forward, strafe) {
    const p = this.camera.position;
    p.x += -Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe;
    p.z += -Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe;
    this.env.clamp(p);
    p.y += (EYE - p.y) * 0.08;
  }

  // ---- Loop ---------------------------------------------------------------------

  frame() {
    const realDt = this.clock.getDelta();
    const dt = Math.min(realDt, 0.05); // movement/animation step, capped
    const t = this.clock.elapsedTime;

    if (this.glide) {
      if (this.tween || this.mode === 'landing') this.glide = 0;
      else {
        const d = Math.abs(this.glide) < 0.004 ? this.glide : this.glide * Math.min(1, dt * 7);
        this.walk(d, 0);
        this.glide -= d;
      }
    }

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + Math.min(realDt, 0.25) / tw.duration); // real time, so slow frames don't stall it
      const k = ease(tw.t);
      if (this.env.path) this.env.path(tw.from.pos, tw.to.pos, k, this.camera.position);
      else this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, k);
      this.yaw = angleLerp(tw.from.yaw, tw.to.yaw, k);
      this.pitch = THREE.MathUtils.lerp(tw.from.pitch, tw.to.pitch, k);
      if (tw.t >= 1) this.tween = null;
    } else if (this.mode === 'landing') {
      this.yaw = Math.sin(t * 0.12) * 0.35;
    } else if (this.keys.size) {
      const k = this.keys;
      const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const turn = (k.has('arrowleft') || k.has('q') ? 1 : 0) - (k.has('arrowright') || k.has('e') ? 1 : 0);
      const s = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
      this.yaw += turn * dt * 1.6;
      if (f || s) this.walk(f * dt * 3.2, s * dt * 3.2);
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    for (const s of this.slots) {
      if (s.marker.visible) {
        s.marker.rotation.y = t * 1.2;
        s.marker.position.y = 1.3 + Math.sin(t * 2 + s.pos.x) * 0.08;
      }
      const ud = s.object?.userData;
      if (!ud) continue;
      if (ud.spin) for (const [g, v, axis = 'z'] of ud.spin) g.rotation[axis] += v * dt;
      if (ud.pendulum) ud.pendulum.position.x = Math.sin(t * 2.4) * 0.07;
      if (ud.float) {
        ud.floatBase ??= ud.float.position.y;
        ud.float.position.y = ud.floatBase + Math.sin(t * 1.3 + s.pos.x) * 0.08;
      }
      if (ud.flicker) ud.flicker.forEach((f, k) => { f.scale.y = 1 + Math.sin(t * 9 + k * 2) * 0.15; });
    }
    this.spawning = this.spawning.filter((sp) => {
      sp.t = Math.min(1, sp.t + dt / 0.6);
      sp.obj.scale.setScalar(Math.max(0.001, easeBack(sp.t) * OBJECT_SCALE));
      return sp.t < 1;
    });
    this.updateCandidates(t, dt, Math.min(realDt, 0.25));
    this.pulses = this.pulses.filter((p) => {
      p.t = Math.min(1, p.t + Math.min(realDt, 0.25) / 0.8);
      p.mesh.scale.setScalar(1 + p.t * 1.4);
      p.mesh.material.opacity = 0.9 * (1 - p.t);
      if (p.t < 1) return true;
      this.scene.remove(p.mesh);
      disposeObject(p.mesh);
      return false;
    });
    this.env?.update?.(t, dt);

    this.renderer.render(this.scene, this.camera);
  }
}
