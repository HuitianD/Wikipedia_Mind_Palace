// Palace settings: each one is a different building, not a recoloured box.
// A setting builds its own architecture and lights and tells the room where the
// stops are, which way each stop faces, where the visitor enters and where they
// may walk. The path through the stops has a different shape in each building
// (a ring, a U, a weave), so the route itself is a spatial memory cue.
//
// build() returns:
//   group     THREE.Group with all meshes and lights
//   stops     up to 8 × { pos: Vector3, view: Vector3 (unit, towards the viewer), maxDist? }
//   entrance  where the visitor stands on entering
//   overview  { pos, look } camera pose that shows the whole room
//   clamp(p)  keeps a walking position inside the building
//   path?(a, b, k, out) camera route between two points, when a straight line would hit something
//   update?(t) per-frame animation
import * as THREE from 'three';

const PI = Math.PI;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
const glowing = (color) => new THREE.MeshBasicMaterial({ color });

function put(g, geo, material, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
  if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
  m.castShadow = !!o.cast;
  m.receiveShadow = o.receive ?? true;
  g.add(m);
  return m;
}
const box = (g, w, h, d, m, x, y, z, o) => put(g, new THREE.BoxGeometry(w, h, d), m, x, y, z, o);
const cyl = (g, rt, rb, h, m, x, y, z, o, seg = 20) => put(g, new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z, o);
const plane = (g, w, h, m, x, y, z, o) => put(g, new THREE.PlaneGeometry(w, h), m, x, y, z, o);
const FLOOR = [-PI / 2, 0, 0];
const CEIL = [PI / 2, 0, 0];

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function tiled(tex, rx, ry) {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

function sun(g, color, intensity, from, reach = 12) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.copy(from);
  l.castShadow = true;
  l.shadow.mapSize.set(2048, 2048);
  Object.assign(l.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 40 });
  l.shadow.bias = -0.0006;
  g.add(l, l.target);
  return l;
}

const stop = (x, z, vx, vz, extra = {}) => ({ pos: V(x, extra.y || 0, z), view: V(vx, 0, vz).normalize(), ...extra });
const rectClamp = (x0, x1, z0, z1) => (p) => {
  p.x = THREE.MathUtils.clamp(p.x, x0, x1);
  p.z = THREE.MathUtils.clamp(p.z, z0, z1);
};

// ---- textures ---------------------------------------------------------------------

/** A wall of book spines on shelves; one tile is about 2.5 m square. */
function bookTexture() {
  return canvasTexture(512, 512, (c, w, h) => {
    const r = rng(42);
    const spines = ['#7a2e2e', '#8c3b2a', '#2f4f6b', '#3e5f46', '#6d5a3a', '#4a3350', '#a8813c', '#2b2b33', '#c9b88f', '#5a2a2a', '#365a6b'];
    c.fillStyle = '#2e1c11';
    c.fillRect(0, 0, w, h);
    const rows = 6;
    const rh = h / rows;
    for (let row = 0; row < rows; row++) {
      const base = (row + 1) * rh - 8;
      let x = 3;
      while (x < w - 6) {
        const bw = 9 + Math.floor(r() * 15);
        const bh = rh * (0.62 + r() * 0.22);
        if (r() > 0.06) {
          c.fillStyle = spines[Math.floor(r() * spines.length)];
          c.fillRect(x, base - bh, bw - 1, bh);
          if (r() > 0.55) {
            c.fillStyle = 'rgba(226,190,110,.75)';
            c.fillRect(x + 1, base - bh * (0.75 + r() * 0.1), bw - 3, 2);
            if (r() > 0.5) c.fillRect(x + 1, base - bh * 0.25, bw - 3, 2);
          }
          c.fillStyle = 'rgba(0,0,0,.22)';
          c.fillRect(x + bw - 2, base - bh, 1, bh);
        }
        x += bw;
      }
      c.fillStyle = '#5b3a24';
      c.fillRect(0, base, w, 8);
      c.fillStyle = 'rgba(0,0,0,.35)';
      c.fillRect(0, base + 8, w, 3);
    }
  });
}

