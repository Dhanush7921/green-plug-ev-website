import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/*
 * CCS2 (Combined Charging System, "Combo 2") geometry, the DC fast-charging standard used by most
 * newer electric cars sold in India. Real-world scale in metres.
 *
 * Connector local frame: +Z = mating direction (the face points along +Z), +Y = up.
 * Inlet (car) local frame: +Z = outward surface normal of the car body, +Y = up.
 * When mated, connector +Z = -inlet Z and the connector's housing front sits on the inlet collar.
 */

const AC_R = 0.031; // Type 2 upper section radius
const AC_FLAT = 0.022; // height of the flat top chord
const DC_Y = -0.047; // centre of the DC pin section
const DC_W = 0.062;
const DC_H = 0.03;
export const COLLAR_DEPTH = 0.042; // how far the inlet collar stands proud of the body
export const FACE_PROTRUSION = 0.034; // how far the connector face pushes into the collar

function typeTwoOutline(shape: THREE.Shape | THREE.Path, grow = 0) {
  const r = AC_R + grow;
  const flat = AC_FLAT + grow * 0.6;
  const a0 = Math.asin(Math.min(0.999, flat / r));
  const x0 = Math.cos(a0) * r;
  shape.moveTo(-x0, flat);
  shape.lineTo(x0, flat);
  shape.absarc(0, 0, r, a0, Math.PI - a0, true);
}

function roundRect(shape: THREE.Shape | THREE.Path, cx: number, cy: number, w: number, h: number, r: number) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
}

function circle(r: number, x: number, y: number) {
  const p = new THREE.Path();
  p.absarc(x, y, r, 0, Math.PI * 2, false);
  return p;
}

const AC_PINS: [number, number, number][] = [
  [-0.0105, 0.0125, 0.0035], // proximity pilot
  [0.0105, 0.0125, 0.0035], // control pilot
  [-0.019, -0.0015, 0.0052],
  [0.019, -0.0015, 0.0052],
  [0, -0.0005, 0.0052],
  [-0.0115, -0.0185, 0.0052],
  [0.0115, -0.0185, 0.0052],
];
const DC_PINS: [number, number, number][] = [
  [-0.0165, DC_Y, 0.0082],
  [0.0165, DC_Y, 0.0082],
];

export type ConnectorMats = { body: THREE.Material; insert: THREE.Material; accent: THREE.Material; metal: THREE.Material };

export function createConnectorMaterials() {
  return {
    body: new THREE.MeshPhysicalMaterial({ color: '#111816', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    insert: new THREE.MeshStandardMaterial({ color: '#070b0a', roughness: 0.6 }),
    accent: new THREE.MeshStandardMaterial({ color: '#8EB69B', roughness: 0.35, emissive: '#8EB69B', emissiveIntensity: 0.15 }),
    metal: new THREE.MeshStandardMaterial({ color: '#c9d2cd', metalness: 1, roughness: 0.28 }),
  };
}

/** The charging handle. Returns the group and the local point where the cable leaves the boot. */
export function createConnector(m: ConnectorMats) {
  const group = new THREE.Group();
  group.name = 'CCS2Connector';

  // face inserts that slide into the inlet collar (z: 0 .. FACE_PROTRUSION)
  const ac = new THREE.Shape();
  typeTwoOutline(ac);
  AC_PINS.forEach(([x, y, r]) => ac.holes.push(circle(r, x, y)));
  const acMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(ac, { depth: FACE_PROTRUSION, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 2, curveSegments: 32 }), m.insert);
  group.add(acMesh);
  const dc = new THREE.Shape();
  roundRect(dc, 0, DC_Y, DC_W, DC_H, 0.013);
  DC_PINS.forEach(([x, y, r]) => dc.holes.push(circle(r, x, y)));
  const dcMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(dc, { depth: FACE_PROTRUSION, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 2, curveSegments: 24 }), m.insert);
  group.add(dcMesh);

  // housing behind the face (z: -0.085 .. 0)
  const housing = new THREE.Shape();
  roundRect(housing, 0, -0.018, 0.094, 0.128, 0.03);
  const hGeo = new THREE.ExtrudeGeometry(housing, { depth: 0.08, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 4, curveSegments: 16 });
  hGeo.translate(0, 0, -0.086);
  const hMesh = new THREE.Mesh(hGeo, m.body);
  group.add(hMesh);
  // brand accent ring around the housing
  const ring = new THREE.Mesh(new RoundedBoxGeometry(0.104, 0.138, 0.008, 3, 0.004), m.accent);
  ring.position.set(0, -0.018, -0.03);
  group.add(ring);

  // grip angled down and back, with a rubber boot where the cable leaves
  const gripPath = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.01, -0.07), new THREE.Vector3(0, -0.01, -0.13), new THREE.Vector3(0, -0.06, -0.2), new THREE.Vector3(0, -0.12, -0.245)]);
  const grip = new THREE.Mesh(new THREE.TubeGeometry(gripPath, 24, 0.024, 16, false), m.body);
  group.add(grip);
  const capA = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), m.body);
  capA.position.copy(gripPath.points[0]);
  group.add(capA);
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.013, 0.07, 16), m.insert);
  const bootEnd = gripPath.points[3].clone();
  const bootDir = gripPath.getTangent(1).normalize();
  boot.position.copy(bootEnd).addScaledVector(bootDir, 0.03);
  boot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bootDir.clone().negate());
  group.add(boot);

  // thumb latch on top
  const latch = new THREE.Mesh(new RoundedBoxGeometry(0.022, 0.012, 0.06, 2, 0.005), m.accent);
  latch.position.set(0, 0.052, -0.05);
  group.add(latch);

  const cableExit = bootEnd.clone().addScaledVector(bootDir, 0.065);
  group.traverse((o) => {
    o.castShadow = true;
  });
  return { group, latch, cableExit, cableDir: bootDir };
}

