import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function sculpt(shape: THREE.Shape, width: number, bevel: number, deform: (x: number, y: number) => number) {
  const depth = width - bevel * 2;
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 6, curveSegments: 28 });
  geo.translate(0, 0, -depth / 2);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * deform(p.getX(i), p.getY(i)));
  geo.computeVertexNormals();
  return geo;
}

function wheel(tire: THREE.Material, rim: THREE.Material, hub: THREE.Material, r: number, w: number) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.TorusGeometry(r - w * 0.36, w * 0.4, 18, 48), tire);
  t.scale.z = 1.35;
  g.add(t);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 0.7, 32), rim);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 0.09, w * 0.75), hub);
    const a = (i / 5) * Math.PI * 2;
    s.position.set(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, 0);
    s.rotation.z = a;
    g.add(s);
  }
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r * 0.42, 0.006, 32), rim);
  brake.rotation.x = Math.PI / 2;
  brake.position.z = w * 0.42;
  g.add(brake);
  return g;
}

/** Original procedural electric scooter (stylised, not a production model). Faces +X. */
export function createScooter(paint: THREE.MeshPhysicalMaterial) {
  const group = new THREE.Group();
  group.name = 'Scooter';
  const trim = new THREE.MeshStandardMaterial({ color: '#0e1816', roughness: 0.55, metalness: 0.2 });
  const seatMat = new THREE.MeshStandardMaterial({ color: '#163832', roughness: 0.75 });
  const tire = new THREE.MeshStandardMaterial({ color: '#0b1110', roughness: 0.9 });
  const rim = new THREE.MeshStandardMaterial({ color: '#b8c5be', metalness: 1, roughness: 0.3 });
  const light = new THREE.MeshBasicMaterial({ color: '#f2fff5', toneMapped: false });
  const wr = 0.25;

  const rear = new THREE.Shape();
  rear.moveTo(-0.18, 0.34);
  rear.lineTo(-0.18, 0.6);
  rear.bezierCurveTo(-0.3, 0.76, -0.64, 0.8, -0.88, 0.74);
  rear.bezierCurveTo(-1.0, 0.7, -1.02, 0.58, -0.95, 0.47);
  rear.bezierCurveTo(-0.85, 0.38, -0.7, 0.34, -0.5, 0.38);
  rear.lineTo(-0.18, 0.34);
  group.add(new THREE.Mesh(sculpt(rear, 0.42, 0.08, (_x, y) => 1 - 0.28 * smooth(0.55, 0.8, y)), paint));

  const floor = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.07, 0.36, 3, 0.03), trim);
  floor.position.set(0.1, 0.33, 0);
  group.add(floor);

  const apron = new THREE.Shape();
  apron.moveTo(0.36, 0.3);
  apron.lineTo(0.52, 0.3);
  apron.bezierCurveTo(0.64, 0.52, 0.68, 0.8, 0.63, 1.02);
  apron.lineTo(0.5, 1.06);
  apron.bezierCurveTo(0.47, 0.82, 0.43, 0.56, 0.36, 0.42);
  apron.lineTo(0.36, 0.3);
  group.add(new THREE.Mesh(sculpt(apron, 0.46, 0.08, (_x, y) => 1 - 0.2 * smooth(0.7, 1.06, y)), paint));

  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.64, 0.09, 0.3, 4, 0.04), seatMat);
  seat.position.set(-0.52, 0.8, 0);
  seat.rotation.z = 0.05;
  group.add(seat);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.62, 14), trim);
  col.position.set(0.6, 1.02, 0);
  col.rotation.z = 0.3;
  group.add(col);
  const head = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.13, 0.34, 4, 0.05), paint);
  head.position.set(0.55, 1.28, 0);
  group.add(head);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.68, 12), trim);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0.5, 1.31, 0);
  group.add(bar);
  for (const z of [-0.36, 0.36]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.11, 12), seatMat);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0.5, 1.31, z * 0.94);
    group.add(grip);
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.06, 0.1, 2, 0.02), trim);
    mirror.position.set(0.47, 1.47, z * 0.8);
    group.add(mirror);
  }
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.052, 24), light);
  lamp.rotation.y = Math.PI / 2;
  lamp.position.set(0.645, 1.27, 0);
  group.add(lamp);
  const drl = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.46, 0.05, 2, 0.012), light);
  drl.position.set(0.665, 0.74, 0);
  drl.rotation.z = -0.2;
  group.add(drl);
  const tail = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.05, 0.24, 2, 0.015), new THREE.MeshBasicMaterial({ color: '#8EB69B', toneMapped: false }));
  tail.position.set(-0.99, 0.62, 0);
  group.add(tail);
  const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.52, 10), rim);
  fork.position.set(0.65, 0.46, 0.06);
  fork.rotation.z = 0.3;
  group.add(fork);
  const fender = new THREE.Mesh(new THREE.TorusGeometry(wr + 0.045, 0.032, 10, 32, Math.PI * 0.72), paint);
  fender.position.set(0.66, wr, 0);
  fender.rotation.z = Math.PI * 0.22;
  fender.scale.z = 2.6;
  group.add(fender);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), trim);
  stand.position.set(-0.1, 0.16, 0.2);
  stand.rotation.x = -0.6;
  group.add(stand);

  // charging inlet on the right side (+Z) under the seat, with status LED
  const inlet = new THREE.Group();
  inlet.position.set(-0.6, 0.56, 0.205);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20), trim);
  ring.rotation.x = Math.PI / 2;
  inlet.add(ring);
  const ledMat = new THREE.MeshBasicMaterial({ color: '#2b3a36', toneMapped: false });
  const led = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.004, 6, 24), ledMat);
  led.position.z = 0.011;
  inlet.add(led);
  group.add(inlet);
  const inletPoint = new THREE.Object3D();
  inletPoint.position.set(-0.6, 0.56, 0.235);
  group.add(inletPoint);

  for (const x of [-0.66, 0.66]) {
    const w = wheel(tire, rim, trim, wr, 0.15);
    w.position.set(x, wr, 0);
    group.add(w);
  }
  group.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return { group, inletPoint, ledMat };
}