function plankTexture() {
  return canvasTexture(256, 256, (c, w, h) => {
    const r = rng(7);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const shade = 96 + Math.floor(r() * 26);
      c.fillStyle = `rgb(${shade + 34},${shade - 6},${shade - 42})`;
      c.fillRect((i * w) / n, 0, w / n, h);
      c.fillStyle = 'rgba(40,22,10,.55)';
      c.fillRect((i * w) / n, 0, 2, h);
      c.fillRect((i * w) / n, Math.floor(r() * h), w / n, 2);
    }
  });
}

function marbleTexture() {
  return canvasTexture(256, 256, (c, w, h) => {
    const r = rng(19);
    const cols = ['#eee9df', '#c9c1b2'];
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        c.fillStyle = cols[(i + j) % 2];
        c.fillRect((i * w) / 2, (j * h) / 2, w / 2, h / 2);
      }
    }
    c.strokeStyle = 'rgba(120,112,100,.22)';
    c.lineWidth = 1.2;
    for (let k = 0; k < 14; k++) {
      c.beginPath();
      let x = r() * w;
      let y = r() * h;
      c.moveTo(x, y);
      for (let s = 0; s < 5; s++) { x += (r() - 0.5) * 70; y += (r() - 0.3) * 50; c.lineTo(x, y); }
      c.stroke();
    }
    c.strokeStyle = 'rgba(90,84,74,.5)';
    c.lineWidth = 2;
    c.strokeRect(0, 0, w / 2, h / 2);
    c.strokeRect(w / 2, h / 2, w / 2, h / 2);
  });
}

function paintingTexture(seed) {
  return canvasTexture(256, 180, (c, w, h) => {
    const r = rng(seed);
    const skies = [['#f2c078', '#e07a5f'], ['#9ec5e8', '#e9f1f7'], ['#3d405b', '#8187a6'], ['#f4e3b2', '#a8c686']];
    const [a, b] = skies[seed % skies.length];
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, a);
    sky.addColorStop(1, b);
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,244,210,.9)';
    c.beginPath();
    c.arc(40 + r() * 170, 30 + r() * 40, 16, 0, PI * 2);
    c.fill();
    ['#5b7553', '#3f5a45', '#2c3f33'].forEach((col, i) => {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(0, h);
      for (let x = 0; x <= w; x += 32) c.lineTo(x, h * (0.55 + i * 0.13) + Math.sin(x * 0.03 + r() * 6) * 14);
      c.lineTo(w, h);
      c.fill();
    });
  });
}

