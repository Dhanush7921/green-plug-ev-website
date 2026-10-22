import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { drawMark } from './charger';

export type EnvTheme = {
  floor: string;
  floorAlpha: number;
  line: string;
  bay: string;
  hedge: string;
  canopy: string;
  canopyGlow: string;
  hills: [string, string];
  hillAlpha: number;
  block: string;
  blockTop: string;
  route: string;
  pinCar: string;
  pinBike: string;
};

function radial(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, '#fff');
  grd.addColorStop(0.55, '#fff');
  grd.addColorStop(1, '#000');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Painted floor: bay lines, a charging-bay marking with the brand mark, subtle concrete grain. */
function drawFloor(c: HTMLCanvasElement, t: EnvTheme) {
  const g = c.getContext('2d')!;
  const S = c.width;
  g.fillStyle = t.floor;
  g.fillRect(0, 0, S, S);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.globalAlpha = 0.05;
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = rnd() > 0.5 ? '#000' : '#fff';
    g.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  g.globalAlpha = 1;
  // world: 24 m square centred on the car; 1 m = S/24 px
  const m = S / 24;
  const X = (x: number) => S / 2 + x * m;
  const Z = (z: number) => S / 2 + z * m;
  g.strokeStyle = t.line;
  g.lineWidth = m * 0.09;
  g.lineCap = 'round';
  // car bay (x -1.35..1.35, z -2.9..3.2) and bike bay to its right
  g.beginPath();
  g.moveTo(X(-1.45), Z(3.3));
  g.lineTo(X(-1.45), Z(-2.9));
  g.moveTo(X(1.45), Z(3.3));
  g.lineTo(X(1.45), Z(-2.9));
  g.moveTo(X(-1.45), Z(-2.9));
  g.lineTo(X(1.45), Z(-2.9));
  g.moveTo(X(4.6), Z(3.3));
  g.lineTo(X(4.6), Z(-2.9));
  g.stroke();
  // charging bay fill + mark
  g.fillStyle = t.bay;
  g.globalAlpha = 0.18;
  g.fillRect(X(-1.4), Z(-2.85), 2.8 * m, 6.1 * m);
  g.globalAlpha = 1;
  g.save();
  g.translate(X(-0.55), Z(2.3));
  g.globalAlpha = 0.55;
  drawMark(g, 1.1 * m, t.line, t.line);
  g.restore();
  g.globalAlpha = 1;
}

