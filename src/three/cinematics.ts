// NEARVOLT EV cinematic layer for the existing charging scene. Purely additive: it reads the scene's car,
// port and camera state and adds headlight ignition with soft light beams, an emerald light sweep across the
// body, charging-port energy pulses and chapter lighting. Nothing here replaces existing scene objects.
import * as THREE from 'three';
import { gsap } from 'gsap';
import type { CarRig } from './car';

const EMERALD = new THREE.Color('#3ddc97');
const MINT = new THREE.Color('#DAF1DE');

/** Soft light cone: brightest at the lamp, fading along its length and towards the edges. */
function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#eafff2') } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float along = pow(1.0 - vUv.y, 1.6); float rim = pow(abs(dot(vN, vV)), 1.4);
        gl_FragColor = vec4(uColor, along * rim * uOpacity); }`,
  });
}

function ringMaterial() {
  return new THREE.MeshBasicMaterial({ color: EMERALD, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
}

export class Cinematics {
  readonly state = { ignite: 0, sweep: 0, beams: 0 };
  private group = new THREE.Group();
  private beams: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>[] = [];
  private spots: THREE.SpotLight[] = [];
  private sweepLight = new THREE.PointLight(EMERALD, 0, 3.2, 1.6);
  private rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private lampMats: THREE.MeshStandardMaterial[];
  private carMin = new THREE.Vector3();
  private carMax = new THREE.Vector3();
  private fwd = new THREE.Vector3(0, 0, 1);
  private ignTl: gsap.core.Timeline | null = null;
  private dark = false;

  constructor(
    private scene: THREE.Scene,
    car: CarRig,
    lampMats: THREE.MeshStandardMaterial[],
    seat: THREE.Vector3,
    portNormal: THREE.Vector3,
    private quality: 'high' | 'low',
  ) {
    this.lampMats = lampMats;
    scene.add(this.group);
    const box = new THREE.Box3().setFromObject(car.group);
    this.carMin.copy(box.min);
    this.carMax.copy(box.max);
    const centre = box.getCenter(new THREE.Vector3());

    // headlamp positions: the meshes that carry the headlight material
    const lamps: THREE.Vector3[] = [];
    car.group.traverse((o) => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.MeshStandardMaterial | undefined;
      if (m.isMesh && mat && /Headlight/.test(mat.name)) lamps.push(new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()));
    });
    if (lamps.length) {
      const avg = lamps.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(lamps.length);
      this.fwd.set(avg.x - centre.x, 0, avg.z - centre.z).normalize();
    }
    // a left/right pair across the car's width at the front
    const side = new THREE.Vector3(-this.fwd.z, 0, this.fwd.x);
    const front = lamps.length ? lamps.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(lamps.length) : centre.clone().addScaledVector(this.fwd, (box.max.z - box.min.z) * 0.48);
    const halfW = Math.min(0.62, (Math.abs(side.x) * (box.max.x - box.min.x) + Math.abs(side.z) * (box.max.z - box.min.z)) * 0.34);
    const lampY = lamps.length ? front.y : box.min.y + (box.max.y - box.min.y) * 0.45;

    for (const s of [-1, 1]) {
      const origin = front.clone().addScaledVector(side, s * halfW).setY(lampY);
      const len = 3.4;
      const geo = new THREE.ConeGeometry(0.62, len, 28, 1, true);
      geo.translate(0, -len / 2, 0); // apex at the lamp
      const beam = new THREE.Mesh(geo, beamMaterial());
      beam.position.copy(origin);
      // cone axis (-Y) points forward and slightly down onto the floor
      const dir = this.fwd.clone().add(new THREE.Vector3(0, -0.12, 0)).normalize();
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      beam.renderOrder = 5;
      beam.visible = false;
      this.beams.push(beam);
      this.group.add(beam);
      if (quality === 'high') {
        const spot = new THREE.SpotLight('#f2fff7', 0, 9, 0.42, 0.65, 1.4);
        spot.position.copy(origin);
        spot.target.position.copy(origin).addScaledVector(dir, 5);
        this.spots.push(spot);
        this.group.add(spot, spot.target);
      }
    }

    // emerald sweep light that travels along the body once at ignition
    this.group.add(this.sweepLight);

    // charging-port pulse rings
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), portNormal);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.062, 48), ringMaterial());
      ring.position.copy(seat).addScaledVector(portNormal, 0.03 + i * 0.002);
      ring.quaternion.copy(q);
      ring.visible = false;
      ring.renderOrder = 6;
      this.rings.push(ring);
      this.group.add(ring);
    }
  }

  setTheme(dark: boolean) {
    this.dark = dark;
  }

  /** Headlights flicker on, settle, and a light sweep runs along the body. */
  ignite(delay = 0) {
    this.ignTl?.kill();
    const s = this.state;
    Object.assign(s, { ignite: 0, sweep: 0, beams: 0 });
    const tl = gsap.timeline({ delay });
    tl.to(s, { ignite: 0.55, duration: 0.06, ease: 'none' })
      .to(s, { ignite: 0.08, duration: 0.09, ease: 'none' })
      .to(s, { ignite: 0.8, duration: 0.07, ease: 'none' })
      .to(s, { ignite: 0.3, duration: 0.12, ease: 'none' })
      .to(s, { ignite: 1, duration: 0.5, ease: 'power2.out' })
      .to(s, { beams: 1, duration: 1.2, ease: 'power2.out' }, 0.3)
      .to(s, { sweep: 1, duration: 1.6, ease: 'power2.inOut' }, 0.35);
    this.ignTl = tl;
    return tl;
  }

  /** Lights fully on without animation (reduced motion, or when the intro was skipped). */
  setOn() {
    this.ignTl?.kill();
    Object.assign(this.state, { ignite: 1, sweep: 1, beams: 1 });
  }

  update(time: number, charge: number, scroll: number) {
    const s = this.state;
    const hero = 1 - Math.min(1, Math.max(0, (scroll - 0.05) / 0.25));
    const dark = this.dark;

    // lamps: emissive follows the ignition (on top of the theme's base level)
    const lampBase = dark ? 2.2 : 0.6;
    for (const m of this.lampMats) m.emissiveIntensity = lampBase * (0.15 + 0.85 * s.ignite) + (dark ? 1.4 : 0.5) * s.ignite;

    const beamAmt = s.beams * s.ignite * hero;
    for (const b of this.beams) {
      b.visible = beamAmt > 0.01;
      b.material.uniforms.uOpacity.value = beamAmt * (dark ? 0.26 : 0.1);
    }
    for (const sp of this.spots) sp.intensity = beamAmt * (dark ? 26 : 9);

    // sweep: a bright point travelling rear -> front just above the shoulder line
    const sw = s.sweep;
    const k = Math.sin(Math.PI * Math.min(1, sw));
    const centre = this.carMin.clone().lerp(this.carMax, 0.5);
    const len = Math.max(this.carMax.x - this.carMin.x, this.carMax.z - this.carMin.z);
    this.sweepLight.position.copy(centre).addScaledVector(this.fwd, (sw - 0.5) * len * 1.1);
    this.sweepLight.position.y = this.carMax.y + 0.15;
    this.sweepLight.position.addScaledVector(new THREE.Vector3(-this.fwd.z, 0, this.fwd.x), 1.15);
    this.sweepLight.intensity = k * (dark ? 9 : 5);
    this.sweepLight.color.copy(EMERALD).lerp(MINT, 0.35);

    // port pulses while charging: three staggered rings expanding and fading
    const pulse = charge * (1 - Math.min(1, scroll / 0.12));
    this.rings.forEach((r, i) => {
      const ph = (time * 0.7 + i / 3) % 1;
      r.visible = pulse > 0.02;
      r.scale.setScalar(1 + ph * 3.2);
      r.material.opacity = pulse * (1 - ph) * (dark ? 0.9 : 0.55);
    });
  }

  diagnostics() {
    return { ignite: +this.state.ignite.toFixed(2), beams: +this.state.beams.toFixed(2), beamMeshes: this.beams.length, spots: this.spots.length, rings: this.rings.filter((r) => r.visible).length, quality: this.quality };
  }

  dispose() {
    this.ignTl?.kill();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.scene.remove(this.group);
  }
}

/** 0 → 1 → 0 bump over [a, b] (smoothstep up, smoothstep down). */
export function bump(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return Math.sin(Math.PI * t) ** 2;
}