function starChartTexture(seed) {
  return canvasTexture(256, 190, (c, w, h) => {
    const r = rng(seed);
    c.fillStyle = '#101a3a';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(160,185,255,.25)';
    for (let k = 1; k < 4; k++) { c.beginPath(); c.arc(w / 2, h / 2, k * 30, 0, PI * 2); c.stroke(); }
    c.strokeStyle = 'rgba(200,170,100,.7)';
    c.fillStyle = '#f4f0dc';
    for (let k = 0; k < 5; k++) {
      let x = 30 + r() * (w - 60);
      let y = 25 + r() * (h - 50);
      c.beginPath();
      c.moveTo(x, y);
      for (let s = 0; s < 4; s++) {
        c.fillRect(x - 2, y - 2, 4, 4);
        x += (r() - 0.5) * 60;
        y += (r() - 0.5) * 50;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  });
}

function framed(g, tex, w, h, x, y, z, ry, frameMat) {
  const f = new THREE.Group();
  box(f, w + 0.18, h + 0.18, 0.06, frameMat, 0, 0, 0, { cast: true });
  plane(f, w, h, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), 0, 0, 0.035);
  f.position.set(x, y, z);
  f.rotation.y = ry;
  g.add(f);
}

// ---- 1. Observatory: a ring under a dome --------------------------------------------

function observatory() {
  const g = new THREE.Group();
  const R = 7.8;
  const H = 4.2;
  const stoneDark = std('#2a3358');
  const brass = std('#b8924a', { metalness: 0.6, roughness: 0.4 });
  const iron = std('#3a4058', { metalness: 0.4, roughness: 0.6 });

  // floor with brass inlay: rings and radial lines, like a sky map
  put(g, new THREE.CircleGeometry(R, 64), std('#2e3449', { roughness: 0.55 }), 0, 0, 0, { r: FLOOR });
  const inlay = std('#9c8450', { metalness: 0.5, roughness: 0.45 });
  for (const r of [1.7, 3.5, 6.7]) put(g, new THREE.RingGeometry(r, r + 0.06, 64), inlay, 0, 0.004, 0, { r: FLOOR });
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * PI * 2;
    plane(g, 0.035, 5.0, inlay, Math.sin(a) * 4.2, 0.004, Math.cos(a) * 4.2, { r: [-PI / 2, 0, a] });
  }

  // drum wall, pilasters, cornice
  put(g, new THREE.CylinderGeometry(R, R, H, 64, 1, true), std('#3d4873', { side: THREE.BackSide }), 0, H / 2, 0);
  put(g, new THREE.TorusGeometry(R - 0.12, 0.16, 8, 64), stoneDark, 0, H, 0, { r: [PI / 2, 0, 0] });
  put(g, new THREE.TorusGeometry(R - 0.08, 0.1, 8, 64), stoneDark, 0, 0.1, 0, { r: [PI / 2, 0, 0] });
  const lamp = glowing('#ffd9a0');
  for (let k = 0; k < 16; k++) {
    const a = ((k + 0.5) / 16) * PI * 2;
    const [sx, cz] = [-Math.sin(a), Math.cos(a)];
    box(g, 0.5, H, 0.22, stoneDark, sx * (R - 0.1), H / 2, cz * (R - 0.1), { r: [0, PI - a, 0] });
    put(g, new THREE.SphereGeometry(0.09, 10, 8), lamp, sx * (R - 0.36), 2.95, cz * (R - 0.36));
    box(g, 0.05, 0.05, 0.3, brass, sx * (R - 0.25), 2.86, cz * (R - 0.25), { r: [0, PI - a, 0] });
  }

  // dome with an open slit towards the back, and a planetarium of painted stars
  const SLIT = 0.25;
  const dome = new THREE.Group();
  dome.position.y = H;
  dome.scale.y = 0.85;
  g.add(dome);
  put(dome, new THREE.SphereGeometry(R, 48, 16, 1.5 * PI + SLIT, 2 * PI - 2 * SLIT, 0, PI / 2), std('#182042', { side: THREE.BackSide, roughness: 1 }));
  for (const phi of [1.5 * PI - SLIT, 1.5 * PI + SLIT]) {
    const [dx, dz] = [-Math.cos(phi), Math.sin(phi)];
    put(dome, new THREE.TorusGeometry(R - 0.06, 0.1, 6, 24, PI / 2), brass, 0, 0, 0, { r: [0, Math.atan2(-dz, dx), 0] });
  }
  const onDome = (theta, phi, r = R - 0.18) => V(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
  const rand = rng(77);
  const small = [];
  for (let i = 0; i < 420; i++) small.push(onDome(0.08 + rand() * 1.42, rand() * PI * 2));
  dome.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(small), new THREE.PointsMaterial({ color: '#c9d6ff', size: 0.05, sizeAttenuation: true })));
  const bright = [];
  const lines = [];
  for (let c = 0; c < 14; c++) {
    let theta = 0.25 + rand() * 1.05;
    let phi = rand() * PI * 2;
    if (Math.abs(phi - 1.5 * PI) < SLIT + 0.3) phi += 0.9;
    let prev = onDome(theta, phi);
    bright.push(prev);
    const n = 3 + Math.floor(rand() * 3);
    for (let s = 0; s < n; s++) {
      theta = THREE.MathUtils.clamp(theta + (rand() - 0.5) * 0.3, 0.15, 1.4);
      phi += (rand() - 0.5) * 0.36;
      const p = onDome(theta, phi);
      lines.push(prev, p);
      bright.push(p);
      prev = p;
    }
  }
  dome.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(bright), new THREE.PointsMaterial({ color: '#fff6d8', size: 0.13, sizeAttenuation: true })));
  dome.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), new THREE.LineBasicMaterial({ color: '#7f95d6', transparent: true, opacity: 0.55 })));

  // the real sky through the slit
  const sky = [];
  for (let i = 0; i < 700; i++) {
    const d = V(rand() - 0.5, rand() * 0.9 + 0.05, rand() - 0.5).normalize().multiplyScalar(45);
    sky.push(d);
  }
  g.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(sky), new THREE.PointsMaterial({ color: '#ffffff', size: 0.28, sizeAttenuation: true })));
  put(g, new THREE.SphereGeometry(1.7, 24, 16), glowing('#f3efd8'), 0, 25, -19, { receive: false });

  // landmark: the great telescope on its pier, aimed out through the slit
  cyl(g, 1.25, 1.3, 0.2, std('#3a4160', { roughness: 0.6 }), 0, 0.1, 0, {}, 40);
  cyl(g, 0.42, 0.56, 1.9, iron, 0, 1.15, 0, { cast: true });
  box(g, 0.12, 0.9, 0.5, iron, -0.44, 2.3, 0, { cast: true });
  box(g, 0.12, 0.9, 0.5, iron, 0.44, 2.3, 0, { cast: true });
  cyl(g, 0.07, 0.07, 1.0, brass, 0, 2.3, 0, { r: [0, 0, PI / 2] });
  const tel = new THREE.Group();
  tel.position.set(0, 2.3, 0);
  tel.rotation.x = -(PI / 2 - 0.9);
  g.add(tel);
  cyl(tel, 0.3, 0.3, 4.4, std('#e9e6dc', { roughness: 0.45 }), 0, 0.9, 0, { cast: true }, 24);
  for (const y of [-1.1, 0.9, 2.9]) put(tel, new THREE.TorusGeometry(0.31, 0.035, 8, 28), brass, 0, y, 0, { r: [PI / 2, 0, 0] });
  cyl(tel, 0.34, 0.34, 0.3, std('#20242f'), 0, 3.05, 0, { cast: true }, 24);
  cyl(tel, 0.09, 0.07, 0.5, brass, 0, -1.55, 0);
  cyl(tel, 0.07, 0.07, 1.3, brass, 0.4, 0.5, 0);

  // arched alcove behind every stop, and the door
  const alcove = std('#2b3560');
  const stops = [];
  for (let i = 0; i < 8; i++) {
    const a = THREE.MathUtils.degToRad(38 + i * (284 / 7));
    const [sx, cz] = [-Math.sin(a), Math.cos(a)];
    const niche = new THREE.Group();
    niche.position.set(sx * (R - 0.14), 0, cz * (R - 0.14));
    niche.rotation.y = PI - a;
    g.add(niche);
    plane(niche, 2.0, 2.3, alcove, 0, 1.15, 0);
    put(niche, new THREE.CircleGeometry(1.0, 24, 0, PI), alcove, 0, 2.3, 0);
    put(niche, new THREE.TorusGeometry(1.0, 0.05, 6, 24, PI), brass, 0, 2.3, 0.02);
    stops.push(stop(sx * 5.3, cz * 5.3, -sx, -cz, { maxDist: 3.8 }));
  }
  box(g, 1.7, 2.8, 0.14, std('#3a2a1e'), 0, 1.4, R - 0.1);
  put(g, new THREE.TorusGeometry(0.85, 0.07, 6, 24, PI), brass, 0, 2.8, R - 0.16);
  for (const [k, side] of [[0, -1], [1, 1]]) {
    const a = side * THREE.MathUtils.degToRad(17);
    framed(g, starChartTexture(5 + k), 1.3, 0.95, -Math.sin(a) * (R - 0.2), 2.3, Math.cos(a) * (R - 0.2), PI - a, brass);
  }

  // moonlight through the slit, warm lamps around the wall
  g.add(new THREE.HemisphereLight('#b4c2f2', '#2a2d3a', 1.35));
  sun(g, '#d3deff', 1.9, V(1.5, 11, -7));
  for (const deg of [60, 180, 300]) {
    const a = THREE.MathUtils.degToRad(deg);
    const p = new THREE.PointLight('#ffcf96', 34, 15, 1.5);
    p.position.set(-Math.sin(a) * 4.6, 3.3, Math.cos(a) * 4.6);
    g.add(p);
  }

  return {
    group: g,
    stops,
    entrance: V(0, 0, 6.3),
    overview: { pos: V(0, 3.7, 6.9), look: V(0, 1.1, -1) },
    clamp(p) {
      const r = Math.hypot(p.x, p.z) || 0.001;
      const k = r > R - 0.8 ? (R - 0.8) / r : r < 1.7 ? 1.7 / r : 1;
      p.x *= k;
      p.z *= k;
    },
    // camera flights circle the telescope instead of cutting through it
    path(a, b, k, out) {
      const ra = Math.hypot(a.x, a.z);
      const rb = Math.hypot(b.x, b.z);
      const ta = Math.atan2(a.x, a.z);
      let d = Math.atan2(b.x, b.z) - ta;
      d = ((d + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI;
      const r = Math.max(THREE.MathUtils.lerp(ra, rb, k), Math.min(ra, rb, 1.9));
      return out.set(Math.sin(ta + d * k) * r, THREE.MathUtils.lerp(a.y, b.y, k), Math.cos(ta + d * k) * r);
    },
  };
}

// ---- 2. Grand Library: a U-shaped walk past book alcoves ---------------------------------

function library() {
  const g = new THREE.Group();
  const W = 6;
  const Z0 = -8;
  const Z1 = 8;
  const H = 6.2;
  const BAL = 3.1;
  const wood = std('#6b4428');
  const dark = std('#3d2617');
  const brass = std('#c8a046', { metalness: 0.6, roughness: 0.4 });
  const books = bookTexture();
  const bookMat = (rx, ry) => new THREE.MeshStandardMaterial({ map: tiled(books, rx, ry), roughness: 0.9 });

  plane(g, W * 2, Z1 - Z0, new THREE.MeshStandardMaterial({ map: tiled(plankTexture(), 5, 6), roughness: 0.6 }), 0, 0, 0, { r: FLOOR });
  plane(g, 2.4, 13.6, std('#7a2e2e', { roughness: 1 }), 0, 0.006, -0.2, { r: FLOOR });
  for (const x of [-1.05, 1.05]) plane(g, 0.07, 13.4, std('#c8a046'), x, 0.008, -0.2, { r: FLOOR });

  // coffered ceiling
  plane(g, W * 2, Z1 - Z0, dark, 0, H, 0, { r: CEIL });
  for (const z of [-6, -3, 0, 3, 6]) box(g, W * 2, 0.3, 0.28, wood, 0, H - 0.15, z);
  for (const x of [-2, 2]) box(g, 0.28, 0.3, Z1 - Z0, wood, x, H - 0.15, 0);

  // book walls, two storeys high
  for (const side of [-1, 1]) {
    plane(g, Z1 - Z0, H, bookMat(6.4, 2.48), side * W, H / 2, 0, { r: [0, -side * PI / 2, 0] });
    // gallery with a railing
    box(g, 1.1, 0.16, Z1 - Z0, wood, side * (W - 0.55), BAL, 0, { cast: true });
    box(g, 0.07, 0.07, Z1 - Z0, brass, side * (W - 1.08), BAL + 0.98, 0);
    for (let z = Z0 + 0.4; z < Z1; z += 0.8) box(g, 0.045, 0.9, 0.045, dark, side * (W - 1.08), BAL + 0.53, z);
    // bookcases that jut out and split the wall into alcoves
    for (const z of [6.75, 2.25, -2.25, -6.75]) {
      const face = bookMat(0.44, 1.2);
      box(g, 1.1, BAL - 0.08, 0.45, [wood, wood, wood, wood, face, face], side * (W - 0.55), (BAL - 0.08) / 2, z, { cast: true });
      box(g, 0.2, BAL - 0.08, 0.55, dark, side * (W - 1.12), (BAL - 0.08) / 2, z, { cast: true });
    }
  }
  plane(g, W * 2, H, bookMat(4.8, 2.48), 0, H / 2, Z0);
  plane(g, W * 2, H, std('#5b3a24'), 0, H / 2, Z1, { r: [0, PI, 0] });
  box(g, 1.6, 2.7, 0.1, dark, 0, 1.35, Z1 - 0.06);
  box(g, 1.9, 0.16, 0.14, wood, 0, 2.78, Z1 - 0.08);

  // landmark: the tall arched window at the far end
  const glass = glowing('#ffe6b8');
  plane(g, 2.6, 3.0, glass, 0, 2.7, Z0 + 0.04, { receive: false });
  put(g, new THREE.CircleGeometry(1.3, 28, 0, PI), glass, 0, 4.2, Z0 + 0.04, { receive: false });
  put(g, new THREE.TorusGeometry(1.34, 0.09, 6, 28, PI), dark, 0, 4.2, Z0 + 0.08);
  for (const x of [-1.34, 1.34]) box(g, 0.14, 3.0, 0.12, dark, x, 2.7, Z0 + 0.08);
  for (const x of [-0.43, 0.43]) box(g, 0.05, 4.1, 0.06, dark, x, 3.25, Z0 + 0.07);
  for (const y of [2.2, 3.2, 4.2]) box(g, 2.6, 0.05, 0.06, dark, 0, y, Z0 + 0.07);
  box(g, 3.0, 0.14, 0.3, wood, 0, 1.15, Z0 + 0.15);

  // reading tables with green lamps, between the stops
  const shade = new THREE.MeshStandardMaterial({ color: '#2f7a4f', emissive: '#3fa060', emissiveIntensity: 0.7, roughness: 0.4 });
  for (const zc of [2.25, -2.25]) {
    box(g, 1.2, 0.08, 2.3, wood, 0, 0.8, zc, { cast: true });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.09, 0.78, 0.09, dark, sx * 0.5, 0.39, zc + sz * 1.05, { cast: true });
    for (const dz of [-0.6, 0.6]) {
      cyl(g, 0.09, 0.11, 0.03, brass, 0, 0.855, zc + dz, {}, 12);
      cyl(g, 0.018, 0.018, 0.34, brass, 0, 1.02, zc + dz, {}, 8);
      box(g, 0.34, 0.1, 0.16, shade, 0, 1.22, zc + dz);
    }
    box(g, 0.34, 0.05, 0.26, std('#8c3b2a'), 0.3, 0.865, zc, { r: [0, 0.3, 0] });
    box(g, 0.3, 0.04, 0.24, std('#2f4f6b'), 0.3, 0.91, zc, { r: [0, -0.2, 0] });
  }

  // ladders against the shelves
  for (const [side, z] of [[-1, 7.35], [1, -7.35]]) {
    const ladder = new THREE.Group();
    ladder.position.set(side * (W - 0.95), 0, z);
    ladder.rotation.z = side * -0.26;
    g.add(ladder);
    for (const dz of [-0.22, 0.22]) box(ladder, 0.05, 3.0, 0.05, wood, 0, 1.5, dz, { cast: true });
    for (let y = 0.3; y < 2.9; y += 0.32) box(ladder, 0.035, 0.035, 0.44, wood, 0, y, 0);
  }

  // chandeliers
  const bulb = glowing('#ffe2a8');
  for (const z of [3.3, -3.3]) {
    cyl(g, 0.015, 0.015, H - 4.8, dark, 0, (H + 4.8) / 2, z, {}, 6);
    put(g, new THREE.TorusGeometry(0.75, 0.04, 8, 32), brass, 0, 4.8, z, { r: [PI / 2, 0, 0] });
    for (let k = 0; k < 8; k++) put(g, new THREE.SphereGeometry(0.07, 10, 8), bulb, Math.cos((k / 8) * PI * 2) * 0.75, 4.9, z + Math.sin((k / 8) * PI * 2) * 0.75);
    const p = new THREE.PointLight('#ffd9a0', 34, 16, 1.6);
    p.position.set(0, 4.5, z);
    g.add(p);
  }
  g.add(new THREE.HemisphereLight('#ffe6c4', '#3a2a1c', 1.05));
  sun(g, '#ffe2b8', 1.25, V(2.5, 10, -5));
  const fill = new THREE.DirectionalLight('#ffe9cf', 0.5);
  fill.position.set(-2, 5, 9);
  g.add(fill);

  return {
    group: g,
    stops: [
      stop(-3.9, 4.5, 1, 0), stop(-3.9, 0, 1, 0), stop(-3.9, -4.5, 1, 0),
      stop(-2.3, -6.2, 0, 1), stop(2.3, -6.2, 0, 1),
      stop(3.9, -4.5, -1, 0), stop(3.9, 0, -1, 0), stop(3.9, 4.5, -1, 0),
    ],
    entrance: V(0, 0, 6.8),
    overview: { pos: V(0, 4.6, 7.4), look: V(0, 1.1, -2.5) },
    clamp: rectClamp(-4.6, 4.6, -7.3, 7.4),
  };
}