export function createEnvironment(quality: 'high' | 'low', theme: EnvTheme) {
  const group = new THREE.Group();
  const SIZE = 24;

  // optional real reflection under a translucent painted floor
  let reflector: Reflector | null = null;
  if (quality === 'high') {
    reflector = new Reflector(new THREE.CircleGeometry(11, 64), { textureWidth: 1024, textureHeight: 1024, clipBias: 0.003, color: 0x8a8f8c });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = -0.002;
    group.add(reflector);
  }
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = floorCanvas.height = quality === 'high' ? 2048 : 1024;
  drawFloor(floorCanvas, theme);
  const floorTex = new THREE.CanvasTexture(floorCanvas);
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.anisotropy = 8;
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, alphaMap: radial(), transparent: true, opacity: theme.floorAlpha, roughness: 0.42, metalness: 0.05, depthWrite: false });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.renderOrder = 1;
  group.add(floor);
  if (reflector) {
    const original = reflector.onBeforeRender.bind(reflector);
    reflector.onBeforeRender = (...args: Parameters<typeof original>) => {
      floor.visible = false;
      original(...args);
      floor.visible = true;
    };
  }

  // (no canopy: it hid the bike-side shot; kept as an empty group so callers stay simple)
  const canopyGroup = new THREE.Group();
  const canopyMat = new THREE.MeshPhysicalMaterial({ transparent: true });
  const glowMat = new THREE.MeshBasicMaterial({ transparent: true });

  // low planters with trimmed shrubs along the back of the bays
  const hedgeMat = new THREE.MeshStandardMaterial({ color: theme.hedge, roughness: 0.9 });
  const planterMat = new THREE.MeshStandardMaterial({ color: '#c9d6ce', roughness: 0.7 });
  for (const [x, z] of [
    [-1.8, -4.4],
    [0.6, -4.4],
    [6.2, -3.4],
  ] as const) {
    const box = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.36, 0.6, 3, 0.06), planterMat);
    box.position.set(x, 0.18, z);
    box.castShadow = box.receiveShadow = true;
    group.add(box);
    for (let k = -1; k <= 1; k++) {
      const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), hedgeMat);
      shrub.scale.set(1, 0.85, 1);
      shrub.position.set(x + k * 0.55, 0.55, z);
      shrub.castShadow = true;
      group.add(shrub);
    }
  }

  // distant hills for depth (fade to transparent at the base)
  const hillMats: THREE.ShaderMaterial[] = [];
  const hill = (color: string, z: number, height: number, seed: number) => {
    const s = new THREE.Shape();
    const width = 260;
    s.moveTo(-width / 2, -4);
    let r = seed;
    for (let i = 0; i <= 64; i++) {
      r = (r * 16807) % 2147483647;
      s.lineTo(-width / 2 + (i / 64) * width, height * (0.45 + 0.35 * Math.sin(i * 0.5 + seed) + 0.2 * (r / 2147483647)));
    }
    s.lineTo(width / 2, -4);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 }, uTop: { value: height } },
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; uniform float uTop; varying float vY; void main(){ gl_FragColor = vec4(uColor, smoothstep(-1.0, uTop * 0.55, vY) * uAlpha);\n#include <colorspace_fragment>\n}',
      transparent: true,
      depthWrite: false,
    });
    hillMats.push(mat);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(s), mat);
    // stand the ridge far behind the scene, facing the hero camera's general direction
    mesh.position.set(-0.73 * -z, 0, -0.68 * -z);
    mesh.lookAt(0, 0, 0);
    group.add(mesh);
  };
  hill(theme.hills[0], -70, 14, 7);
  hill(theme.hills[1], -48, 8, 3);

  // ---------------------------------------------------------------- discovery city
  const city = new THREE.Group();
  city.visible = false;
  const blocks: { x: number; z: number; h: number; d: number }[] = [];
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pitch = 4.2;
  for (let i = -9; i <= 9; i++)
    for (let j = -9; j <= 9; j++) {
      const x = i * pitch + 1.6;
      const z = j * pitch;
      const d = Math.hypot(x - 1.5, z);
      if (d < 8.5 || rnd() < 0.18) continue;
      blocks.push({ x, z, h: 0.5 + rnd() * rnd() * 3.2, d });
    }
  const groundMat = new THREE.MeshStandardMaterial({ color: theme.floor, roughness: 0.8, transparent: true, opacity: 0 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.006;
  ground.receiveShadow = true;
  city.add(ground);
  const blockMat = new THREE.MeshStandardMaterial({ color: theme.block, roughness: 0.6, metalness: 0.1 });
  const inst = new THREE.InstancedMesh(new RoundedBoxGeometry(2.9, 1, 2.9, 2, 0.1), blockMat, blocks.length);
  inst.castShadow = false;
  inst.receiveShadow = true;
  city.add(inst);
  const m4 = new THREE.Matrix4();
  const setBlocks = (p: number) => {
    blocks.forEach((b, k) => {
      const t = THREE.MathUtils.clamp(p * 1.8 - b.d / 40, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const h = Math.max(0.001, b.h * e);
      m4.makeScale(1, h, 1).setPosition(b.x, h / 2, b.z);
      inst.setMatrixAt(k, m4);
    });
    inst.instanceMatrix.needsUpdate = true;
  };
  setBlocks(0);

  // the route the energy trail draws: from the plaza along the streets to three sample stops
  const P = (x: number, z: number) => new THREE.Vector3(x, 0.08, z);
  const half = pitch / 2;
  // streets run between blocks: x = 3.7 + 4.2k, z = 2.1 + 4.2k
  void half;
  const routes = [
    [P(2.4, 1.6), P(3.7, 2.1), P(3.7, 2.2), P(3.7, 10.4), P(3.8, 10.5), P(7.9, 10.5)],
    [P(2.4, 1.6), P(3.7, 2.1), P(7.9, 2.1), P(12.0, 2.1), P(12.1, 2.0), P(12.1, -6.3)],
    [P(2.4, 1.6), P(-0.5, 2.1), P(-4.6, 2.1), P(-4.7, 2.2), P(-4.7, 10.4), P(-4.8, 10.5), P(-8.9, 10.5)],
  ];
  const routeUniforms = { uDraw: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(theme.route) } };
  const routeMat = new THREE.ShaderMaterial({
    uniforms: routeUniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uDraw; uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        if (vUv.x > uDraw) discard;
        float head = smoothstep(uDraw - 0.08, uDraw, vUv.x);
        float pulse = 0.65 + 0.35 * sin(vUv.x * 40.0 - uTime * 6.0);
        vec3 c = mix(uColor, vec3(1.0), head * 0.7);
        gl_FragColor = vec4(c * (pulse + head), 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
  const routeMeshes = routes.map((pts) => {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.16, 8, false), routeMat);
    city.add(mesh);
    return { mesh, end: pts[pts.length - 1] };
  });

  const pins = routeMeshes.map((r, i) => {
    const kind = i === 1 ? 'bike' : 'car';
    const color = kind === 'bike' ? theme.pinBike : theme.pinCar;
    const g = new THREE.Group();
    const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.6, 9, 24, 1, true), beamMat);
    beam.position.y = 4.5;
    g.add(beam);
    const headMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16), headMat);
    head.position.y = 1.6;
    g.add(head);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.4, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    g.position.copy(r.end);
    g.scale.setScalar(0.0001);
    city.add(g);
    return { group: g, kind, beamMat, headMat, ringMat, ring, shown: 0 };
  });
  group.add(city);

  const applyTheme = (t: EnvTheme) => {
    drawFloor(floorCanvas, t);
    floorTex.needsUpdate = true;
    floorMat.opacity = t.floorAlpha;
    hedgeMat.color.set(t.hedge);
    hillMats[0].uniforms.uColor.value.set(t.hills[0]);
    hillMats[1].uniforms.uColor.value.set(t.hills[1]);
    hillMats.forEach((m) => (m.uniforms.uAlpha.value = t.hillAlpha));
    blockMat.color.set(t.block);
    groundMat.color.set(t.floor);
    routeUniforms.uColor.value.set(t.route);
    pins.forEach((p) => {
      const c = p.kind === 'bike' ? t.pinBike : t.pinCar;
      p.beamMat.color.set(c);
      p.headMat.color.set(c);
      p.headMat.emissive.set(c);
      p.ringMat.color.set(c);
    });
  };

  return { group, reflector, floor, floorMat, groundMat, canopy: { group: canopyGroup, mat: canopyMat, glowMat }, hillMats, city, setBlocks, routeUniforms, pins, applyTheme };
}
