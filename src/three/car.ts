import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createInlet, type ConnectorMats, type InletParts } from './connector';

export type CarRig = {
  group: THREE.Group;
  paint: THREE.MeshPhysicalMaterial;
  inlet: InletParts;
  /** Inlet frame in car space: origin on the body surface, +Z outward. */
  port: THREE.Object3D;
  wheels: THREE.Object3D[];
  /** Approximate body volume in car space, for keeping the cable outside the car. */
  bodyBox: THREE.Box3;
  realistic: boolean;
};

const PORT_Z_FROM_FRONT_WHEEL = -0.66; // behind the front wheel arch, ahead of the door
const PORT_HEIGHT = 0.74;

export async function loadCar(url: string, m: ConnectorMats, onProgress?: (p: number) => void): Promise<CarRig> {
  const gltf = await new GLTFLoader().loadAsync(url, (e) => {
    if (e.total) onProgress?.(e.loaded / e.total);
  });
  const root = gltf.scene;
  const paint = new THREE.MeshPhysicalMaterial({
    color: '#e8f3ec',
    metalness: 0.55,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  const accent = new THREE.MeshPhysicalMaterial({ color: '#163832', metalness: 0.4, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#0b2b26', metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.78, clearcoat: 1, envMapIntensity: 1.4 });
  const wheels: THREE.Object3D[] = [];

  root.traverse((o) => {
    if (/^Wheel(Front|Rear)(L|R)$/.test(o.name)) wheels.push(o);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const name = mat?.name || '';
    if (/^Paint 1/.test(name)) {
      // keep the original flake normal map for realism, recolour to the brand's pearl mint
      paint.normalMap = mat.normalMap;
      paint.normalScale = new THREE.Vector2(0.35, 0.35);
      paint.aoMap = mat.aoMap;
      mesh.material = paint;
    } else if (/^Paint 2/.test(name) || /^Interior 3/.test(name) || name === 'Brake') {
      mesh.material = accent;
    } else if (name === 'Glass') {
      mesh.material = glass;
      mesh.castShadow = false;
    } else if (mat && 'transmission' in mat) {
      (mat as THREE.MeshPhysicalMaterial).transmission = 0;
    }
  });

  const group = new THREE.Group();
  group.name = 'Car';
  group.add(root);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y; // tyres on the ground
  group.updateMatrixWorld(true);

  // inlet on the left (+X) front fender, found on the actual body surface
  const frontWheel = wheels.find((w) => w.name === 'WheelFrontL') || wheels[0];
  const wheelPos = frontWheel ? frontWheel.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(1, 0.35, 1.3);
  const sideSign = wheelPos.x >= 0 ? 1 : -1;
  const target = new THREE.Vector3(0, PORT_HEIGHT, wheelPos.z + PORT_Z_FROM_FRONT_WHEEL);
  const ray = new THREE.Raycaster(new THREE.Vector3(sideSign * 3, target.y, target.z), new THREE.Vector3(-sideSign, 0, 0));
  const hits = ray.intersectObject(root, true).filter((h) => (h.object as THREE.Mesh).material === paint || (h.object as THREE.Mesh).material === accent);
  const port = new THREE.Object3D();
  if (hits[0]) {
    const n = hits[0].face!.normal.clone().transformDirection(hits[0].object.matrixWorld);
    n.y = 0;
    n.normalize();
    port.position.copy(hits[0].point);
    port.lookAt(hits[0].point.clone().add(n));
  } else {
    port.position.set(sideSign * 0.98, target.y, target.z);
    port.lookAt(port.position.clone().add(new THREE.Vector3(sideSign, 0, 0)));
  }
  group.add(port);
  const inlet = createInlet(m, paint);
  port.add(inlet.group);
  inlet.group.position.z = -0.012; // sit into the body a touch so no gap shows on curved panels

  const bodyBox = new THREE.Box3(
    new THREE.Vector3(box.min.x * 0.72, 0.12, box.min.z + 0.15),
    new THREE.Vector3(box.max.x * 0.72, box.max.y - box.min.y - 0.05, box.max.z - 0.12),
  );
  return { group, paint, inlet, port, wheels, bodyBox, realistic: true };
}

/** Simplified procedural car used when the licensed model cannot be loaded (e.g. data saver). */
export function proceduralCar(m: ConnectorMats): CarRig {
  const group = new THREE.Group();
  group.name = 'CarFallback';
  const paint = new THREE.MeshPhysicalMaterial({ color: '#e8f3ec', metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#0b2b26', roughness: 0.05, clearcoat: 1 });
  const s = new THREE.Shape();
  s.moveTo(2.1, 0.3);
  s.quadraticCurveTo(2.3, 0.32, 2.3, 0.5);
  s.bezierCurveTo(2.3, 0.66, 2.2, 0.74, 1.96, 0.78);
  s.bezierCurveTo(1.6, 0.85, 1.2, 0.9, 0.92, 0.94);
  s.bezierCurveTo(0.6, 1.08, 0.3, 1.24, 0.0, 1.3);
  s.bezierCurveTo(-0.5, 1.36, -1.05, 1.32, -1.45, 1.18);
  s.bezierCurveTo(-1.8, 1.06, -2.1, 0.98, -2.25, 0.94);
  s.quadraticCurveTo(-2.32, 0.92, -2.32, 0.8);
  s.lineTo(-2.3, 0.42);
  s.quadraticCurveTo(-2.27, 0.3, -2.1, 0.3);
  s.lineTo(2.1, 0.3);
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(s, { depth: 1.6, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.14, bevelSegments: 5, curveSegments: 24 });
  geo.translate(0, 0, -0.8);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const x = p.getX(i);
    const t = Math.min(1, Math.max(0, (y - 0.9) / 0.45));
    const e = Math.min(1, Math.max(0, (Math.abs(x) - 1.5) / 0.9));
    p.setZ(i, p.getZ(i) * (1 - 0.28 * t * t) * (1 - 0.18 * e * e));
  }
  geo.computeVertexNormals();
  geo.rotateY(-Math.PI / 2); // length along Z, front +Z
  const body = new THREE.Mesh(geo, paint);
  body.castShadow = true;
  group.add(body);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.32, 2.2, 4, 0.14), glass);
  roof.position.set(0, 1.1, -0.3);
  group.add(roof);
  const wheels: THREE.Object3D[] = [];
  const tire = new THREE.MeshStandardMaterial({ color: '#0e1615', roughness: 0.85 });
  const rim = new THREE.MeshStandardMaterial({ color: '#c9d4ce', metalness: 1, roughness: 0.25 });
  for (const z of [-1.4, 1.4])
    for (const x of [-0.82, 0.82]) {
      const w = new THREE.Group();
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.09, 14, 40), tire);
      t.rotation.y = Math.PI / 2;
      t.scale.z = 1.4;
      w.add(t);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 28), rim);
      r.rotation.z = Math.PI / 2;
      w.add(r);
      w.position.set(x, 0.36, z);
      w.name = `Wheel${z > 0 ? 'Front' : 'Rear'}${x > 0 ? 'L' : 'R'}`;
      group.add(w);
      wheels.push(w);
    }
  const port = new THREE.Object3D();
  port.position.set(0.93, PORT_HEIGHT, 1.4 + PORT_Z_FROM_FRONT_WHEEL);
  port.lookAt(port.position.clone().add(new THREE.Vector3(1, 0, 0)));
  group.add(port);
  const inlet = createInlet(m, paint);
  port.add(inlet.group);
  return { group, paint, inlet, port, wheels, bodyBox: new THREE.Box3(new THREE.Vector3(-0.9, 0.12, -2.2), new THREE.Vector3(0.9, 1.3, 2.25)), realistic: false };
}