// ---- 3. Museum Gallery: weaving between exhibits on both walls ------------------------------

function museum() {
  const g = new THREE.Group();
  const W = 6;
  const Z0 = -8.6;
  const Z1 = 8;
  const L = Z1 - Z0;
  const ZC = (Z0 + Z1) / 2;
  const H = 5.6;
  const marble = std('#f1ede5', { roughness: 0.5 });
  const wall = std('#ddd3c1');
  const trim = std('#c7bcaa');
  const recess = std('#8c9faa');
  const gold = std('#b8924a', { metalness: 0.6, roughness: 0.4 });

  plane(g, W * 2, L, new THREE.MeshStandardMaterial({ map: tiled(marbleTexture(), 7.5, L / 1.6), roughness: 0.35 }), 0, 0, ZC, { r: FLOOR });
  plane(g, W * 2, L, std('#f3efe8'), 0, H, ZC, { r: CEIL });

  // long skylight
  plane(g, 3.6, 13, glowing('#f6fbff'), 0, H - 0.02, ZC, { r: CEIL, receive: false });
  for (let z = ZC - 6.5; z <= ZC + 6.5; z += 1.625) box(g, 3.7, 0.1, 0.07, trim, 0, H - 0.05, z);
  for (const x of [-1.85, 0, 1.85]) box(g, 0.07, 0.1, 13, trim, x, H - 0.05, ZC);

  plane(g, W * 2, H, wall, 0, H / 2, Z0);
  plane(g, W * 2, H, wall, 0, H / 2, Z1, { r: [0, PI, 0] });
  const stops = [];
  for (const side of [-1, 1]) {
    plane(g, L, H, wall, side * W, H / 2, ZC, { r: [0, -side * PI / 2, 0] });
    box(g, 0.08, 0.2, L, trim, side * (W - 0.04), 0.1, ZC);
    box(g, 0.1, 0.12, L, trim, side * (W - 0.05), 1.05, ZC);
    box(g, 0.9, 0.5, L, trim, side * (W - 0.45), 4.95, ZC, { cast: true });
    for (const z of [6.6, 3.4, 0.2, -3.0, -6.2]) {
      box(g, 0.74, 0.26, 0.74, marble, side * 5.55, 0.13, z);
      cyl(g, 0.26, 0.3, 4.2, marble, side * 5.55, 2.36, z, { cast: true }, 18);
      box(g, 0.74, 0.26, 0.74, marble, side * 5.55, 4.59, z);
    }
    // an arched niche and a low plinth in every bay
    for (const z of [5.0, 1.8, -1.4, -4.6]) {
      const niche = new THREE.Group();
      niche.position.set(side * (W - 0.03), 0, z);
      niche.rotation.y = -side * PI / 2;
      g.add(niche);
      plane(niche, 2.2, 2.3, recess, 0, 1.15 + 1.05, 0);
      put(niche, new THREE.CircleGeometry(1.1, 24, 0, PI), recess, 0, 3.35, 0);
      put(niche, new THREE.TorusGeometry(1.1, 0.05, 6, 24, PI), trim, 0, 3.35, 0.02);
      cyl(g, 1.05, 1.1, 0.1, marble, side * 3.6, 0.05, z, {}, 36);
    }
  }
  // weave: left, right, left, right … down the hall
  for (const z of [5.0, 1.8, -1.4, -4.6]) {
    stops.push(stop(-3.6, z, 1, 0, { y: 0.1 }), stop(3.6, z, -1, 0, { y: 0.1 }));
  }

  // landmark at the far end: a statue under a pediment
  for (const x of [-1.6, 1.6]) {
    box(g, 0.6, 0.22, 0.6, marble, x, 0.11, Z0 + 0.5);
    cyl(g, 0.22, 0.25, 3.5, marble, x, 1.97, Z0 + 0.5, { cast: true }, 18);
    box(g, 0.6, 0.22, 0.6, marble, x, 3.83, Z0 + 0.5);
  }
  box(g, 4.2, 0.3, 0.8, marble, 0, 4.09, Z0 + 0.5, { cast: true });
  cyl(g, 2.3, 2.3, 0.7, marble, 0, 4.63, Z0 + 0.5, { r: [-PI / 2, 0, 0], s: [1, 1, 0.34], cast: true }, 3);
  plane(g, 2.6, 3.7, recess, 0, 1.85, Z0 + 0.03);
  box(g, 1.3, 0.9, 1.3, marble, 0, 0.45, Z0 + 1.3, { cast: true });
  const bronze = std('#6f5a3a', { metalness: 0.55, roughness: 0.45 });
  put(g, new THREE.ConeGeometry(0.46, 1.5, 14), bronze, 0, 1.65, Z0 + 1.3, { cast: true });
  box(g, 0.62, 0.2, 0.3, bronze, 0, 2.3, Z0 + 1.3, { cast: true });
  put(g, new THREE.SphereGeometry(0.19, 16, 12), bronze, 0, 2.6, Z0 + 1.3, { cast: true });
  cyl(g, 0.06, 0.07, 0.8, bronze, 0.38, 2.62, Z0 + 1.3, { r: [0, 0, -0.5], cast: true }, 10);
  put(g, new THREE.SphereGeometry(0.1, 12, 10), glowing('#ffd27a'), 0.6, 3.02, Z0 + 1.3, { receive: false });
  for (const x of [-1.2, 1.2]) {
    cyl(g, 0.14, 0.16, 0.04, gold, x, 0.02, Z0 + 2.5, {}, 14);
    cyl(g, 0.03, 0.03, 0.9, gold, x, 0.47, Z0 + 2.5, {}, 10);
    put(g, new THREE.SphereGeometry(0.06, 10, 8), gold, x, 0.95, Z0 + 2.5);
  }
  cyl(g, 0.025, 0.025, 2.4, std('#8c2f39'), 0, 0.82, Z0 + 2.5, { r: [0, 0, PI / 2] }, 8);

  // entrance wall: doors and two paintings
  box(g, 2.0, 3.0, 0.1, std('#4a3322'), 0, 1.5, Z1 - 0.06);
  box(g, 2.4, 0.2, 0.16, trim, 0, 3.1, Z1 - 0.09);
  framed(g, paintingTexture(1), 1.9, 1.3, -3.6, 2.5, Z1 - 0.06, PI, gold);
  framed(g, paintingTexture(2), 1.9, 1.3, 3.6, 2.5, Z1 - 0.06, PI, gold);

  g.add(new THREE.HemisphereLight('#ffffff', '#bdb5a6', 1.25));
  sun(g, '#fff8ec', 1.7, V(4, 11, 3));

  return {
    group: g,
    stops,
    entrance: V(0, 0, 6.9),
    overview: { pos: V(0, 4.3, 7.5), look: V(0, 0.8, -2.5) },
    clamp: rectClamp(-5.0, 5.0, -5.9, 7.4),
  };
}

// ---- plain floor for gallery.html (not a palace setting) -------------------------------------

function studio() {
  const g = new THREE.Group();
  plane(g, 18, 16, std('#d9d4ca'), 0, 0, 0, { r: FLOOR });
  g.add(new THREE.HemisphereLight('#ffffff', '#b8b0a0', 1.3));
  sun(g, '#ffffff', 1.4, V(-4, 10, 5));
  return {
    group: g,
    stops: Array.from({ length: 8 }, (_, i) => stop(-7 + i * 2, -6, 0, 1)),
    entrance: V(0, 0, 7),
    overview: { pos: V(0, 5, 8), look: V(0, 0, 0) },
    clamp: rectClamp(-8.5, 8.5, -7.5, 9),
  };
}

export const SETTINGS = { observatory, library, museum, studio };

/** Free the GPU memory of a setting that is being replaced. */
export function disposeSetting(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) {
      m.map?.dispose();
      m.dispose();
    }
    o.dispose?.();
  });
}
