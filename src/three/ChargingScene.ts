import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import { Cable } from './cable';
import { loadCar, proceduralCar, type CarRig } from './car';
import { createCharger } from './charger';
import { COLLAR_DEPTH, createConnector, createConnectorMaterials } from './connector';
import { createEnvironment } from './environment';
import { SCENE_THEMES, type SceneTheme } from './palette';
import { createScooter } from './scooter';

export type Quality = 'high' | 'low';
export type ThemeName = 'light' | 'dark';
export type PinFilter = 'all' | 'car' | 'bike';
export type ConnectionStep = 'ready' | 'opening' | 'aligning' | 'inserting' | 'locked' | 'charging';
export type ScreenAnchor = { x: number; y: number; visible: boolean };
export type AnchorMap = Record<string, ScreenAnchor>;
type Options = { canvas: HTMLCanvasElement; quality: Quality; theme: ThemeName; reducedMotion: boolean; modelUrl: string; useModel: boolean };

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Layout (metres). Car at the origin, nose towards +Z, inlet on the left (+X) front fender.
const CHARGER_POS = v3(2.15, 0, -0.35);
const CHARGER_ROT = Math.PI / 4;
const SCOOTER_POS = v3(3.95, 0, -1.3);
const SCOOTER_ROT = Math.PI / 4;

