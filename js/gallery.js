// gallery.html: every object in the kit, laid out in a grid with name labels.
// Handy for checking models after editing objects.js. Walk with W A S D, drag to look.
import * as THREE from 'three';
import { Room } from './room.js';
import { OBJECTS, buildObject } from './objects.js';

const room = new Room(document.querySelector('#scene'));
room.setTheme({ id: 'studio', accent: '#888888', bg: '#bfb9ad' });
room.mode = 'walk';

function label(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#222';
  g.font = '600 24px -apple-system, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  s.scale.set(0.9, 0.17, 1);
  return s;
}

const cols = 13;
const gap = 1.18;
OBJECTS.forEach((o, i) => {
  const obj = buildObject(o.id);
  if (obj.userData.faceX) obj.rotation.y = -Math.PI / 2;
  const x = (i % cols - (cols - 1) / 2) * gap;
  const z = (Math.floor(i / cols) - 4) * gap;
  obj.position.set(x, 0, z);
  obj.scale.setScalar(0.62);
  const l = label(o.name);
  l.position.set(x, 1.45, z + 0.3);
  room.scene.add(obj, l);
  // let room.js animate spins/floats as if each object sat in a slot
  room.slots.push({ pos: new THREE.Vector3(x, 0, z), group: obj, marker: { visible: false }, object: obj });
});
room.flyTo(new THREE.Vector3(0, 4.2, 6.6), new THREE.Vector3(0, 0, 0), 0.01);
document.querySelector('#count').textContent = `${OBJECTS.length} objects`;

// ?focus=<id> flies the camera to one object (handy for screenshots)
const focus = new URLSearchParams(location.search).get('focus');
if (focus) {
  const i = OBJECTS.findIndex((o) => o.id === focus);
  if (i >= 0) {
    const x = (i % cols - (cols - 1) / 2) * gap;
    const z = (Math.floor(i / cols) - 4) * gap;
    room.flyTo(new THREE.Vector3(x + 0.6, 1.2, z + 1.5), new THREE.Vector3(x, 0.5, z), 0.01);
  }
}
window.galleryRoom = room;