export type InletParts = { group: THREE.Group; door: THREE.Object3D; led: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> };

/** Car-side CCS2 inlet: collar, recessed socket face with pins, LED ring and a hinged door. */
export function createInlet(m: ConnectorMats, paint: THREE.Material): InletParts {
  const group = new THREE.Group();
  group.name = 'CCS2Inlet';

  // mounting plate flush with the body
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.19, 0.008, 3, 0.02), m.insert);
  plate.position.set(0, -0.02, 0.002);
  group.add(plate);

  // collar: outer housing outline with the two openings cut out
  const collar = new THREE.Shape();
  roundRect(collar, 0, -0.018, 0.104, 0.136, 0.032);
  const acHole = new THREE.Path();
  typeTwoOutline(acHole, 0.0025);
  const dcHole = new THREE.Path();
  roundRect(dcHole, 0, DC_Y, DC_W + 0.005, DC_H + 0.005, 0.015);
  collar.holes.push(acHole, dcHole);
  const collarGeo = new THREE.ExtrudeGeometry(collar, { depth: COLLAR_DEPTH, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 3, curveSegments: 32 });
  const collarMesh = new THREE.Mesh(collarGeo, m.body);
  group.add(collarMesh);

  // recessed socket face with pins pointing outwards
  const face = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.13, 0.006, 2, 0.02), m.insert);
  face.position.set(0, -0.018, 0.006);
  group.add(face);
  for (const [x, y, r] of [...AC_PINS, ...DC_PINS]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.018, 12), m.metal);
    pin.rotation.x = Math.PI / 2;
    pin.position.set(x, y, 0.016);
    group.add(pin);
  }

  // LED ring (status light) around the AC opening
  const ledMat = new THREE.MeshStandardMaterial({ color: '#1a2421', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.4 });
  const led = new THREE.Mesh(new THREE.TorusGeometry(AC_R + 0.0095, 0.0022, 8, 48, Math.PI * 1.25), ledMat);
  led.rotation.z = -Math.PI * 0.125;
  led.position.z = COLLAR_DEPTH + 0.0035;
  group.add(led);

  // hinged door (hinge on the +X edge), painted like the body
  const hinge = new THREE.Group();
  hinge.position.set(0.075, -0.02, COLLAR_DEPTH + 0.008);
  const door = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.19, 0.01, 3, 0.03), paint);
  door.position.set(-0.075, 0, 0);
  hinge.add(door);
  group.add(hinge);

  group.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return { group, door: hinge, led };
}

/** Holster cup on the charger that the connector rests in when not in use. */
export function createHolster(m: ConnectorMats) {
  const g = new THREE.Group();
  const cup = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.17, 0.07, 3, 0.03), m.insert);
  cup.position.set(0, -0.018, 0.035);
  g.add(cup);
  const lip = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.18, 0.012, 3, 0.03), m.accent);
  lip.position.set(0, -0.018, 0.072);
  g.add(lip);
  return g;
}