export class ChargingScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  onAnchors?: (a: AnchorMap) => void;
  onStatus?: (step: ConnectionStep, percent: number) => void;
  onContextLost?: () => void;
  realisticCar = false;

  private opts: Options;
  private theme: SceneTheme;
  private themeName: ThemeName;
  private m = createConnectorMaterials();
  private shell = new THREE.MeshPhysicalMaterial({ color: '#f4faf6', roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 });
  private scooterPaint = new THREE.MeshPhysicalMaterial({ color: '#f1f8f3', metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  private env!: ReturnType<typeof createEnvironment>;
  private charger!: ReturnType<typeof createCharger>;
  private connector!: ReturnType<typeof createConnector>;
  private scooter!: ReturnType<typeof createScooter>;
  private car!: CarRig;
  private carCable!: Cable;
  private bikeCable!: Cable;
  private hemi = new THREE.HemisphereLight();
  private key = new THREE.DirectionalLight();
  private rim = new THREE.DirectionalLight();
  private glowLight = new THREE.PointLight('#8EB69B', 0, 4, 1.8);
  private carLights: THREE.MeshStandardMaterial[] = [];
  private aoMats: THREE.MeshBasicMaterial[] = [];

  // connection state (driven by GSAP)
  private cs = { door: 0, travel: 0, insert: 0, latch: 0, charge: 0, push: 0, percent: 22 };
  private connTl: gsap.core.Timeline | null = null;
  private intro = { t: 1 };
  private holsterPos = new THREE.Vector3();
  private holsterQuat = new THREE.Quaternion();
  private seatPos = new THREE.Vector3();
  private prePos = new THREE.Vector3();
  private seatQuat = new THREE.Quaternion();
  private portNormal = new THREE.Vector3();
  private travelCurve!: THREE.CatmullRomCurve3;
  private lastStep: ConnectionStep | '' = '';

  private scroll = 0;
  private pointer = { x: 0, y: 0, cx: 0, cy: 0 };
  private size = { w: 1, h: 1 };
  private dpr = 1;
  private running = false;
  private last = 0;
  private time = 0;
  private frames: number[] = [];
  private filter: PinFilter = 'all';
  private disposed = false;
  private camPos: THREE.CatmullRomCurve3;
  private camTgt: THREE.CatmullRomCurve3;
  private closePos = new THREE.Vector3();
  private closeTgt = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  constructor(opts: Options) {
    this.opts = opts;
    this.themeName = opts.theme;
    this.theme = SCENE_THEMES[opts.theme];
    const r = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.dpr = Math.min(window.devicePixelRatio || 1, opts.quality === 'high' ? 2 : 1.5);
    r.setPixelRatio(this.dpr);
    this.renderer = r;
    opts.canvas.addEventListener('webglcontextlost', this.handleLost);

    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.035).texture;
    pm.dispose();

    // camera keyframes: hero -> bike side -> follow the energy -> discovery city
    this.camPos = new THREE.CatmullRomCurve3([v3(10.3, 2.25, 7.15), v3(8.7, 1.15, 1.9), v3(4.2, 0.95, 3.9), v3(10, 26, 24)], false, 'centripetal');
    this.camTgt = new THREE.CatmullRomCurve3([v3(1.85, 0.75, -0.45), v3(2.7, 0.62, -0.8), v3(1.2, 0.7, 0.6), v3(1.5, 0, 2.5)], false, 'centripetal');
  }

  /** Builds the scene; loads the licensed car model (or the procedural fallback). */
  async init(onProgress?: (p: number) => void) {
    const { quality } = this.opts;
    this.env = createEnvironment(quality, this.theme.env3d);
    this.scene.add(this.env.group);

    this.scene.add(this.hemi, this.key, this.rim, this.glowLight);
    this.key.position.set(5, 9, 6);
    this.key.castShadow = true;
    const sm = quality === 'high' ? 2048 : 1024;
    this.key.shadow.mapSize.set(sm, sm);
    Object.assign(this.key.shadow.camera, { left: -6, right: 7, top: 6, bottom: -6, near: 1, far: 25 });
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    this.rim.position.set(-6, 4, -7);

    // charger + connector
    this.charger = createCharger(this.m, this.shell);
    this.charger.group.position.copy(CHARGER_POS);
    this.charger.group.rotation.y = CHARGER_ROT;
    this.scene.add(this.charger.group);
    this.connector = createConnector(this.m);
    this.scene.add(this.connector.group);
    this.glowLight.position.copy(CHARGER_POS).add(v3(0, 1.4, 0.4));

    // scooter
    this.scooter = createScooter(this.scooterPaint);
    this.scooter.group.position.copy(SCOOTER_POS);
    this.scooter.group.rotation.y = SCOOTER_ROT;
    this.scene.add(this.scooter.group);
    this.addAO(this.scooter.group, 2.4, 1.0, 0.8);
    this.addAO(this.charger.group, 1.2, 1.0, 0.7);

    // car
    try {
      if (!this.opts.useModel) throw new Error('model disabled');
      this.car = await loadCar(this.opts.modelUrl, this.m, onProgress);
      this.realisticCar = true;
    } catch (e) {
      if (this.opts.useModel) console.warn('[GREEN PLUG EV] Car model unavailable, using simplified car.', e);
      this.car = proceduralCar(this.m);
    }
    if (this.disposed) return;
    this.scene.add(this.car.group);
    this.addAO(this.car.group, 2.6, 5.2, 0.9);
    this.car.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat && /Headlight|Signallight/.test(mat.name) && !this.carLights.includes(mat)) this.carLights.push(mat);
    });
    this.scene.updateMatrixWorld(true);

    // poses
    const hp = this.charger.holsterPose;
    hp.getWorldPosition(this.holsterPos);
    hp.getWorldQuaternion(this.holsterQuat);
    const port = this.car.port;
    port.getWorldQuaternion(this.tmpQ);
    this.portNormal.set(0, 0, 1).applyQuaternion(this.tmpQ);
    this.seatQuat.copy(this.tmpQ).multiply(new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), Math.PI));
    port.localToWorld(this.seatPos.set(0, 0, COLLAR_DEPTH - 0.012 + 0.003));
    this.prePos.copy(this.seatPos).addScaledVector(this.portNormal, 0.2);
    const holsterOut = v3(0, 0, -1).applyQuaternion(this.holsterQuat); // out of the cup
    const h1 = this.holsterPos.clone().addScaledVector(holsterOut, 0.16).add(v3(0, 0.1, 0));
    const pre1 = this.prePos.clone().addScaledVector(this.portNormal, 0.16).add(v3(0, 0.06, 0));
    const mid = h1.clone().lerp(pre1, 0.5).add(v3(0, 0.22, 0)).addScaledVector(this.portNormal, 0.25);
    this.travelCurve = new THREE.CatmullRomCurve3([this.holsterPos.clone(), h1, mid, pre1, this.prePos.clone()], false, 'centripetal');
    // medium shot that keeps the holster, the cable path and the inlet in frame
    this.closeTgt.copy(this.seatPos).lerp(this.holsterPos, 0.5).add(v3(0, -0.08, 0));
    this.closePos.copy(this.closeTgt).add(v3(2.0, 0.5, 2.95));

    // cables
    const outlet = this.charger.outletPoint.getWorldPosition(new THREE.Vector3());
    this.carCable = new Cable({ length: 3.1, points: 42, radius: 0.016, rings: quality === 'high' ? 110 : 70 });
    this.carCable.start.copy(outlet);
    this.carCable.startDir.set(-1, -0.6, 0).applyAxisAngle(v3(0, 1, 0), CHARGER_ROT).normalize();
    this.carCable.addCollider(this.car.bodyBox, this.car.group.matrixWorld);
    this.carCable.addCollider(new THREE.Box3(v3(-0.26, 0, -0.18), v3(0.26, 1.82, 0.18)), this.charger.group.matrixWorld);
    this.scene.add(this.carCable.mesh);
    const socket = this.charger.socketPoint.getWorldPosition(new THREE.Vector3());
    const inlet = this.scooter.inletPoint.getWorldPosition(new THREE.Vector3());
    this.bikeCable = new Cable({ length: socket.distanceTo(inlet) * 1.45, points: 24, radius: 0.009, rings: 48, radial: 8 });
    this.bikeCable.start.copy(socket);
    this.bikeCable.startDir.set(1, -0.3, 0).applyAxisAngle(v3(0, 1, 0), CHARGER_ROT).normalize();
    this.bikeCable.end.copy(inlet);
    this.bikeCable.endDir.set(0, -0.5, 1).applyAxisAngle(v3(0, 1, 0), SCOOTER_ROT).normalize();
    this.bikeCable.reset(260);
    this.scene.add(this.bikeCable.mesh);

    this.applyTheme();
    this.setConnectionInstant(this.opts.reducedMotion ? 1 : 0);
    this.carCable.reset(300);
    await this.warmup();
  }

  private addAO(parent: THREE.Object3D, w: number, d: number, opacity: number) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.5, 'rgba(0,0,0,.5)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity, depthWrite: false, color: '#0b2b26' });
    mat.userData.base = opacity;
    const ao = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    ao.rotation.x = -Math.PI / 2;
    ao.position.y = 0.004;
    ao.renderOrder = 2;
    parent.add(ao);
    this.aoMats.push(mat);
  }

  private async warmup() {
    this.update(0);
    this.updateCamera();
    const vis = this.env.city.visible;
    this.env.city.visible = true;
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* shaders compile on first render instead */
    }
    this.env.city.visible = vis;
  }

  // ---------------------------------------------------------------- theme
  setTheme(name: ThemeName) {
    if (name === this.themeName) return;
    this.themeName = name;
    this.theme = SCENE_THEMES[name];
    this.applyTheme();
    if (!this.running) this.render();
  }

  private applyTheme() {
    const t = this.theme;
    this.renderer.toneMappingExposure = t.exposure;
    this.scene.environmentIntensity = t.env;
    this.hemi.color.set(t.hemi[0]);
    this.hemi.groundColor.set(t.hemi[1]);
    this.hemi.intensity = t.hemi[2];
    this.key.color.set(t.key[0]);
    this.key.intensity = t.key[1];
    this.rim.color.set(t.rim[0]);
    this.rim.intensity = t.rim[1];
    this.shell.color.set(t.shell);
    if (this.car) this.car.paint.color.set(t.paint);
    this.env.applyTheme(t.env3d);
    this.aoMats.forEach((m) => (m.opacity = (m.userData.base as number) * t.shadow));
    const dark = this.themeName === 'dark';
    this.carLights.forEach((m) => {
      m.emissive = new THREE.Color(dark ? '#DAF1DE' : '#ffffff');
      m.emissiveIntensity = dark ? 2.2 : 0.6;
    });
    for (const c of [this.carCable, this.bikeCable]) c?.uniforms.uGlow.value.set(dark ? '#8EB69B' : '#235347');
    this.charger.capGlowMat.color.set(dark ? '#DAF1DE' : '#ffffff');
  }

  // ---------------------------------------------------------------- connection
  private setConnectionInstant(v: 0 | 1) {
    Object.assign(this.cs, { door: v, travel: v, insert: v, latch: 0, charge: v, push: 0, percent: v ? 64 : 22 });
  }

  /** Cinematic plug-in: door opens, connector lifts from the holster, aligns, inserts, latches, charging starts. */
  playConnection(withCamera = true) {
    if (!this.car) return;
    this.connTl?.kill();
    const cs = this.cs;
    Object.assign(cs, { door: 0, travel: 0, insert: 0, latch: 0, charge: 0, percent: 22 });
    this.carCable.reset(120);
    const tl = gsap.timeline();
    if (withCamera) tl.to(cs, { push: 1, duration: 1.5, ease: 'power2.inOut' }, 0);
    tl.to(cs, { door: 1, duration: 0.9, ease: 'power2.out' }, 0.35)
      .to(cs, { travel: 1, duration: 2.1, ease: 'power2.inOut' }, 0.6)
      .to(cs, { insert: 1, duration: 0.55, ease: 'power3.in' }, 2.75)
      .to(cs, { latch: 1, duration: 0.12, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 3.3)
      .to(cs, { charge: 1, duration: 0.9, ease: 'power2.out' }, 3.55)
      .to(cs, { percent: 64, duration: 6, ease: 'none' }, 3.7);
    if (withCamera) tl.to(cs, { push: 0, duration: 1.8, ease: 'power2.inOut' }, 4.1);
    this.connTl = tl;
    return tl;
  }

  replayConnection() {
    return this.playConnection(true);
  }

  /** Camera establishing move used right after the brand intro. */
  playEstablishing() {
    this.intro.t = 0;
    return gsap.to(this.intro, { t: 1, duration: 1.8, ease: 'power3.out' });
  }

  private step(): ConnectionStep {
    const c = this.cs;
    if (c.charge > 0.02) return 'charging';
    if (c.insert >= 0.999) return 'locked';
    if (c.insert > 0) return 'inserting';
    if (c.travel > 0) return 'aligning';
    if (c.door > 0) return 'opening';
    return 'ready';
  }

  private updateConnection(dt: number) {
    const c = this.cs;
    const conn = this.connector.group;
    // connector pose
    if (c.insert > 0) {
      conn.position.lerpVectors(this.prePos, this.seatPos, c.insert);
      conn.quaternion.copy(this.seatQuat);
    } else if (c.travel > 0) {
      this.travelCurve.getPoint(c.travel, conn.position);
      const r = smooth(0.12, 0.88, c.travel);
      conn.quaternion.slerpQuaternions(this.holsterQuat, this.seatQuat, r);
    } else {
      conn.position.copy(this.holsterPos);
      conn.quaternion.copy(this.holsterQuat);
    }
    this.connector.latch.position.y = 0.052 - c.latch * 0.006;
    // door + LED
    this.car.inlet.door.rotation.y = c.door * 1.95;
    const led = this.car.inlet.led.material;
    if (c.charge > 0) {
      const pulse = 0.65 + 0.35 * Math.sin(this.time * 3.2);
      led.emissive.set('#8EB69B');
      led.emissiveIntensity = 2.2 * c.charge * pulse + 0.4;
    } else {
      led.emissive.setRGB(1, 1, 1);
      led.emissiveIntensity = smooth(0.2, 1, c.door) * 1.2;
    }
    // cable follows the connector
    conn.updateMatrixWorld();
    this.carCable.end.copy(this.connector.cableExit).applyMatrix4(conn.matrixWorld);
    this.carCable.endDir.copy(this.connector.cableDir).transformDirection(conn.matrixWorld);
    this.carCable.uniforms.uCharging.value = c.charge;
    this.carCable.update(dt, this.time);
    this.bikeCable.uniforms.uCharging.value = c.charge;
    this.bikeCable.update(dt, this.time, 1);
    // charger + scooter feedback
    const step = this.step();
    this.charger.setState({ mode: step === 'charging' ? 'charging' : step === 'ready' ? 'ready' : 'connecting', percent: c.percent, kw: 0, theme: this.themeName });
    this.scooter.ledMat.color.set(c.charge > 0.5 ? '#8EB69B' : '#2b3a36');
    this.charger.bikeLedMat.color.set(c.charge > 0.5 ? '#DAF1DE' : '#2b3a36');
    this.glowLight.intensity = c.charge * (this.themeName === 'dark' ? 5 : 2) * (0.8 + 0.2 * Math.sin(this.time * 3.2));
    if (step !== this.lastStep || step === 'charging') {
      this.lastStep = step;
      this.onStatus?.(step, c.percent);
    }
  }

  // ---------------------------------------------------------------- inputs
  setScroll(p: number) {
    this.scroll = Math.min(1, Math.max(0, p));
    if (!this.running) this.render();
  }

  setPointer(nx: number, ny: number) {
    this.pointer.x = nx;
    this.pointer.y = ny;
  }

  setPinFilter(f: PinFilter) {
    this.filter = f;
    if (!this.running) this.render();
  }

  resize(w: number, h: number) {
    this.size = { w: Math.max(1, w), h: Math.max(1, h) };
    this.renderer.setSize(this.size.w, this.size.h, false);
    this.camera.aspect = this.size.w / this.size.h;
    const rt = this.env?.reflector?.getRenderTarget();
    if (rt) rt.setSize(Math.round(this.size.w * this.dpr * 0.5), Math.round(this.size.h * this.dpr * 0.5));
    if (!this.running && this.car) this.render();
  }

  // ---------------------------------------------------------------- loop
  start() {
    if (this.running || this.disposed || !this.car) return;
    this.running = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop(this.loop);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private loop = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.adapt(dt);
    this.update(dt);
    this.draw();
  };

  private adapt(dt: number) {
    this.frames.push(dt);
    if (this.frames.length < 90) return;
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    this.frames.length = 0;
    if (avg > 0.024 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.renderer.setPixelRatio(this.dpr);
      this.resize(this.size.w, this.size.h);
    }
  }

  private update(dt: number) {
    if (!this.car) return;
    const k = 1 - Math.pow(0.002, dt);
    this.pointer.cx += (this.pointer.x - this.pointer.cx) * k;
    this.pointer.cy += (this.pointer.y - this.pointer.cy) * k;
    this.updateConnection(dt);
    this.updateStory(dt);
  }

  private updateStory(dt: number) {
    const s = this.scroll;
    const city = smooth(0.5, 0.82, s);
    this.env.city.visible = city > 0.001;
    this.env.groundMat.opacity = smooth(0.45, 0.65, s);
    if (this.env.reflector) this.env.reflector.visible = s < 0.55;
    this.env.floorMat.opacity = this.theme.env3d.floorAlpha + (1 - this.theme.env3d.floorAlpha) * smooth(0.4, 0.55, s);
    this.env.setBlocks(city);
    this.env.routeUniforms.uDraw.value = smooth(0.6, 0.92, s);
    this.env.routeUniforms.uTime.value = this.time;
    const canopy = 1 - smooth(0.45, 0.65, s);
    this.env.canopy.group.visible = canopy > 0.01;
    this.env.canopy.mat.opacity = canopy;
    this.env.canopy.glowMat.opacity = canopy;
    this.env.hillMats.forEach((m) => (m.uniforms.uAlpha.value = this.theme.env3d.hillAlpha * (1 - smooth(0.45, 0.7, s))));
    const show = smooth(0.84, 0.96, s);
    for (const p of this.env.pins) {
      const match = this.filter === 'all' || p.kind === this.filter;
      const target = match ? show : 0;
      p.shown += (target - p.shown) * (dt ? 1 - Math.pow(0.003, dt) : 1);
      const e = p.shown;
      p.group.visible = e > 0.003;
      p.group.scale.setScalar(Math.max(0.0001, e * (1 + Math.sin(e * Math.PI) * 0.3)));
      p.ring.scale.setScalar(1 + 0.3 * Math.sin(this.time * 2.5));
    }
  }

  private updateCamera() {
    const s = this.scroll;
    const { w, h } = this.size;
    const aspect = w / h;
    const pos = this.camPos.getPoint(s, this.tmp);
    const tgt = this.camTgt.getPoint(s, this.tmp2);
    // connection close-up blends in only near the top of the page
    const push = this.cs.push * (1 - smooth(0.0, 0.08, s));
    if (push > 0) {
      pos.lerp(this.closePos, push);
      tgt.lerp(this.closeTgt, push);
    }
    // establishing move after the intro
    if (this.intro.t < 1) {
      const e = 1 - this.intro.t;
      pos.add(this.tmpVec.set(4.5, 3.2, 5.0).multiplyScalar(e));
    }
    // narrow screens: pull back so the bay fits
    const fit = aspect >= 1.3 ? 1 : Math.min(1.85, (1.3 / aspect) * 0.62);
    if (aspect < 1) {
      // portrait: centre on the car's port and the charger; the scooter may crop at the edge
      const k = (1 - smooth(0.1, 0.3, s)) * (1 - push);
      tgt.x -= 0.35 * k;
      pos.x -= 0.35 * k;
    }
    if (fit > 1) pos.sub(tgt).multiplyScalar(1 + (fit - 1) * (1 - push * 0.6)).add(tgt);
    // pointer parallax
    const infl = (1 - smooth(0.6, 0.9, s) * 0.8) * (1 - push * 0.7);
    const e = this.camera.matrixWorld.elements;
    pos.x += (e[0] * this.pointer.cx * 0.5 - e[4] * this.pointer.cy * 0.25) * infl;
    pos.y += (e[1] * this.pointer.cx * 0.5 - e[5] * this.pointer.cy * 0.25) * infl;
    pos.z += (e[2] * this.pointer.cx * 0.5 - e[6] * this.pointer.cy * 0.25) * infl;
    this.camera.position.copy(pos);
    this.camera.lookAt(tgt);
    this.camera.fov = 30 - push * 4;
    // composition: scene to the right of the copy on wide screens, lower on portrait
    const hero = 1 - smooth(0.04, 0.25, s);
    const offX = aspect > 1.1 ? -w * Math.min(0.2, 0.06 + (aspect - 1.1) * 0.28) * Math.max(hero, push) : 0;
    const offY = aspect < 1 ? -h * 0.2 * (1 - smooth(0.05, 0.3, s)) : -h * 0.07 * hero;
    this.camera.setViewOffset(w, h, offX, offY, w, h);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
  private tmpVec = new THREE.Vector3();

  private draw() {
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    this.emitAnchors();
  }

  /** One frame without the loop (reduced motion, theme switch while paused). */
  render() {
    if (this.disposed || !this.car) return;
    this.update(0);
    this.draw();
  }

  private anchorPoints(): Record<string, THREE.Vector3> {
    const out: Record<string, THREE.Vector3> = {};
    out.port = this.car.port.getWorldPosition(new THREE.Vector3()).add(v3(0, 0.12, 0));
    out.socket = this.charger.socketPoint.getWorldPosition(new THREE.Vector3()).add(v3(0, 0.08, 0));
    out.charger = this.charger.group.position.clone().add(v3(0, 1.95, 0));
    out.scooter = this.scooter.group.position.clone().add(v3(0, 1.55, 0));
    this.env.pins.forEach((p, i) => (out[`pin${i}`] = p.group.position.clone().add(v3(0, 2.6 * p.group.scale.y, 0))));
    return out;
  }

  /** Test hook used by scripts/verify.mjs: geometric checks on the plug-in state. */
  diagnostics() {
    const conn = this.connector.group;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(conn.quaternion);
    return {
      step: this.step(),
      realisticCar: this.realisticCar,
      seatGap: conn.position.distanceTo(this.seatPos),
      axisErrorDeg: THREE.MathUtils.radToDeg(fwd.angleTo(this.portNormal.clone().negate())),
      doorOpen: this.car.inlet.door.rotation.y,
      ledIntensity: (this.car.inlet.led.material as THREE.MeshStandardMaterial).emissiveIntensity,
      carCable: this.carCable.diagnostics(),
      bikeCable: this.bikeCable.diagnostics(),
      scroll: this.scroll,
      push: this.cs.push,
      introT: this.intro.t,
      camera: this.camera.position.toArray().map((v) => +v.toFixed(2)),
    };
  }

  private emitAnchors() {
    if (!this.onAnchors) return;
    const { w, h } = this.size;
    const res: AnchorMap = {};
    for (const [id, p] of Object.entries(this.anchorPoints())) {
      const v = p.project(this.camera);
      res[id] = { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z > -1 && v.z < 1 };
    }
    this.onAnchors(res);
  }

  private handleLost = (e: Event) => {
    e.preventDefault();
    this.stop();
    this.onContextLost?.();
  };

  dispose() {
    this.disposed = true;
    this.stop();
    this.connTl?.kill();
    this.opts.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.env?.reflector?.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
