import * as THREE from "/three.js";
import { WORLD, OBSTACLES, isWalkable } from "/world-data.js";

const PALETTE = [
  "#d5a565",
  "#b7836c",
  "#71959a",
  "#889b70",
  "#a68eae",
  "#c27b66",
];
const hash = (value) =>
  [...String(value)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const mixAngle = (a, b, t) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.domElement.classList.add("game-canvas");
  if (!canvas) document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#a8b0bc");
  scene.fog = new THREE.FogExp2("#a8a9b8", 0.01);
  const camera = new THREE.PerspectiveCamera(
    62,
    innerWidth / innerHeight,
    0.075,
    160,
  );
  camera.rotation.order = "YXZ";
  scene.add(camera);
  scene.add(new THREE.HemisphereLight("#c4d9f2", "#887a6b", 2.3));
  const sun = new THREE.DirectionalLight("#ffcc9c", 3.5);
  sun.position.set(-20, 35, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -36,
    right: 36,
    top: 36,
    bottom: -36,
    near: 1,
    far: 90,
  });
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.00015;
  scene.add(sun);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader:
        "varying vec3 v;void main(){v=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "varying vec3 v;void main(){float h=normalize(v).y;vec3 low=vec3(.92,.66,.52);vec3 high=vec3(.16,.28,.43);gl_FragColor=vec4(mix(low,high,smoothstep(-.05,.8,h)),1.);}",
    }),
  );
  scene.add(sky);

  const mats = new Map(),
    batches = new Map();
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
    sphere: new THREE.SphereGeometry(1, 10, 8),
    cone: new THREE.ConeGeometry(1, 1, 10),
  };
  const material = (color, extra = {}) => {
    const key = color + JSON.stringify(extra);
    if (!mats.has(key))
      mats.set(
        key,
        new THREE.MeshStandardMaterial({ color, roughness: 0.87, ...extra }),
      );
    return mats.get(key);
  };
  function staticMesh(shape, color, x, y, z, sx, sy, sz, ry = 0, extra = {}) {
    const key = shape + color + JSON.stringify(extra);
    if (!batches.has(key))
      batches.set(key, { shape, mat: material(color, extra), items: [] });
    const d = new THREE.Object3D();
    d.position.set(x, y, z);
    d.scale.set(sx, sy, sz);
    d.rotation.y = ry;
    d.updateMatrix();
    batches.get(key).items.push(d.matrix.clone());
  }
  const box = (w, h, d, c, x, y, z, ry = 0, extra = {}) =>
    staticMesh("box", c, x, y, z, w, h, d, ry, extra);
  const cyl = (r, h, c, x, y, z) => staticMesh("cylinder", c, x, y, z, r, h, r);
  const ball = (r, c, x, y, z, sx = 1, sy = 1, sz = 1) =>
    staticMesh("sphere", c, x, y, z, r * sx, r * sy, r * sz);
  const colliderBoxes = [];
  function collider(x, y, z, w, h, d) {
    colliderBoxes.push(
      new THREE.Box3(
        new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
        new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
      ),
    );
  }
  // Individual pavers are instanced, so the textured square is inexpensive to render.
  box(54, 0.25, 54, "#9d9285", 0, -0.22, 0);
  const tiles = ["#bdafa0", "#c4b7a6", "#b4a794", "#cabbac", "#b9aa98"];
  for (let x = -24; x < 24; x += 1.2)
    for (let z = -24; z < 24; z += 1.2) {
      const k = Math.abs(Math.round(x * 7 + z * 11)) % 5;
      box(1.17, 0.075, 1.17, tiles[k], x + 0.6, -0.055, z + 0.6);
    }
  for (const x of [-23, 23]) box(0.25, 0.1, 46, "#ece0c7", x, 0.015, 0);
  for (const z of [-23, 23]) box(46, 0.1, 0.25, "#ece0c7", 0, 0.015, z);
  for (let i = -22; i <= 22; i += 2) {
    box(0.12, 0.012, 44, "#6a7f7a", i, 0.001, 0);
    box(44, 0.012, 0.12, "#6a7f7a", 0, 0.001, i);
  }
  const plazaRing = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.6, 64),
    material("#647e78"),
  );
  plazaRing.rotation.x = -Math.PI / 2;
  plazaRing.position.y = 0.02;
  scene.add(plazaRing);

  function sign(
    text,
    x,
    y,
    z,
    width,
    rotation = 0,
    bg = "#234d49",
    fg = "#ead6ab",
  ) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext("2d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 3;
    ctx.strokeRect(9, 9, 494, 110);
    ctx.fillStyle = fg;
    ctx.font = "bold 44px Georgia";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 65, 470);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 4),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
    );
    m.position.set(x, y, z);
    m.rotation.y = rotation;
    scene.add(m);
  }
  const buildingColors = [
    "#cfa589",
    "#e1c2a0",
    "#bd9b9c",
    "#a9b7ab",
    "#d9b08a",
    "#b6b9bc",
  ];
  const storeNames = [
    "CAFÉ LUNE",
    "LA POSTE",
    "FLEURISTE",
    "MAISON 24",
    "LE PETIT BAR",
    "BOUTIQUE",
  ];
  function building(x, z, width, height, rotation, index) {
    const color = buildingColors[index % buildingColors.length];
    const p = (a, b, c) =>
      new THREE.Vector3(a, b, c)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation)
        .add(new THREE.Vector3(x, 0, z));
    const b = (w, h, d, c, a, y, s, extra = {}) => {
      const q = p(a, y, s);
      box(w, h, d, c, q.x, q.y, q.z, rotation, extra);
    };
    b(width, height, 7, color, 0, height / 2, 0);
    b(width + 0.4, 0.36, 7.4, "#e2d2ba", 0, height - 0.05, 0);
    b(width + 0.15, 0.32, 7.15, "#f0dfc1", 0, 3.2, 0);
    b(width, 0.45, 7.1, "#827d73", 0, 0.22, 0);
    b(width + 0.15, 0.16, 7.2, "#8b7365", 0, height + 0.25, 0);
    b(width - 0.5, 0.4, 6.5, "#9b6e5e", 0, height + 0.5, 0);
    for (let floor = 4.4; floor < height - 1; floor += 2.6)
      for (let wx = -width / 2 + 1.25; wx < width / 2 - 0.5; wx += 2.3) {
        b(1.2, 1.65, 0.13, "#ebd9ba", wx, floor, 3.55);
        b(0.85, 1.34, 0.15, "#3e5960", wx, floor, 3.64);
        b(0.85, 0.04, 0.05, "#d6c7a6", wx, floor, 3.75);
        b(0.045, 1.35, 0.06, "#d6c7a6", wx, floor, 3.75);
        b(
          0.3,
          1.55,
          0.1,
          index % 2 ? "#52716b" : "#6f8382",
          wx - 0.75,
          floor,
          3.6,
        );
        b(
          0.3,
          1.55,
          0.1,
          index % 2 ? "#52716b" : "#6f8382",
          wx + 0.75,
          floor,
          3.6,
        );
        b(1.45, 0.12, 0.48, "#d8c6ab", wx, floor - 0.85, 3.7);
        if (index % 3 === 0) {
          b(1.7, 0.11, 0.85, "#bdb3a0", wx, floor - 0.9, 3.85);
          b(1.7, 0.07, 0.06, "#344f4d", wx, floor - 0.15, 4.23);
          for (let rail = -0.7; rail <= 0.7; rail += 0.28)
            b(0.035, 0.7, 0.035, "#344f4d", wx + rail, floor - 0.5, 4.23);
        }
        if (index % 3 === 1) {
          const q = p(wx, floor - 0.6, 3.9);
          box(0.8, 0.25, 0.3, "#ad735a", q.x, q.y, q.z, rotation);
          for (const a of [-0.25, 0, 0.25]) {
            const o = p(wx + a, floor - 0.35, 3.95);
            ball(0.19, "#6f8f62", o.x, o.y, o.z);
          }
        }
      }
    b(1.6, 2.5, 0.15, "#4d6864", 0, 1.45, 3.58);
    b(1.2, 1.8, 0.1, "#253b3d", 0, 1.6, 3.68);
    b(0.05, 1.8, 0.08, "#ab9473", 0, 1.6, 3.77);
    b(1.2, 0.05, 0.08, "#ab9473", 0, 1.7, 3.77);
    for (const side of [-1, 1]) {
      b(1.5, 1.8, 0.15, "#e2cda9", side * (width / 2 - 1.35), 1.5, 3.58);
      b(1.25, 1.55, 0.15, "#536962", side * (width / 2 - 1.35), 1.5, 3.69);
    }
    const awningColor = index % 2 ? "#a35e52" : "#3c736b";
    for (let aw = -width / 2 + 0.12; aw < width / 2; aw += 0.6)
      b(
        0.6,
        0.18,
        1.6,
        Math.round((aw + width / 2) / 0.6) % 2 ? "#e6d9bd" : awningColor,
        aw,
        2.9,
        4.1,
      );
    b(width, 0.3, 0.1, awningColor, 0, 2.78, 4.87);
    const s = p(0, 3.65, 3.74);
    sign(
      storeNames[index % 6],
      s.x,
      s.y,
      s.z,
      Math.min(4, width - 1),
      rotation,
    );
    // Rooftop chimney and aerial, silhouetted against the evening sky.
    b(0.6, 1.3, 0.7, "#8f8070", width / 3, height + 0.8, -1);
    b(0.9, 0.15, 1, "#b7a58e", width / 3, height + 1.5, -1);
    collider(x, height / 2, z, width, height, 7);
  }
  for (let i = 0; i < 6; i++) {
    const a = -22.5 + i * 9;
    building(a, -28, 8.85, 8.8 + (i % 3) * 2.2, 0, i);
    building(-a, 28, 8.85, 9.7 + ((i + 1) % 3) * 1.7, Math.PI, i + 3);
  }
  for (let i = 0; i < 5; i++) {
    const a = -18 + i * 9;
    building(-28, a, 8.85, 10 + (i % 3) * 1.4, Math.PI / 2, i + 7);
    building(28, -a, 8.85, 9 + ((i + 2) % 3) * 1.7, -Math.PI / 2, i + 4);
  }
  // Fountain, the focal point of the square.
  cyl(2.7, 0.35, "#b5b2a2", 0, 0.17, 0);
  cyl(2.48, 0.18, "#e1d5bc", 0, 0.38, 0);
  cyl(2.25, 0.14, "#638f89", 0, 0.5, 0);
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 0.035, 64),
    new THREE.MeshStandardMaterial({
      color: "#84beb7",
      roughness: 0.2,
      metalness: 0.35,
      transparent: true,
      opacity: 0.83,
    }),
  );
  water.position.y = 0.59;
  scene.add(water);
  cyl(0.58, 0.8, "#d7c7aa", 0, 0.85, 0);
  cyl(1.15, 0.16, "#e2d2b5", 0, 1.3, 0);
  cyl(0.38, 0.9, "#c8b89a", 0, 1.7, 0);
  cyl(0.7, 0.15, "#e3d4bc", 0, 2.12, 0);
  ball(0.22, "#b0aa8d", 0, 2.36, 0);
  const drops = [];
  const dropGeo = new THREE.SphereGeometry(0.035, 5, 4),
    dropMat = material("#c4e8dd", {
      transparent: true,
      opacity: 0.7,
      roughness: 0.1,
    });
  for (let i = 0; i < 40; i++) {
    const d = new THREE.Mesh(dropGeo, dropMat);
    d.userData = { a: (i / 40) * Math.PI * 2, p: i * 0.37 };
    scene.add(d);
    drops.push(d);
  }
  for (const r of [1.45, 1.9]) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.012, 4, 64),
      material("#c4e1d2", { transparent: true, opacity: 0.4 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.615;
    scene.add(ring);
  }

  function tree(x, z, r = 1.55) {
    cyl(0.18, 2.8, "#77654f", x, 1.5, z);
    ball(r, "#6b8a65", x, 3.5, z, 1, 1.18, 1);
    ball(r * 0.72, "#87a071", x - 0.7, 3.3, z + 0.4);
    ball(r * 0.67, "#53785c", x + 0.6, 3.6, z - 0.5);
    cyl(0.75, 0.06, "#9f9d88", x, 0.07, z);
    // The camera boom must clear the canopy as well as the planter underneath it.
    // Slight padding covers the camera near plane, not just its centre ray.
    collider(x, 1.5, z, 0.66, 2.8, 0.66);
    collider(x, 3.5, z, r * 2 + 0.3, r * 2.36 + 0.3, r * 2 + 0.3);
    collider(x - 0.7, 3.3, z + 0.4, r * 1.44 + 0.3, r * 1.44 + 0.3, r * 1.44 + 0.3);
    collider(x + 0.6, 3.6, z - 0.5, r * 1.34 + 0.3, r * 1.34 + 0.3, r * 1.34 + 0.3);
  }
  WORLD.planters.forEach((p, i) => {
    box(p.w, 0.65, p.d, "#9e9a87", p.x, 0.33, p.z);
    box(p.w + 0.12, 0.12, p.d + 0.12, "#d4cab1", p.x, 0.69, p.z);
    box(p.w - 0.24, 0.05, p.d - 0.25, "#6c7760", p.x, 0.77, p.z);
    for (const dx of [-1.1, 1.1]) {
      tree(p.x + dx, p.z, 1.05);
      for (let k = 0; k < 4; k++)
        ball(
          0.23,
          k % 2 ? "#b7a471" : "#698558",
          p.x + dx + Math.sin(k * 2.4) * 0.6,
          0.9,
          p.z + Math.cos(k * 2.4) * 0.5,
        );
    }
  });
  WORLD.benches.forEach((p) => {
    for (let s = -0.3; s <= 0.3; s += 0.15)
      box(p.w, 0.13, 0.11, "#9f7854", p.x, 0.56, p.z + s);
    box(p.w, 0.18, 0.15, "#a7835c", p.x, 1.0, p.z + 0.35);
    box(p.w, 0.18, 0.15, "#a7835c", p.x, 0.79, p.z + 0.35);
    for (const x of [-1, 1]) {
      box(0.12, 0.6, 0.65, "#3e5850", p.x + x, 0.28, p.z);
      box(0.12, 0.9, 0.1, "#3e5850", p.x + x, 0.65, p.z + 0.35);
    }
  });
  WORLD.kiosks.forEach((p, i) => {
    box(p.w, 2.6, p.d, "#547872", p.x, 1.3, p.z);
    box(p.w + 0.25, 0.3, p.d + 0.25, "#e0c9a5", p.x, 2.75, p.z);
    for (const z of [-1, 1]) {
      box(p.w - 0.55, 1.2, 0.12, "#2c4244", p.x, 1.6, p.z + (z * p.d) / 2);
      box(
        p.w - 0.25,
        0.15,
        0.7,
        "#c49a71",
        p.x,
        0.95,
        p.z + z * (p.d / 2 + 0.2),
      );
    }
    for (let x = -p.w / 2; x < p.w / 2; x += 0.45)
      box(
        0.45,
        0.18,
        p.d + 1.3,
        Math.round((x + p.w / 2) / 0.45) % 2
          ? "#dbcbae"
          : i
            ? "#a46458"
            : "#46796c",
        p.x + x,
        2.9,
        p.z,
      );
    sign(
      i ? "LE JOURNAL" : "CAFÉ À EMPORTER",
      p.x,
      2.48,
      p.z + p.d / 2 + 0.08,
      3.4,
    );
    for (let k = 0; k < 4; k++)
      box(
        0.42,
        0.6,
        0.1,
        ["#d2ae77", "#b77965", "#9eab92", "#b9a3a5"][k],
        p.x - 1.05 + k * 0.7,
        1.58,
        p.z + p.d / 2 + 0.1,
      );
  });
  // Street lamps and warm emissive glass. Local light pools avoid costly shadowed point lights.
  for (const [x, z] of [
    [-19, -18],
    [0, -20],
    [19, -18],
    [-19, 18],
    [0, 20],
    [19, 18],
    [-20, -7],
    [20, 7],
  ]) {
    cyl(0.28, 0.22, "#4e6159", x, 0.11, z);
    cyl(0.07, 4.5, "#43594f", x, 2.35, z);
    box(0.65, 0.12, 0.65, "#304b43", x, 4.72, z);
    box(0.38, 0.58, 0.38, "#ffe3a2", x, 4.35, z, 0, {
      emissive: "#ffd280",
      emissiveIntensity: 1.2,
    });
    box(0.58, 0.12, 0.58, "#304b43", x, 4.02, z);
    for (const dx of [-0.22, 0.22])
      for (const dz of [-0.22, 0.22])
        box(0.035, 0.65, 0.035, "#304b43", x + dx, 4.35, z + dz);
    if (Math.abs(z) === 18) {
      const light = new THREE.PointLight("#ffbc6d", 5, 8, 2);
      light.position.set(x, 3.8, z);
      scene.add(light);
    }
  }
  // Café tables remain outside the navigable square, keeping simulation and rendering consistent.
  for (const side of [-1, 1])
    for (const x of [-16, -7, 7, 16]) {
      const z = side * 23.5;
      cyl(0.7, 0.1, "#e4cfaa", x, 0.92, z);
      cyl(0.06, 0.9, "#3f5b50", x, 0.45, z);
      cyl(0.35, 0.07, "#3f5b50", x, 0.04, z);
      for (const dx of [-1, 1]) {
        box(0.55, 0.12, 0.55, "#667b65", x + dx, 0.47, z);
        box(0.55, 0.5, 0.1, "#6c856c", x + dx, 0.77, z + 0.28);
        for (const dz of [-0.2, 0.2])
          box(0.07, 0.45, 0.07, "#40594e", x + dx, 0.22, z + dz);
      }
    }
  // Festoon lights bring the skyline down to a human scale.
  const wireMat = new THREE.LineBasicMaterial({ color: "#52645b" });
  for (const z of [-13, 13]) {
    const points = [];
    for (let k = 0; k <= 30; k++) {
      const x = -24 + k * 1.6;
      const y = 6.2 + (x / 24) ** 2 * 2;
      points.push(new THREE.Vector3(x, y, z));
      if (k % 2 === 0) {
        box(0.035, 0.22, 0.035, "#576251", x, y - 0.1, z);
        ball(0.11, "#ffe7ac", x, y - 0.3, z);
      }
    }
    scene.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), wireMat),
    );
  }
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(
      geometries[batch.shape],
      batch.mat,
      batch.items.length,
    );
    batch.items.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
  for (const o of OBSTACLES) {
    if (o.type === "box") collider(o.x, 1, o.z, o.w, 2, o.d);
    else collider(o.x, 0.75, o.z, o.radius * 2, 1.5, o.radius * 2);
  }

  const avatars = new Map();
  const attract = Array.from({ length: 30 }, (_, i) => {
    let x = Math.sin(i * 2.39) * (6 + (i % 12)),
      z = Math.cos(i * 2.39) * (6 + (i % 12));
    if (!isWalkable(x, z)) {
      x = 7;
      z = -15 + i * 0.3;
    }
    return { id: `attract-${i}`, x, z, yaw: i * 1.2, state: "walk" };
  });
  const bodyGeo = new THREE.CapsuleGeometry(0.265, 0.48, 4, 8),
    headGeo = new THREE.SphereGeometry(0.245, 12, 10),
    limbGeo = new THREE.CapsuleGeometry(0.085, 0.38, 3, 6),
    shoeGeo = new THREE.BoxGeometry(0.19, 0.16, 0.34);
  const skin = material("#dfb497"),
    dark = material("#334548"),
    hair = material("#554739");
  const avatarMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.87,
  });
  const shadowGeo = new THREE.CircleGeometry(0.42, 16),
    shadowMat = new THREE.MeshBasicMaterial({
      color: "#334d43",
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
  function mesh(g, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  }
  // Bake rigid parts together while retaining the six joints used by animation.
  // Colours are stored on vertices, allowing eyes, hats, skin and clothing to share a draw call.
  function mergeAvatarParts(group) {
    const parts = group.children.filter(
      (child) => child.isMesh && child.material.isMeshStandardMaterial,
    );
    if (!parts.length) return;
    const positions = [],
      normals = [],
      colors = [],
      indices = [];
    const v = new THREE.Vector3(),
      n = new THREE.Vector3(),
      normalMatrix = new THREE.Matrix3();
    let offset = 0;
    for (const part of parts) {
      part.updateMatrix();
      normalMatrix.getNormalMatrix(part.matrix);
      const geo = part.geometry,
        pos = geo.getAttribute("position"),
        normal = geo.getAttribute("normal"),
        color = part.material.color;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(part.matrix);
        positions.push(v.x, v.y, v.z);
        n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
        normals.push(n.x, n.y, n.z);
        colors.push(color.r, color.g, color.b);
      }
      if (geo.index)
        for (let i = 0; i < geo.index.count; i++)
          indices.push(geo.index.getX(i) + offset);
      else for (let i = 0; i < pos.count; i++) indices.push(i + offset);
      offset += pos.count;
      group.remove(part);
      if (![bodyGeo, headGeo, limbGeo, shoeGeo, shadowGeo].includes(geo))
        geo.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const combined = new THREE.Mesh(geometry, avatarMaterial);
    combined.castShadow = true;
    combined.receiveShadow = true;
    group.add(combined);
  }
  function makeAvatar(p) {
    const seed = hash(p.id),
      g = new THREE.Group(),
      rig = new THREE.Group();
    g.add(rig);
    const coat = material(
      p.role === "hunter" ? "#304a58" : PALETTE[seed % PALETTE.length],
    );
    mesh(rig, bodyGeo, coat, 0, 0.98, 0);
    mesh(
      rig,
      new THREE.CylinderGeometry(0.22, 0.28, 0.32, 8),
      coat,
      0,
      0.65,
      0,
    );
    const head = new THREE.Group();
    head.position.y = 1.57;
    rig.add(head);
    mesh(head, headGeo, skin, 0, 0, 0);
    mesh(head, new THREE.BoxGeometry(0.12, 0.09, 0.12), skin, 0, -0.015, -0.24);
    for (const x of [-0.085, 0.085]) {
      mesh(head, new THREE.SphereGeometry(0.034, 6, 4), dark, x, 0.035, -0.225);
      mesh(
        head,
        new THREE.BoxGeometry(0.075, 0.025, 0.04),
        hair,
        x,
        0.105,
        -0.22,
      );
    }
    if (seed % 3 !== 1)
      mesh(
        head,
        new THREE.BoxGeometry(0.16, 0.045, 0.035),
        hair,
        0,
        -0.095,
        -0.235,
      );
    // Everyone shares the same hat silhouette; the scanner identifies the hunter.
    mesh(
      head,
      new THREE.CylinderGeometry(0.32, 0.32, 0.065, 12),
      p.role === "hunter" ? dark : material("#637b6c"),
      0,
      0.22,
      0,
    );
    mesh(
      head,
      new THREE.CylinderGeometry(0.22, 0.25, 0.19, 12),
      p.role === "hunter" ? dark : material("#637b6c"),
      0,
      0.32,
      0,
    );
    mesh(
      head,
      new THREE.CylinderGeometry(0.252, 0.252, 0.045, 12),
      material("#bba777"),
      0,
      0.26,
      0,
    );
    mesh(
      rig,
      new THREE.BoxGeometry(0.29, 0.1, 0.43),
      material(p.role === "hunter" ? "#d6936c" : "#e8cfa4"),
      0,
      1.27,
      -0.035,
    );
    const arms = [],
      legs = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.335, 1.2, 0);
      rig.add(arm);
      mesh(arm, limbGeo, coat, side * 0.035, -0.22, 0);
      mesh(
        arm,
        new THREE.SphereGeometry(0.09, 6, 6),
        skin,
        side * 0.035,
        -0.48,
        0,
      );
      arms.push(arm);
      const leg = new THREE.Group();
      leg.position.set(side * 0.14, 0.64, 0);
      rig.add(leg);
      mesh(leg, limbGeo, dark, 0, -0.22, 0);
      mesh(leg, shoeGeo, material("#514a40"), 0, -0.5, -0.06);
      legs.push(leg);
    }
    for (const joint of [rig, head, ...arms, ...legs]) mergeAvatarParts(joint);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    g.add(shadow);
    scene.add(g);
    g.position.set(p.x || 0, 0, p.z || 0);
    g.userData = { rig, head, arms, legs, seed, role: p.role };
    return g;
  }
  // First-person hand-held scanner, not a gun: the hunter is looking for a tell.
  const tool = new THREE.Group();
  camera.add(tool);
  tool.position.set(0.35, -0.3, -0.75);
  tool.scale.setScalar(0.6);
  tool.rotation.set(0.08, -0.16, -0.08);
  const toolBody = mesh(
    tool,
    new THREE.BoxGeometry(0.22, 0.31, 0.13),
    material("#344b50"),
    0,
    0,
    0,
  );
  toolBody.castShadow = false;
  mesh(
    tool,
    new THREE.BoxGeometry(0.17, 0.16, 0.015),
    material("#96e4bd", { emissive: "#4cbd93", emissiveIntensity: 0.6 }),
    0,
    0.04,
    0.075,
  );
  mesh(
    tool,
    new THREE.BoxGeometry(0.19, 0.025, 0.025),
    material("#d9bc81"),
    0,
    0.145,
    0,
  );
  mesh(
    tool,
    new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6),
    dark,
    0.075,
    0.23,
    0,
  );
  mesh(
    tool,
    new THREE.BoxGeometry(0.08, 0.03, 0.018),
    material("#e8b16d"),
    0,
    -0.09,
    -0.075,
  );
  mesh(tool, new THREE.CapsuleGeometry(0.07, 0.16, 3, 6), skin, 0, -0.19, 0.04);
  mesh(
    tool,
    new THREE.CapsuleGeometry(0.075, 0.35, 3, 6),
    material("#304a58"),
    0.015,
    -0.42,
    0.12,
  );
  const sharedAvatarGeometries = new Set([
    bodyGeo,
    headGeo,
    limbGeo,
    shoeGeo,
    shadowGeo,
  ]);
  function removeAvatar(g) {
    scene.remove(g);
    g.traverse((o) => {
      if (o.geometry && !sharedAvatarGeometries.has(o.geometry))
        o.geometry.dispose();
    });
  }
  const effects = [],
    seen = new Set(),
    caughtAt = new Map();
  let scannerKick = 0;
  const fxGeo = new THREE.RingGeometry(0.92, 1, 64);
  const ray = new THREE.Ray();
  function effect(e, room, me, view) {
    if (e.type === "caught") caughtAt.set(e.targetId, e.at || Date.now());
    if (e.type === "tag") {
      if (e.playerId === me?.id) scannerKick = 0.15;
      const victim = [...(room?.npcs || []), ...(room?.players || [])].find(
        (p) => p.id === e.targetId,
      );
      const start = new THREE.Vector3(e.x, 1.35, e.z),
        pitch = e.playerId === me?.id ? view.pitch || 0 : 0;
      const end = victim
        ? new THREE.Vector3(victim.x, 1.1, victim.z)
        : new THREE.Vector3(
            e.x - Math.sin(e.yaw) * 19,
            1.55 + Math.sin(pitch) * 19,
            e.z - Math.cos(e.yaw) * 19,
          );
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([start, end]),
        new THREE.LineBasicMaterial({
          color: "#b0f6da",
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        }),
      );
      scene.add(line);
      effects.push({ mesh: line, age: 0, kind: "beam" });
    }
    if (e.type === "pulse" || e.type === "decoy") {
      const m = new THREE.Mesh(
        fxGeo,
        new THREE.MeshBasicMaterial({
          color: e.type === "pulse" ? "#efd39b" : "#79d9bb",
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(e.x, 0.12, e.z);
      scene.add(m);
      effects.push({ mesh: m, age: 0, kind: e.type });
      const spark = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.16, 0),
        material("#f0d5a5", {
          emissive: "#efd39b",
          emissiveIntensity: 2,
        }).clone(),
      );
      spark.position.set(e.x, 0.35, e.z);
      scene.add(spark);
      effects.push({ mesh: spark, age: 0, kind: "spark" });
    }
  }
  let currentQuality = "high",
    initializedCamera = false;
  const target = new THREE.Vector3(),
    desired = new THREE.Vector3(),
    direction = new THREE.Vector3(),
    hit = new THREE.Vector3();
  function update(room, me, view = {}, dt = 0.016, time = 0) {
    if (view.quality && view.quality !== currentQuality) {
      currentQuality = view.quality;
      renderer.setPixelRatio(
        currentQuality === "low" ? 1 : Math.min(devicePixelRatio, 1.7),
      );
      renderer.shadowMap.enabled = currentQuality !== "low";
      renderer.setSize(innerWidth, innerHeight);
    }
    water.rotation.y = time * 0.08;
    drops.forEach((d, i) => {
      const u = (time * 0.6 + d.userData.p) % 1,
        r = 0.15 + u * 1.8;
      d.position.set(
        Math.sin(d.userData.a) * r,
        2.45 + Math.sin(u * Math.PI) * 0.55 - u * 1.8,
        Math.cos(d.userData.a) * r,
      );
      d.scale.y = 1.8;
    });
    const entities = room
      ? [...(room.npcs || []), ...(room.players || [])]
      : [];
    // Populate the attract screen, even before connecting to the server.
    if (!entities.length)
      for (const p of attract) {
        const x = p.x - Math.sin(p.yaw) * dt * 1.1,
          z = p.z - Math.cos(p.yaw) * dt * 1.1;
        if (isWalkable(x, z)) {
          p.x = x;
          p.z = z;
        } else p.yaw += dt * 5;
      }
    const display = entities.length ? entities : attract;
    for (const e of room?.events || []) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        if (Date.now() - (e.at || 0) < 3000) effect(e, room, me, view);
      }
    }
    if (seen.size > 300) {
      seen.clear();
      for (const e of room?.events || []) seen.add(e.id);
    }
    const present = new Set(display.map((p) => p.id));
    for (const [id, g] of avatars)
      if (!present.has(id)) {
        removeAvatar(g);
        avatars.delete(id);
      }
    for (const p of display) {
      let g = avatars.get(p.id);
      if (g && g.userData.role !== p.role) {
        removeAvatar(g);
        avatars.delete(p.id);
        g = null;
      }
      if (!g) {
        g = makeAvatar(p);
        avatars.set(p.id, g);
      }
      const self = me && p.id === me.id;
      const fall = (Date.now() - (caughtAt.get(p.id) || 0)) / 1000;
      const falling = p.alive === false && fall < 1.25;
      g.visible =
        (p.alive !== false || falling) &&
        !(self && view.playing && view.firstPerson);
      g.scale.setScalar(
        falling ? Math.max(0.01, 1 - Math.max(0, fall - 0.85) / 0.4) : 1,
      );
      const blend = self ? Math.min(1, dt * 22) : Math.min(1, dt * 13);
      g.position.x = THREE.MathUtils.lerp(g.position.x, p.x, blend);
      g.position.z = THREE.MathUtils.lerp(g.position.z, p.z, blend);
      g.rotation.y = mixAngle(g.rotation.y, p.yaw || 0, Math.min(1, dt * 16));
      const { rig, head, arms, legs, seed } = g.userData;
      const move = ["walk", "run", "panic"].includes(p.state),
        panic = p.state === "panic",
        interact = p.state === "interact";
      const speed = panic ? 15 : p.state === "run" ? 12 : 7;
      const stride = Math.sin(time * speed + (seed % 10));
      rig.position.y = move
        ? Math.abs(stride) * (panic ? 0.14 : 0.045)
        : Math.sin(time * 2 + seed) * 0.012;
      rig.rotation.z = panic
        ? Math.sin(time * 9 + seed) * 0.12
        : move
          ? stride * 0.025
          : 0;
      rig.rotation.x = panic ? -0.12 : 0;
      legs.forEach((l, i) => {
        l.rotation.x = move ? stride * (i ? 1 : -1) * (panic ? 0.9 : 0.5) : 0;
      });
      arms.forEach((a, i) => {
        a.rotation.x = panic
          ? -1.8 + Math.sin(time * 13 + i) * 0.4
          : interact
            ? -0.8 + Math.sin(time * 3) * 0.15
            : move
              ? stride * (i ? -1 : 1) * 0.4
              : 0;
        a.rotation.z = panic ? (i ? -0.7 : 0.7) : i ? -0.08 : 0.08;
      });
      head.rotation.y = interact
        ? Math.sin(time * 2 + seed) * 0.25
        : Math.sin(time * 0.7 + seed) * 0.045;
      if (falling) {
        const f = Math.min(1, fall / 0.6);
        rig.rotation.z =
          (seed % 2 ? 1 : -1) * Math.sin((f * Math.PI) / 2) * 1.52;
        rig.rotation.x = 0.15;
        rig.position.y = 0.1;
        arms.forEach((a, i) => {
          a.rotation.x = -1.8;
          a.rotation.z = (i ? 1 : -1) * 0.6;
        });
        legs.forEach(
          (l, i) => (l.rotation.x = Math.sin(fall * 18 + i * 2) * 0.5),
        );
      }
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.age += dt;
      const span = e.kind === "beam" ? 0.18 : e.kind === "spark" ? 0.6 : 1.2;
      if (e.age > span) {
        scene.remove(e.mesh);
        e.mesh.material.dispose();
        if (e.mesh.geometry !== fxGeo) e.mesh.geometry.dispose();
        effects.splice(i, 1);
        continue;
      }
      if (e.kind === "spark") {
        e.mesh.position.y = 0.4 + Math.sin(e.age * 5) * 0.3;
        e.mesh.scale.setScalar(1 + e.age * 2);
      } else if (e.kind === "beam") {
        e.mesh.material.opacity = (1 - e.age / span) * 0.85;
      } else {
        e.mesh.scale.setScalar(0.3 + e.age * 9);
        e.mesh.material.opacity = (1 - e.age / span) * 0.8;
      }
    }
    const playing = view.playing && me;
    tool.visible = !!(playing && view.firstPerson && me.alive !== false);
    if (playing) {
      const mine = avatars.get(me.id);
      target.set(mine?.position.x ?? me.x, 1.55, mine?.position.z ?? me.z);
      if (view.firstPerson) {
        camera.position.copy(target);
        camera.position.y += view.reducedMotion
          ? 0
          : Math.sin(time * 9) *
            (["walk", "run"].includes(me.state) ? 0.025 : 0.005);
        camera.rotation.set(view.pitch || 0, view.yaw || 0, 0, "YXZ");
        if (view.shake && !view.reducedMotion) {
          camera.rotation.z = Math.sin(time * 42) * view.shake * 0.035;
          camera.rotation.x += Math.sin(time * 37) * view.shake * 0.025;
        }
        scannerKick = Math.max(0, scannerKick - dt);
        tool.position.y =
          -0.3 + (view.reducedMotion ? 0 : Math.sin(time * 7) * 0.004);
        tool.position.z = -0.75 + scannerKick * 0.35;
      } else {
        const yaw = view.yaw || 0,
          pitch = THREE.MathUtils.clamp((view.pitch || 0) - 0.32, -1.3, 0.14),
          dist = 5.7;
        desired
          .set(
            Math.sin(yaw) * Math.cos(pitch) * dist,
            -Math.sin(pitch) * dist,
            Math.cos(yaw) * Math.cos(pitch) * dist,
          )
          .add(target);
        direction.copy(desired).sub(target);
        let distance = direction.length();
        direction.normalize();
        ray.set(target, direction);
        for (const b of colliderBoxes) {
          // intersectBox returns an exit point when the ray starts inside a box.
          // That exit is not a safe obstruction distance for a camera boom.
          if (b.containsPoint(target)) continue;
          if (ray.intersectBox(b, hit)) {
            const d = Math.max(0.15, hit.distanceTo(target) - 0.35);
            if (d < distance) distance = d;
          }
        }
        desired.copy(target).addScaledVector(direction, Math.max(0.15, distance));
        if (mine && distance < 0.9) mine.visible = false;
        camera.position.copy(desired);
        camera.lookAt(target);
      }
      initializedCamera = true;
    } else {
      const t = time * 0.035;
      desired.set(
        Math.sin(t + 0.7) * 32,
        20 + Math.sin(t * 0.7) * 2,
        Math.cos(t + 0.7) * 32,
      );
      if (!initializedCamera) {
        camera.position.copy(desired);
        initializedCamera = true;
      } else camera.position.lerp(desired, Math.min(1, dt * 2));
      camera.lookAt(-1, 1, 0);
    }
    renderer.render(scene, camera);
  }
  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  addEventListener("resize", resize);
  return { renderer, scene, camera, update, resize };
}
