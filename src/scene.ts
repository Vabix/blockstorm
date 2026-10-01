import * as THREE from 'three';
import type { GameScene, GameState, PlayerState, SceneOptions } from './types';
import { BUTTON, ISLAND_HALF, PLATFORMS, meteorsAt, quakeCracksAt, tornadoAt, tsunamiHeight, tsunamiZ } from './map';

type Avatar = {
  group: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  ring: THREE.Mesh;
  label: THREE.Sprite;
  target: PlayerState;
  previous: THREE.Vector3;
  name: string;
  color: string;
};

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const dampAngle = (a: number, b: number, amount: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * amount;

/** Everything in the world is generated locally; no downloaded models or textures. */
export function createScene(container: HTMLElement, options: SceneOptions): GameScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#badff2');
  scene.fog = new THREE.Fog('#badff2', 85, 190);
  const camera = new THREE.PerspectiveCamera(49, 1, 0.1, 270);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Trójwymiarowa wyspa. Poruszaj się WASD, skacz spacją, naciśnij E przy przycisku.');
  container.appendChild(renderer.domElement);
  const root = new THREE.Group();
  scene.add(root);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();
  const cube = keepGeometry(new THREE.BoxGeometry(1, 1, 1));
  const cylinder = keepGeometry(new THREE.CylinderGeometry(1, 1, 1, 12));
  const roundCylinder = keepGeometry(new THREE.CylinderGeometry(1, 1, 1, 48));
  let disposed = false;
  let frame = 0;
  let gameState: GameState | undefined;
  let localId = '';
  let muted = true;
  let audioContext: AudioContext | undefined;
  let lastPhase = '';
  let yaw = 0.62;
  let pitch = 0.63;
  let distance = options.preview ? 68 : 23;
  const cameraTarget = new THREE.Vector3(0, 2, 1);
  const desiredCamera = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3();
  let hasLocalCamera = false;
  const avatars = new Map<string, Avatar>();
  const keys = new Set<string>();
  let touchX = 0;
  let touchZ = 0;
  let jumpQueued = false;
  let lastInput = 0;
  let lastTime = performance.now();
  let buttonDownUntil = 0;
  const listeners: (() => void)[] = [];

  function keepGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    geometries.add(geometry);
    return geometry;
  }

  function material(color: string, roughness = 0.83): THREE.MeshStandardMaterial {
    const key = color + roughness;
    let value = materialCache.get(key);
    if (!value) {
      value = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
      materialCache.set(key, value);
      materials.add(value);
    }
    return value;
  }

  function basic(color: string, opacity = 1): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
    materials.add(mat);
    return mat;
  }

  function box(parent: THREE.Object3D, color: string, x: number, y: number, z: number, w: number, h: number, d: number, shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(cube, material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function disc(parent: THREE.Object3D, color: string, x: number, y: number, z: number, radius: number, height: number, smooth = false): THREE.Mesh {
    const mesh = new THREE.Mesh(smooth ? roundCylinder : cylinder, material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, height, radius);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function label(text: string, foreground: string, background: string, width: number, height: number, fontSize = 36): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.beginPath();
    ctx.roundRect(5, 10, 630, 108, 28);
    ctx.fill();
    ctx.font = `800 ${fontSize}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = foreground;
    ctx.fillText(text, 320, 67, 582);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.add(texture);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    materials.add(mat);
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(width, height, 1);
    return sprite;
  }

  const hemi = new THREE.HemisphereLight('#e8f6ff', '#8ba482', 2.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3da', 3.1);
  sun.position.set(-28, 50, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -44;
  sun.shadow.camera.right = 44;
  sun.shadow.camera.top = 44;
  sun.shadow.camera.bottom = -44;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2;
  scene.add(sun);

  // A deep, layered island edge gives the miniature world a readable silhouette.
  box(root, '#849aa6', 0, -3.4, 0, 52, 6.7, 52);
  box(root, '#d9c696', 0, -1.35, 0, 55.4, 2.6, 55.4);
  box(root, '#78b974', 0, -0.18, 0, ISLAND_HALF * 2, 0.36, ISLAND_HALF * 2);
  box(root, '#9ccc84', 0, -0.015, 0, 54.7, 0.06, 54.7, false);
  const seaMaterial = new THREE.MeshStandardMaterial({ color: '#4ebbd5', roughness: 0.32, metalness: 0.13 });
  materials.add(seaMaterial);
  const sea = new THREE.Mesh(keepGeometry(new THREE.PlaneGeometry(420, 420)), seaMaterial);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -3.8;
  sea.receiveShadow = true;
  scene.add(sea);

  const seaSparkles: THREE.Mesh[] = [];
  for (let i = 0; i < 70; i++) {
    const angle = i * 2.399963;
    const radius = 35 + (i * 17.31 % 65);
    const sparkle = box(root, '#92dfed', Math.cos(angle) * radius, -3.72, Math.sin(angle) * radius, 1.6 + i % 4, 0.015, 0.1, false);
    seaSparkles.push(sparkle);
  }

  // Paths connect the button, spawn lawn, and the rising refuge.
  box(root, '#e6d7b1', 0, 0.015, 2, 6.5, 0.07, 48, false);
  box(root, '#e6d7b1', 3, 0.022, 0, 43, 0.07, 6.5, false);
  disc(root, '#f2e9ca', 0, 0.068, 0, 6.2, 0.08, true);
  disc(root, '#e1d4b1', 0, 0.115, 0, 3.8, 0.08, true);
  for (let i = -5; i <= 5; i++) {
    if (Math.abs(i) > 1) box(root, '#d4c5a1', 0, 0.061, i * 4, 5.8, 0.018, 0.065, false);
  }
  for (const p of PLATFORMS) {
    box(root, '#c5bca8', p.x, p.top / 2, p.z, p.w, p.top, p.d);
    box(root, p.color, p.x, p.top - 0.085, p.z, p.w + 0.07, 0.17, p.d + 0.04);
    if (p.x > 5) {
      box(root, '#f8f0da', p.x, p.top + 0.008, p.z + p.d / 2 - 0.13, p.w - 0.2, 0.025, 0.18, false);
      box(root, '#6f83ad', p.x - p.w / 2 + 0.15, p.top + 0.27, p.z, 0.3, 0.54, p.d);
      box(root, '#6f83ad', p.x + p.w / 2 - 0.15, p.top + 0.27, p.z, 0.3, 0.54, p.d);
    }
  }
  box(root, '#566884', 19.2, 11, -14.8, 0.12, 6, 0.12);
  const flag = box(root, '#b098ff', 20.4, 13.4, -14.8, 2.4, 1.4, 0.08);
  const highGround = label('↑  STREFA RATUNKOWA', '#ffffff', '#526c8e', 8, 1.6, 41);
  highGround.position.set(16, 10.4, -15);
  root.add(highGround);

  // A cheerful open pavilion has no walls that could obscure the players.
  const pavilion = new THREE.Group();
  pavilion.position.set(-17, 0, -13);
  root.add(pavilion);
  for (const x of [-3.25, 3.25]) {
    for (const z of [-2.75, 2.75]) box(pavilion, '#f7ecd2', x, 3.35, z, 0.42, 4.3, 0.42);
  }
  box(pavilion, '#dd896e', 0, 5.7, 0, 8.8, 0.55, 7.8);
  const roof = new THREE.Mesh(keepGeometry(new THREE.ConeGeometry(6.15, 2.3, 4)), material('#f2a37c'));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 7.05;
  roof.scale.z = 0.9;
  roof.castShadow = true;
  pavilion.add(roof);
  box(pavilion, '#916e52', -1.9, 1.75, 0, 0.65, 0.85, 3.9);
  box(pavilion, '#916e52', 1.9, 1.75, 0, 0.65, 0.85, 3.9);

  // Spawn marker, with a crisp mint halo visible from a distance.
  const spawnRing = new THREE.Mesh(keepGeometry(new THREE.RingGeometry(2.3, 2.65, 48)), basic('#d9ffd6'));
  spawnRing.rotation.x = -Math.PI / 2;
  spawnRing.position.set(-5, 0.08, 10);
  root.add(spawnRing);

  function tree(x: number, z: number, size: number, variant: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = variant * 0.43;
    group.scale.setScalar(size);
    root.add(group);
    box(group, '#997054', 0, 1.6, 0, 0.65, 3.2, 0.65);
    if (variant % 3 === 0) {
      for (let k = 0; k < 3; k++) {
        const leaf = new THREE.Mesh(keepGeometry(new THREE.ConeGeometry(2.2 - k * 0.4, 2.5, 5)), material(k === 0 ? '#4e8f67' : '#5ba173'));
        leaf.position.y = 3 + k * 1.15;
        leaf.castShadow = true;
        group.add(leaf);
      }
    } else {
      const foliage = box(group, variant % 2 ? '#73b979' : '#67a970', 0, 4.1, 0, 3.8, 2.7, 3.8);
      foliage.rotation.y = Math.PI / 8;
      box(group, '#85c986', 0.2, 5.05, 0.1, 2.7, 1.8, 2.7).rotation.y = -0.13;
      box(group, '#90cc87', -1.2, 3.7, 0.7, 2.1, 1.8, 2.3).rotation.y = 0.2;
    }
  }
  const treePositions = [[-23,-22],[-13,-23],[-3,-23],[7,-23],[23,-22],[24,-8],[24,3],[24,23],[12,24],[-8,24],[-22,23],[-24,5],[-24,-5],[-10,15]];
  treePositions.forEach(([x, z], i) => tree(x, z, 0.78 + (i % 4) * 0.14, i));

  // Low fences frame the island, with gaps towards the stairs and shore.
  for (let i = -2; i <= 2; i++) {
    const x = i * 4;
    for (const z of [-26, 26]) {
      box(root, '#e8e0c3', x, 0.8, z, 0.22, 1.6, 0.22);
      if (i < 2) {
        box(root, '#ece7cf', x + 2, 0.6, z, 4, 0.16, 0.13);
        box(root, '#ece7cf', x + 2, 1.15, z, 4, 0.16, 0.13);
      }
    }
  }
  for (let i = 0; i < 110; i++) {
    const x = ((i * 17.371) % 51) - 25.5;
    const z = ((i * 11.813) % 51) - 25.5;
    if (Math.abs(x) < 4 || Math.abs(z) < 4 || x > 11 && x < 21 || x < -12 && z < -8) continue;
    const grass = box(root, i % 3 ? '#83be78' : '#acd892', x, 0.13, z, 0.11, 0.28 + (i % 3) * 0.08, 0.45, false);
    grass.rotation.y = i * 1.7;
    if (i % 7 === 0) {
      box(root, '#ffd59f', x + 0.12, 0.28, z + 0.15, 0.22, 0.1, 0.22, false);
      box(root, '#e4c9fc', x - 0.3, 0.25, z - 0.3, 0.18, 0.1, 0.18, false);
    }
  }
  // Shore rocks break up the otherwise square shape.
  for (let i = 0; i < 12; i++) {
    const side = i % 4;
    const along = -22 + Math.floor(i / 4) * 20;
    const x = side === 0 ? -28.5 : side === 1 ? 28.5 : along;
    const z = side === 2 ? -28.5 : side === 3 ? 28.5 : along;
    const rock = box(root, i % 2 ? '#92a6ac' : '#adb7b4', x, -1.7, z, 3.7, 2.9, 3.4);
    rock.rotation.y = i * 0.63;
    rock.rotation.z = i % 2 ? 0.1 : -0.07;
  }

  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 11; i++) {
    const cloud = new THREE.Group();
    const angle = i / 11 * TAU;
    cloud.position.set(Math.cos(angle) * (62 + i % 3 * 9), 25 + i % 4 * 5, Math.sin(angle) * 66);
    const scale = 1 + (i % 3) * 0.25;
    for (let j = 0; j < 4; j++) {
      box(cloud, '#f3fbff', (j - 1.5) * 3.8, j % 2 * 1.5, j % 2 * 0.4, 5.5, 2.8 + (j % 2), 4, false);
    }
    cloud.scale.setScalar(scale);
    cloud.rotation.y = i * 0.8;
    scene.add(cloud);
    clouds.push(cloud);
  }

  const buttonBase = new THREE.Group();
  buttonBase.position.set(BUTTON.x, 0, BUTTON.z);
  root.add(buttonBase);
  disc(buttonBase, '#6b7692', 0, 0.2, 0, 2.2, 0.4, true);
  disc(buttonBase, '#333d58', 0, 0.49, 0, 1.83, 0.2, true);
  const button = disc(buttonBase, '#f75b63', 0, 0.81, 0, 1.48, 0.52, true);
  const buttonTop = disc(buttonBase, '#ff7780', 0, 1.08, 0, 1.27, 0.025, true);
  const buttonRing = new THREE.Mesh(keepGeometry(new THREE.TorusGeometry(1.65, 0.045, 8, 60)), basic('#ffe2aa'));
  buttonRing.rotation.x = Math.PI / 2;
  buttonRing.position.y = 0.63;
  buttonBase.add(buttonRing);
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * TAU;
    const mark = box(buttonBase, i % 2 ? '#f8d478' : '#49546b', Math.sin(angle) * 2.05, 0.405, Math.cos(angle) * 2.05, 0.4, 0.018, 0.3, false);
    mark.rotation.y = angle;
  }
  const buttonTitle = label('NIE NACISKAJ PRZYCISKU', '#ffffff', '#242c46ee', 7.4, 1.48, 36);
  buttonTitle.position.set(0, 4.9, 0);
  root.add(buttonTitle);
  const buttonHint = label('[ E ]  NACISNIJ', '#ffffff', '#7b61cfe8', 3.5, 0.7, 38);
  buttonHint.position.set(0, 3.7, 0);
  root.add(buttonHint);
  buttonHint.visible = false;

  // Shared simulation functions supply every danger position seen below.
  const effects = new THREE.Group();
  root.add(effects);
  const tornado = new THREE.Group();
  effects.add(tornado);
  const funnelMaterial = new THREE.MeshStandardMaterial({ color: '#857899', transparent: true, opacity: 0.43, roughness: 1, depthWrite: false, side: THREE.DoubleSide });
  materials.add(funnelMaterial);
  const funnel = new THREE.Mesh(keepGeometry(new THREE.CylinderGeometry(5.5, 0.5, 18, 14, 1, true)), funnelMaterial);
  funnel.position.y = 9;
  tornado.add(funnel);
  const vortexRings: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const ring = new THREE.Mesh(keepGeometry(new THREE.TorusGeometry(1, 0.19, 5, 26)), material(i % 2 ? '#afa3c5' : '#9588ae'));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.7 + i * 1.65;
    ring.scale.setScalar(0.7 + i * 0.5);
    tornado.add(ring);
    vortexRings.push(ring);
  }
  const debris: THREE.Mesh[] = [];
  for (let i = 0; i < 40; i++) {
    const chunk = box(tornado, ['#dbc19b', '#9faf86', '#8b7c9d', '#d4c9e6'][i % 4], 0, 0, 0, 0.22 + i % 3 * 0.14, 0.3 + i % 4 * 0.14, 0.28 + i % 3 * 0.14);
    debris.push(chunk);
  }
  const dust = new THREE.Mesh(keepGeometry(new THREE.RingGeometry(0.75, 3.3, 32)), basic('#b7a1d0', 0.38));
  dust.rotation.x = -Math.PI / 2;
  dust.position.y = 0.1;
  tornado.add(dust);
  tornado.visible = false;

  const tsunami = new THREE.Group();
  effects.add(tsunami);
  const waveMaterial = new THREE.MeshStandardMaterial({ color: '#39bcd8', transparent: true, opacity: 0.83, roughness: 0.2, metalness: 0.05 });
  materials.add(waveMaterial);
  const wave = new THREE.Mesh(cube, waveMaterial);
  wave.castShadow = true;
  tsunami.add(wave);
  const waveCap = box(tsunami, '#e0fbff', 0, 0, 0, 73, 0.5, 1.2, false);
  const foam: THREE.Mesh[] = [];
  for (let i = 0; i < 25; i++) {
    foam.push(box(tsunami, i % 2 ? '#b6f1f7' : '#f0ffff', -36 + i * 3, 0, 0, 3.3, 0.7, 1.7, false));
  }
  tsunami.visible = false;

  const crackGroup = new THREE.Group();
  effects.add(crackGroup);
  const crackMeshes: THREE.Mesh[] = [];
  const crackMaterials: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 24; i++) {
    const mat = basic('#f68568', 0.65);
    const crack = new THREE.Mesh(cube, mat);
    crack.position.y = 0.09;
    crackGroup.add(crack);
    crackMeshes.push(crack);
    crackMaterials.push(mat);
  }
  crackGroup.visible = false;

  const meteorGroup = new THREE.Group();
  effects.add(meteorGroup);
  const meteorSlots: { group: THREE.Group; marker: THREE.Mesh; rock: THREE.Mesh; fire: THREE.Mesh; blast: THREE.Mesh }[] = [];
  for (let i = 0; i < 16; i++) {
    const group = new THREE.Group();
    const marker = new THREE.Mesh(keepGeometry(new THREE.RingGeometry(0.83, 1, 40)), basic('#ff745d', 0.85));
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.075;
    group.add(marker);
    const rock = new THREE.Mesh(keepGeometry(new THREE.DodecahedronGeometry(1.15, 0)), material('#744443'));
    rock.castShadow = true;
    group.add(rock);
    const fire = new THREE.Mesh(keepGeometry(new THREE.ConeGeometry(1.05, 5.5, 7)), basic('#ffc364', 0.9));
    group.add(fire);
    const blast = new THREE.Mesh(keepGeometry(new THREE.RingGeometry(0.7, 1, 32)), basic('#ffba74', 0.75));
    blast.rotation.x = -Math.PI / 2;
    blast.position.y = 0.14;
    group.add(blast);
    meteorGroup.add(group);
    meteorSlots.push({ group, marker, rock, fire, blast });
  }
  meteorGroup.visible = false;

  function makeAvatar(player: PlayerState): Avatar {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const skin = '#ffd5aa';
    box(body, player.color, 0, 1.36, 0, 0.99, 0.98, 0.57);
    box(body, '#ffffff', 0, 1.65, 0.302, 0.29, 0.08, 0.03, false);
    box(body, '#ffffff', 0, 1.48, 0.305, 0.09, 0.24, 0.03, false);
    box(body, skin, 0, 2.25, 0, 0.81, 0.81, 0.76);
    box(body, '#3d394c', 0, 2.66, -0.015, 0.84, 0.17, 0.8);
    box(body, '#3d394c', 0, 2.39, -0.34, 0.84, 0.43, 0.12);
    box(body, '#3d394c', -0.29, 2.5, 0.34, 0.2, 0.17, 0.08);
    box(body, '#394253', -0.17, 2.29, 0.386, 0.07, 0.09, 0.012, false);
    box(body, '#394253', 0.17, 2.29, 0.386, 0.07, 0.09, 0.012, false);
    box(body, '#be8669', 0, 2.08, 0.389, 0.2, 0.045, 0.012, false);
    function limb(x: number, y: number, leg: boolean): THREE.Group {
      const part = new THREE.Group();
      part.position.set(x, y, 0);
      body.add(part);
      if (leg) {
        box(part, '#394763', 0, -0.34, 0, 0.4, 0.68, 0.47);
        box(part, '#fbf6ee', 0, -0.75, 0.065, 0.42, 0.19, 0.62);
      } else {
        box(part, player.color, 0, -0.23, 0, 0.32, 0.49, 0.5);
        box(part, skin, 0, -0.59, 0, 0.3, 0.3, 0.46);
      }
      return part;
    }
    const leftArm = limb(-0.68, 1.81, false);
    const rightArm = limb(0.68, 1.81, false);
    const leftLeg = limb(-0.24, 0.85, true);
    const rightLeg = limb(0.24, 0.85, true);
    const ring = new THREE.Mesh(keepGeometry(new THREE.RingGeometry(0.72, 0.85, 36)), basic('#e6fff4', 0.8));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;
    group.add(ring);
    const name = label(player.name, '#ffffff', '#263348cb', 3.9, 0.78, 40);
    name.position.y = 3.3;
    group.add(name);
    group.position.set(player.x, player.y, player.z);
    body.rotation.y = player.rotation;
    root.add(group);
    return { group, body, leftArm, rightArm, leftLeg, rightLeg, ring, label: name, target: { ...player }, previous: group.position.clone(), name: player.name, color: player.color };
  }

  if (options.preview) {
    const demo: PlayerState[] = [
      { id: 'demo1', name: 'TY', color: '#a08bf2', x: -3.5, y: 0, z: 4, rotation: 0.3, alive: true, score: 0, grounded: true },
      { id: 'demo2', name: 'TWÓJ ZNAJOMY', color: '#f5a578', x: 3.2, y: 0, z: 2.5, rotation: -0.75, alive: true, score: 0, grounded: true },
      { id: 'demo3', name: 'MAYA', color: '#81ccb5', x: -5, y: 0, z: -4, rotation: 1.7, alive: true, score: 0, grounded: true },
    ];
    demo.forEach(p => avatars.set(p.id, makeAvatar(p)));
  }

  function tone(frequency: number, duration: number, type: OscillatorType = 'sine', finalFrequency?: number): void {
    if (muted) return;
    try {
      audioContext ??= new AudioContext();
      if (audioContext.state === 'suspended') void audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      if (finalFrequency) oscillator.frequency.exponentialRampToValueAtTime(finalFrequency, audioContext.currentTime + duration);
      gain.gain.setValueAtTime(0.04, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch { /* Sound is optional if a browser blocks AudioContext. */ }
  }

  function press(): void {
    if (options.preview) return;
    buttonDownUntil = performance.now() + 180;
    tone(210, 0.16, 'sine', 420);
    options.onPress();
  }

  function on<T extends EventTarget>(target: T, name: string, handler: EventListener, optionsArg?: AddEventListenerOptions): void {
    target.addEventListener(name, handler, optionsArg);
    listeners.push(() => target.removeEventListener(name, handler, optionsArg));
  }

  let pointerId: number | undefined;
  let previousPointerX = 0;
  let previousPointerY = 0;
  let movedPointer = 0;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const canvas = renderer.domElement;
  if (!options.preview) {
    on(window, 'keydown', ((event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyE'].includes(event.code)) event.preventDefault();
      keys.add(event.code);
      if (event.code === 'Space' && !event.repeat) { jumpQueued = true; tone(280, 0.08, 'sine', 460); }
      if (event.code === 'KeyE' && !event.repeat) press();
    }) as EventListener);
    on(window, 'keyup', ((event: KeyboardEvent) => { keys.delete(event.code); }) as EventListener);
    on(window, 'blur', (() => { keys.clear(); touchX = 0; touchZ = 0; }) as EventListener);
    on(canvas, 'contextmenu', (event => event.preventDefault()) as EventListener);
    on(canvas, 'pointerdown', ((event: PointerEvent) => {
      if (pointerId !== undefined) return;
      canvas.focus({ preventScroll: true });
      pointerId = event.pointerId;
      previousPointerX = event.clientX;
      previousPointerY = event.clientY;
      movedPointer = 0;
      canvas.setPointerCapture(event.pointerId);
    }) as EventListener);
    on(canvas, 'pointermove', ((event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - previousPointerX;
      const dy = event.clientY - previousPointerY;
      movedPointer += Math.abs(dx) + Math.abs(dy);
      yaw -= dx * 0.006;
      pitch = clamp(pitch + dy * 0.0045, 0.2, 1.15);
      previousPointerX = event.clientX;
      previousPointerY = event.clientY;
    }) as EventListener);
    on(canvas, 'pointerup', ((event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (movedPointer < 8 && event.button === 0) {
        const bounds = canvas.getBoundingClientRect();
        pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.intersectObjects([button, buttonTop]).length > 0) press();
      }
      pointerId = undefined;
    }) as EventListener);
    on(canvas, 'pointercancel', (() => { pointerId = undefined; }) as EventListener);
    on(canvas, 'wheel', ((event: WheelEvent) => {
      event.preventDefault();
      distance = clamp(distance + event.deltaY * 0.025, 12, 42);
    }) as EventListener, { passive: false });
  }

  const touchUi = document.createElement('div');
  touchUi.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;';
  if (!options.preview && matchMedia('(pointer: coarse)').matches) {
    const pad = document.createElement('div');
    pad.setAttribute('aria-label', 'Joystick ruchu');
    pad.style.cssText = 'position:absolute;bottom:26px;left:24px;width:112px;height:112px;border-radius:50%;border:2px solid #ffffff66;background:#21243855;pointer-events:auto;touch-action:none;backdrop-filter:blur(6px);';
    const knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;left:35px;top:35px;width:38px;height:38px;border-radius:50%;background:#ffffffaa;border:2px solid #ffffffdd;';
    pad.appendChild(knob);
    touchUi.appendChild(pad);
    let padPointer: number | undefined;
    const movePad = (event: PointerEvent) => {
      const rect = pad.getBoundingClientRect();
      let x = (event.clientX - rect.left - rect.width / 2) / 38;
      let z = (event.clientY - rect.top - rect.height / 2) / 38;
      const length = Math.hypot(x, z);
      if (length > 1) { x /= length; z /= length; }
      touchX = x;
      touchZ = z;
      knob.style.transform = `translate(${x * 34}px,${z * 34}px)`;
    };
    on(pad, 'pointerdown', ((event: PointerEvent) => { event.preventDefault(); padPointer = event.pointerId; pad.setPointerCapture(event.pointerId); movePad(event); }) as EventListener);
    on(pad, 'pointermove', ((event: PointerEvent) => { if (event.pointerId === padPointer) movePad(event); }) as EventListener);
    const resetPad = () => { padPointer = undefined; touchX = 0; touchZ = 0; knob.style.transform = ''; };
    on(pad, 'pointerup', resetPad as EventListener);
    on(pad, 'pointercancel', resetPad as EventListener);
    for (const [text, right, action] of [['SKOK', 22, () => { jumpQueued = true; }], ['PRZYCISK', 102, press]] as const) {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.style.cssText = `position:absolute;bottom:46px;right:${right}px;width:72px;height:72px;border-radius:50%;border:2px solid #ffffff88;background:#7260bed9;color:white;font:bold 11px system-ui;pointer-events:auto;touch-action:none;`;
      on(btn, 'pointerdown', ((event: PointerEvent) => { event.preventDefault(); action(); }) as EventListener);
      touchUi.appendChild(btn);
    }
    container.appendChild(touchUi);
  }

  function updateEffects(t: number, elapsed: number): void {
    const active = gameState?.phase === 'disaster';
    const kind = gameState?.disaster;
    tornado.visible = !!active && kind === 'tornado';
    tsunami.visible = !!active && kind === 'tsunami';
    crackGroup.visible = !!active && kind === 'earthquake';
    meteorGroup.visible = !!active && kind === 'meteors';
    if (!active || !gameState) return;
    const seed = gameState.seed;
    if (kind === 'tornado') {
      const position = tornadoAt(elapsed, seed);
      tornado.position.set(position.x, 0, position.z);
      tornado.rotation.y = t * 1.2;
      funnel.rotation.y = -t * 3;
      dust.scale.setScalar(1 + Math.sin(t * 4) * 0.14);
      vortexRings.forEach((ring, i) => {
        ring.position.x = Math.sin(t * 3 + i * 0.7) * (i / 18);
        ring.position.z = Math.cos(t * 3 + i * 0.7) * (i / 18);
        ring.rotation.z = Math.sin(t * 2 + i) * 0.05;
      });
      debris.forEach((chunk, i) => {
        const height = (i * 0.69 + t * 2.2) % 18;
        const radius = 1.2 + height * 0.3;
        const angle = i * 2.6 + t * (2.8 - height * 0.04);
        chunk.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
        chunk.rotation.set(t * 2 + i, t * 3 + i, t + i);
      });
    }
    if (kind === 'tsunami') {
      const z = tsunamiZ(elapsed);
      const height = Math.max(0.1, tsunamiHeight(elapsed));
      tsunami.position.set(0, 0, z);
      const floodedDepth = Math.max(0.1, z + 55);
      wave.position.set(0, height / 2 - 0.05, -floodedDepth / 2);
      wave.scale.set(74, height, floodedDepth);
      waveCap.position.set(0, height, 0);
      waveCap.scale.y = 0.7 + Math.sin(t * 4) * 0.1;
      foam.forEach((item, i) => {
        item.position.y = height + Math.sin(t * 4 + i * 0.8) * 0.3;
        item.position.z = Math.sin(t * 2 + i) * 0.4;
        item.rotation.z = Math.sin(t * 2 + i) * 0.1;
      });
    }
    if (kind === 'earthquake') {
      const cracks = quakeCracksAt(elapsed, seed);
      crackMeshes.forEach((mesh, i) => {
        const crack = cracks[i];
        mesh.visible = !!crack;
        if (!crack) return;
        mesh.position.set(crack.x, 0.085, crack.z);
        mesh.scale.set(crack.w, crack.active ? 0.12 : 0.025, crack.d);
        crackMaterials[i].color.set(crack.active ? '#ff663f' : '#ffb853');
        crackMaterials[i].opacity = crack.active ? 0.95 : 0.26 + (Math.sin(t * 12) + 1) * 0.2;
      });
    }
    if (kind === 'meteors') {
      const meteors = meteorsAt(elapsed, seed);
      meteorSlots.forEach((slot, i) => {
        const meteor = meteors[i];
        slot.group.visible = !!meteor;
        if (!meteor) return;
        slot.group.position.set(meteor.x, 0, meteor.z);
        const age = meteor.age;
        slot.marker.visible = age < 0.3;
        slot.marker.scale.setScalar(meteor.radius * (1 + Math.sin(t * 11) * 0.04));
        slot.rock.visible = age < 0;
        slot.fire.visible = age < 0;
        const h = Math.max(0.6, -age * 22);
        slot.rock.position.set(h * 0.18, h, 0);
        slot.rock.rotation.set(t * 2 + i, t * 3, i);
        slot.fire.position.set(h * 0.18 + 0.3, h + 3.1, 0);
        slot.fire.rotation.z = -0.18;
        slot.blast.visible = age >= 0;
        slot.blast.scale.setScalar(meteor.radius * (0.5 + Math.max(0, age) * 1.8));
        (slot.blast.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - Math.max(0, age) * 0.8);
      });
    }
  }

  function resize(): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  function animate(now: number): void {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const dt = Math.min(0.06, (now - lastTime) / 1000);
    lastTime = now;
    const time = now / 1000;
    const local = avatars.get(localId);
    if (!options.preview && now - lastInput > 1000 / 30) {
      let right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touchX;
      let forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - touchZ;
      const length = Math.hypot(right, forward);
      if (length > 1) { right /= length; forward /= length; }
      options.onInput({ x: Math.cos(yaw) * right - Math.sin(yaw) * forward, z: -Math.sin(yaw) * right - Math.cos(yaw) * forward, jump: jumpQueued || keys.has('Space') });
      jumpQueued = false;
      lastInput = now;
    }
    for (const [id, avatar] of avatars) {
      const player = avatar.target;
      avatar.previous.copy(avatar.group.position);
      const target = new THREE.Vector3(player.x, player.y, player.z);
      if (avatar.group.position.distanceToSquared(target) > 144) avatar.group.position.copy(target);
      else avatar.group.position.lerp(target, 1 - Math.exp(-dt * (id === localId ? 22 : 14)));
      const speed = avatar.group.position.distanceTo(avatar.previous) / Math.max(0.005, dt);
      const walk = Math.sin(time * 12) * Math.min(speed / 7, 1) * 0.72;
      avatar.leftLeg.rotation.x = walk;
      avatar.rightLeg.rotation.x = -walk;
      avatar.leftArm.rotation.x = -walk * 0.8;
      avatar.rightArm.rotation.x = walk * 0.8;
      avatar.body.rotation.y = dampAngle(avatar.body.rotation.y, player.rotation, 1 - Math.exp(-dt * 15));
      avatar.body.rotation.z = THREE.MathUtils.lerp(avatar.body.rotation.z, player.alive ? 0 : Math.PI / 2, 1 - Math.exp(-dt * 8));
      avatar.body.position.y = player.alive ? (options.preview ? Math.sin(time * 2 + player.x) * 0.04 : 0) : 0.35;
      avatar.ring.visible = id === localId || !!options.preview;
      avatar.label.visible = player.y > -8;
      avatar.group.visible = player.y > -18;
      if (!player.grounded && player.alive) {
        avatar.leftArm.rotation.z = 0.38;
        avatar.rightArm.rotation.z = -0.38;
      } else {
        avatar.leftArm.rotation.z = 0.06;
        avatar.rightArm.rotation.z = -0.06;
      }
    }

    if (options.preview) {
      yaw = 0.55 + Math.sin(time * 0.045) * 0.18;
      pitch = 0.64;
      cameraTarget.set(0, 1, -0.5);
    } else if (local) {
      const follow = local.group.position.clone();
      follow.y = Math.max(0, follow.y) + 1.5;
      if (!hasLocalCamera) { cameraTarget.copy(follow); hasLocalCamera = true; }
      else cameraTarget.lerp(follow, 1 - Math.exp(-dt * 7));
    }
    cameraOffset.set(Math.sin(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance);
    desiredCamera.copy(cameraTarget).add(cameraOffset);
    camera.position.copy(desiredCamera);
    if (gameState?.phase === 'disaster' && gameState.disaster === 'earthquake') {
      camera.position.x += Math.sin(time * 39) * 0.14;
      camera.position.y += Math.cos(time * 47) * 0.11;
    }
    camera.lookAt(cameraTarget);
    button.position.y = now < buttonDownUntil ? 0.6 : 0.81;
    buttonTop.position.y = now < buttonDownUntil ? 0.87 : 1.08;
    buttonRing.material = gameState?.phase === 'waiting' || !gameState ? ringReadyMaterial : ringBusyMaterial;
    buttonHint.visible = !!local && local.target.alive && (gameState?.phase === 'waiting') && Math.hypot(local.target.x - BUTTON.x, local.target.z - BUTTON.z) < 5;
    buttonTitle.visible = options.preview || !gameState || gameState.phase === 'waiting';
    if (buttonHint.visible) buttonHint.position.y = 3.7 + Math.sin(time * 3) * 0.08;
    flag.rotation.y = Math.sin(time * 2) * 0.13;
    clouds.forEach((cloud, i) => cloud.position.x += Math.sin(i + time * 0.05) * dt * 0.12);
    seaSparkles.forEach((sparkle, i) => sparkle.scale.x = 1.6 + i % 4 + Math.sin(time + i) * 0.5);
    const elapsed = gameState ? Math.max(0, (Date.now() - gameState.disasterStartedAt) / 1000) : 0;
    updateEffects(time, elapsed);
    renderer.render(scene, camera);
  }
  const ringReadyMaterial = buttonRing.material;
  const ringBusyMaterial = basic('#fcaaa3');
  frame = requestAnimationFrame(animate);
  options.onReady?.();

  return {
    setState(state: GameState, playerId: string): void {
      if (disposed) return;
      gameState = state;
      localId = playerId;
      const ids = new Set(state.players.map(player => player.id));
      for (const [id, avatar] of avatars) {
        if (!ids.has(id)) { root.remove(avatar.group); avatars.delete(id); }
      }
      for (const player of state.players) {
        let avatar = avatars.get(player.id);
        if (avatar && (avatar.name !== player.name || avatar.color !== player.color)) {
          root.remove(avatar.group);
          avatars.delete(player.id);
          avatar = undefined;
        }
        if (!avatar) { avatar = makeAvatar(player); avatars.set(player.id, avatar); }
        avatar.target = { ...player };
      }
      if (lastPhase !== state.phase) {
        if (state.phase === 'warning') { buttonDownUntil = performance.now() + 400; tone(540, 0.35, 'triangle', 220); }
        if (state.phase === 'disaster') tone(160, 0.7, 'sawtooth', 60);
        if (state.phase === 'results') tone(440, 0.45, 'sine', 880);
        lastPhase = state.phase;
      }
    },
    setMuted(value: boolean): void { muted = value; if (!muted) tone(520, 0.08); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      listeners.forEach(remove => remove());
      keys.clear();
      touchUi.remove();
      canvas.remove();
      for (const geometry of geometries) geometry.dispose();
      for (const mat of materials) mat.dispose();
      for (const texture of textures) texture.dispose();
      renderer.dispose();
      void audioContext?.close();
      avatars.clear();
    },
  };
}
