import * as THREE from 'three';

/**
 * Charging cable: a Verlet rope pinned at both ends (charger outlet and connector boot),
 * with gravity, ground contact and box colliders, rendered as a tube rebuilt in place each frame.
 * An emissive band travels along the tube while charging.
 */
export type Collider = { box: THREE.Box3; matrix: THREE.Matrix4; inverse: THREE.Matrix4 };

export class Cable {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  readonly uniforms = { uTime: { value: 0 }, uCharging: { value: 0 }, uGlow: { value: new THREE.Color('#8EB69B') } };
  private n: number;
  private pos: THREE.Vector3[];
  private prev: THREE.Vector3[];
  private seg: number;
  private radius: number;
  private rings: number;
  private radial: number;
  private geo: THREE.BufferGeometry;
  private colliders: Collider[] = [];
  private curve = new THREE.CatmullRomCurve3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  start = new THREE.Vector3();
  end = new THREE.Vector3();
  startDir = new THREE.Vector3(0, -1, 0);
  endDir = new THREE.Vector3(0, -1, 0);
  groundY = 0;

  constructor({ length = 3, points = 40, radius = 0.016, rings = 96, radial = 10 } = {}) {
    this.n = points;
    this.seg = length / (points - 1);
    this.radius = radius;
    this.rings = rings;
    this.radial = radial;
    this.pos = Array.from({ length: points }, () => new THREE.Vector3());
    this.prev = Array.from({ length: points }, () => new THREE.Vector3());

    const vCount = (rings + 1) * (radial + 1);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vCount * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vCount * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(vCount * 2);
    const idx: number[] = [];
    for (let i = 0; i <= rings; i++) {
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        uv[k * 2] = i / rings;
        uv[k * 2 + 1] = j / radial;
        if (i < rings && j < radial) {
          const a = k;
          const b = k + radial + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);

    const mat = new THREE.MeshPhysicalMaterial({ color: '#0d1514', roughness: 0.42, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.35 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vAlong;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvAlong = uv.x;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlong;\nuniform float uTime;\nuniform float uCharging;\nuniform vec3 uGlow;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float pulse = pow(max(0.0, sin(vAlong * 46.0 - uTime * 7.0)), 10.0);
          float band = smoothstep(0.0, 0.08, vAlong) * smoothstep(1.0, 0.92, vAlong);
          totalEmissiveRadiance += uGlow * (pulse * 1.8 + 0.12) * uCharging * band;`,
        );
    };
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  addCollider(box: THREE.Box3, matrix: THREE.Matrix4) {
    this.colliders.push({ box, matrix: matrix.clone(), inverse: matrix.clone().invert() });
  }

  /** Lay the rope out as a hanging curve between the current endpoints and let it settle. */
  reset(steps = 240) {
    const { n } = this;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.tmp.lerpVectors(this.start, this.end, t);
      this.tmp.y -= Math.sin(t * Math.PI) * 0.9;
      this.tmp.y = Math.max(this.groundY + this.radius, this.tmp.y);
      this.pos[i].copy(this.tmp);
      this.prev[i].copy(this.tmp);
    }
    for (let s = 0; s < steps; s++) this.simulate(1 / 60);
    this.rebuild();
  }

  simulate(dt: number) {
    const { n, pos, prev } = this;
    const g = -9.8 * dt * dt;
    const damping = 0.985;
    for (let i = 1; i < n - 1; i++) {
      const p = pos[i];
      const vx = (p.x - prev[i].x) * damping;
      const vy = (p.y - prev[i].y) * damping;
      const vz = (p.z - prev[i].z) * damping;
      prev[i].copy(p);
      p.x += vx;
      p.y += vy + g;
      p.z += vz;
    }
    pos[0].copy(this.start);
    pos[n - 1].copy(this.end);
    // the first/last segments leave the plug and the outlet along their axes (stiff boots)
    const bootLen = this.seg * 1.0;
    for (let iter = 0; iter < 14; iter++) {
      pos[1].lerp(this.tmp.copy(this.start).addScaledVector(this.startDir, bootLen), 0.5);
      pos[n - 2].lerp(this.tmp.copy(this.end).addScaledVector(this.endDir, bootLen), 0.5);
      for (let i = 0; i < n - 1; i++) {
        const a = pos[i];
        const b = pos[i + 1];
        this.tmp.subVectors(b, a);
        const d = this.tmp.length() || 1e-6;
        const diff = (d - this.seg) / d;
        const wa = i === 0 ? 0 : 0.5;
        const wb = i + 1 === n - 1 ? 0 : 0.5;
        const w = wa + wb || 1;
        a.addScaledVector(this.tmp, (diff * wa) / w);
        b.addScaledVector(this.tmp, (-diff * wb) / w);
      }
      for (let i = 1; i < n - 1; i++) this.collide(pos[i]);
    }
  }

  private collide(p: THREE.Vector3) {
    const floor = this.groundY + this.radius;
    if (p.y < floor) p.y = floor;
    for (const c of this.colliders) {
      const local = this.tmp2.copy(p).applyMatrix4(c.inverse);
      const b = c.box;
      if (local.x > b.min.x && local.x < b.max.x && local.y > b.min.y && local.y < b.max.y && local.z > b.min.z && local.z < b.max.z) {
        const dx0 = local.x - b.min.x;
        const dx1 = b.max.x - local.x;
        const dy1 = b.max.y - local.y;
        const dz0 = local.z - b.min.z;
        const dz1 = b.max.z - local.z;
        const m = Math.min(dx0, dx1, dy1, dz0, dz1);
        if (m === dx0) local.x = b.min.x;
        else if (m === dx1) local.x = b.max.x;
        else if (m === dy1) local.y = b.max.y;
        else if (m === dz0) local.z = b.min.z;
        else local.z = b.max.z;
        p.copy(local.applyMatrix4(c.matrix));
      }
    }
  }

  /** Test hook: how far the cable end is from its anchor and how many inner points sit inside a collider. */
  diagnostics() {
    let inside = 0;
    let belowGround = 0;
    for (let i = 1; i < this.n - 1; i++) {
      const p = this.pos[i];
      if (p.y < this.groundY + this.radius * 0.5) belowGround++;
      for (const c of this.colliders) {
        const l = this.tmp2.copy(p).applyMatrix4(c.inverse);
        if (c.box.containsPoint(l)) inside++;
      }
    }
    return { endGap: this.pos[this.n - 1].distanceTo(this.end), startGap: this.pos[0].distanceTo(this.start), inside, belowGround, points: this.n };
  }

  /** Rebuild tube vertices in place using parallel-transport frames. */
  rebuild() {
    this.curve.points = this.pos;
    const pa = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const na = this.geo.getAttribute('normal') as THREE.BufferAttribute;
    const { rings, radial, radius } = this;
    const P = new THREE.Vector3();
    const T = new THREE.Vector3();
    const N = new THREE.Vector3(0, 1, 0);
    const B = new THREE.Vector3();
    const prevT = new THREE.Vector3();
    for (let i = 0; i <= rings; i++) {
      const u = i / rings;
      this.curve.getPoint(u, P);
      this.curve.getTangent(u, T).normalize();
      if (i === 0) {
        N.set(0, 1, 0);
        if (Math.abs(N.dot(T)) > 0.9) N.set(1, 0, 0);
        B.crossVectors(T, N).normalize();
        N.crossVectors(B, T).normalize();
      } else {
        const axis = this.tmp.crossVectors(prevT, T);
        const len = axis.length();
        if (len > 1e-6) {
          axis.divideScalar(len);
          const ang = Math.acos(THREE.MathUtils.clamp(prevT.dot(T), -1, 1));
          N.applyAxisAngle(axis, ang);
        }
        B.crossVectors(T, N).normalize();
        N.crossVectors(B, T).normalize();
      }
      prevT.copy(T);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        const nx = cx * N.x + cy * B.x;
        const ny = cx * N.y + cy * B.y;
        const nz = cx * N.z + cy * B.z;
        const k = i * (radial + 1) + j;
        na.setXYZ(k, nx, ny, nz);
        pa.setXYZ(k, P.x + nx * radius, P.y + ny * radius, P.z + nz * radius);
      }
    }
    pa.needsUpdate = true;
    na.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }

  update(dt: number, time: number, substeps = 2) {
    for (let s = 0; s < substeps; s++) this.simulate(Math.min(dt, 1 / 30) / substeps);
    this.uniforms.uTime.value = time;
    this.rebuild();
  }

  dispose() {
    this.geo.dispose();
    this.mesh.material.dispose();
  }
}
