import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { MARK, ARC_WIDTH } from '../brand/brandPaths';
import { createHolster, type ConnectorMats } from './connector';

export type ChargerState = { mode: 'ready' | 'connecting' | 'charging'; percent: number; kw: number; theme: 'light' | 'dark' };

/** Original pillar-style DC charger: holster, cable outlet, status screen, light strip and a 15A bike socket. */
export function createCharger(m: ConnectorMats, shell: THREE.MeshPhysicalMaterial) {
  const group = new THREE.Group();
  group.name = 'Charger';
  const dark = new THREE.MeshPhysicalMaterial({ color: '#0a1412', roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
  const trim = new THREE.MeshStandardMaterial({ color: '#163832', roughness: 0.5, metalness: 0.3 });

  const plinth = new THREE.Mesh(new RoundedBoxGeometry(0.74, 0.07, 0.52, 3, 0.025), trim);
  plinth.position.y = 0.035;
  group.add(plinth);
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.48, 1.66, 0.32, 6, 0.09), shell);
  body.position.y = 0.07 + 0.83;
  group.add(body);
  const cap = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.07, 0.4, 4, 0.03), shell);
  cap.position.set(0, 1.76, 0.02);
  group.add(cap);
  const capGlowMat = new THREE.MeshBasicMaterial({ color: '#DAF1DE', toneMapped: false });
  const capGlow = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.008, 0.3, 2, 0.003), capGlowMat);
  capGlow.position.set(0, 1.722, 0.03);
  group.add(capGlow);

  // front glass panel with screen + brand plate
  const panel = new THREE.Mesh(new RoundedBoxGeometry(0.38, 1.24, 0.02, 4, 0.04), dark);
  panel.position.set(0, 1.05, 0.162);
  group.add(panel);
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 380;
  const screenTex = new THREE.CanvasTexture(canvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = 4;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.38), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 1.36, 0.1735);
  group.add(screen);
  const plateCanvas = document.createElement('canvas');
  plateCanvas.width = plateCanvas.height = 256;
  drawMark(plateCanvas.getContext('2d')!, 256, '#DAF1DE', '#8EB69B');
  const plateTex = new THREE.CanvasTexture(plateCanvas);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), new THREE.MeshBasicMaterial({ map: plateTex, transparent: true, toneMapped: false }));
  plate.position.set(0, 0.86, 0.1735);
  group.add(plate);

  // light strip on the front edge = charge level
  const stripBg = new THREE.Mesh(new RoundedBoxGeometry(0.018, 1.1, 0.012, 2, 0.006), new THREE.MeshStandardMaterial({ color: '#0d1d1a', roughness: 0.5 }));
  stripBg.position.set(0.215, 1.0, 0.15);
  group.add(stripBg);
  const stripMat = new THREE.MeshBasicMaterial({ color: '#8EB69B', toneMapped: false });
  const stripFill = new THREE.Mesh(new RoundedBoxGeometry(0.02, 1.1, 0.014, 2, 0.006), stripMat);
  stripFill.geometry.translate(0, 0.55, 0);
  stripFill.position.set(0.215, 0.45, 0.151);
  stripFill.scale.y = 0.02;
  group.add(stripFill);

  // holster on the -X side (faces the car), cable outlet above it
  const holster = createHolster(m);
  holster.rotation.y = -Math.PI / 2;
  holster.position.set(-0.24, 1.02, 0.02);
  group.add(holster);
  const holsterPose = new THREE.Object3D(); // connector frame when holstered (face pointing into the cup)
  holsterPose.position.set(-0.33, 1.02, 0.02);
  holsterPose.rotation.set(0, Math.PI / 2, 0);
  group.add(holsterPose);
  const outlet = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.05, 16), m.insert);
  outlet.rotation.z = Math.PI / 2;
  outlet.position.set(-0.26, 1.48, -0.06);
  group.add(outlet);
  const outletPoint = new THREE.Object3D();
  outletPoint.position.set(-0.29, 1.48, -0.06);
  group.add(outletPoint);

  // 15A bike socket with a weather cover on the +X side
  const socketBox = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.12, 0.12, 2, 0.012), m.insert);
  socketBox.position.set(0.255, 0.52, 0.03);
  group.add(socketBox);
  const socketFace = new THREE.Mesh(new THREE.CircleGeometry(0.035, 24), m.body);
  socketFace.rotation.y = Math.PI / 2;
  socketFace.position.set(0.271, 0.52, 0.03);
  group.add(socketFace);
  const socketPoint = new THREE.Object3D();
  socketPoint.position.set(0.29, 0.52, 0.03);
  group.add(socketPoint);
  const bikeLedMat = new THREE.MeshBasicMaterial({ color: '#2b3a36', toneMapped: false });
  const bikeLed = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), bikeLedMat);
  bikeLed.rotation.y = Math.PI / 2;
  bikeLed.position.set(0.272, 0.6, 0.03);
  group.add(bikeLed);

  group.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  screen.castShadow = false;

  let last = '';
  const setState = (s: ChargerState) => {
    const key = `${s.mode}|${Math.round(s.percent)}|${s.theme}`;
    if (key === last) return;
    last = key;
    drawScreen(canvas, s);
    screenTex.needsUpdate = true;
    stripFill.scale.y = Math.max(0.02, s.mode === 'charging' ? s.percent / 100 : 0.02);
    stripMat.color.set(s.mode === 'charging' ? '#DAF1DE' : '#8EB69B');
  };
  setState({ mode: 'ready', percent: 0, kw: 0, theme: 'light' });

  return { group, holsterPose, outletPoint, socketPoint, bikeLedMat, capGlowMat, setState, stripMat };
}

export function drawMark(g: CanvasRenderingContext2D, size: number, arc: string, accent: string) {
  g.save();
  g.scale(size / 64, size / 64);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = ARC_WIDTH;
  g.strokeStyle = arc;
  g.stroke(new Path2D(MARK.arc));
  g.fillStyle = arc;
  g.fill(new Path2D(MARK.plug));
  g.fill(new Path2D(MARK.prongs));
  g.fillStyle = accent;
  g.fill(new Path2D(MARK.spark));
  g.restore();
}

function drawScreen(c: HTMLCanvasElement, s: ChargerState) {
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#163832');
  bg.addColorStop(1, '#051F20');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(24, 22);
  drawMark(g, 44, '#DAF1DE', '#8EB69B');
  g.restore();
  g.fillStyle = '#8EB69B';
  g.font = '600 18px sans-serif';
  g.fillText('CCS2  ·  DC', 84, 50);
  const label = s.mode === 'ready' ? 'Ready' : s.mode === 'connecting' ? 'Connecting' : 'Charging';
  g.fillStyle = '#DAF1DE';
  g.font = '700 40px sans-serif';
  g.fillText(label, 24, 132);
  // ring gauge
  const cx = W / 2;
  const cy = 248;
  const r = 78;
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(142,182,155,0.2)';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  if (s.mode !== 'ready') {
    g.strokeStyle = '#8EB69B';
    g.beginPath();
    g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.percent / 100));
    g.stroke();
  }
  g.fillStyle = '#DAF1DE';
  g.font = '700 44px sans-serif';
  g.textAlign = 'center';
  g.fillText(s.mode === 'ready' ? '—' : `${Math.round(s.percent)}%`, cx, cy + 15);
  g.font = '500 16px sans-serif';
  g.fillStyle = '#8EB69B';
  g.fillText(s.mode === 'charging' ? 'Simulated session' : 'Plug in to start', cx, H - 26);
  g.textAlign = 'left';
}
