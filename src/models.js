import * as THREE from 'three';

// Every visible mark in these toys is geometry: no billboards, textures or sprites.
const INK = 0x173f43;
const palette = {
  ink: INK, teal: 0x18a599, mint: 0x83dbc7, yellow: 0xffd15e,
  orange: 0xff914d, pink: 0xfb8198, cream: 0xfff3d9,
  skin: 0xffcb9f, white: 0xfffff5, blue: 0x91c8e6,
};
const materials = new Map();
const geometryCache = new Map();
const sharedGeometries = new WeakSet();
let instanceGeometryScope = 0;
const inkMaterial = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

function material(color, metalness = 0, roughness = 0.37) {
  const key = `${color}:${metalness}:${roughness}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({
    color, metalness, roughness,
  }));
  return materials.get(key);
}

function cached(key, make) {
  // Seeded collectibles have effectively unbounded dimensions. Their geometry
  // belongs to the collectible instead of growing the fixed-toy cache forever.
  if (instanceGeometryScope > 0) return make();
  if (!geometryCache.has(key)) {
    const geometry = make();
    sharedGeometries.add(geometry);
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}

function mesh(geometry, color, { outline = true, metalness = 0, roughness = 0.37 } = {}) {
  const result = new THREE.Mesh(geometry, material(color, metalness, roughness));
  // A model owns procedural paths, but cached primitives are shared across toys.
  // The outline references its parent's geometry and must not dispose it twice.
  result.userData.ownedGeometry = !sharedGeometries.has(geometry);
  result.castShadow = true;
  result.receiveShadow = true;
  if (outline) {
    const hull = new THREE.Mesh(geometry, inkMaterial);
    hull.scale.setScalar(1.035);
    hull.userData.isOutline = true;
    result.add(hull);
  }
  return result;
}

function add(parent, object, x = 0, y = 0, z = 0) {
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}

function sphere(radius, color, options = {}) {
  return mesh(cached(`sphere:${radius}`, () => new THREE.SphereGeometry(radius, 20, 14)), color, options);
}

function cylinder(top, bottom, height, color, options = {}) {
  return mesh(cached(`cyl:${top}:${bottom}:${height}`, () => new THREE.CylinderGeometry(top, bottom, height, 16)), color, options);
}

function roundedGeometry(width, height, depth, radius = 0.12) {
  const r = Math.min(radius, width / 2 - 0.001, height / 2 - 0.001);
  const key = `rounded:${width}:${height}:${depth}:${r}`;
  return cached(key, () => {
    const x = -width / 2, y = -height / 2;
    const shape = new THREE.Shape();
    shape.moveTo(x + r, y);
    shape.lineTo(x + width - r, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + r);
    shape.lineTo(x + width, y + height - r);
    shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    shape.lineTo(x + r, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    const bevel = Math.min(0.035, depth * 0.15, r * 0.25);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: depth - bevel * 2, bevelEnabled: true, bevelSegments: 2,
      steps: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 4,
    });
    geometry.translate(0, 0, -depth / 2 + bevel);
    return geometry;
  });
}

function box(w, h, d, color, radius = 0.08, options = {}) {
  return mesh(roundedGeometry(w, h, d, radius), color, options);
}

function tube(points, radius, color, options = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 5), radius, 6, false), color, options);
}

function extrude(shape, depth, color, options = {}) {
  const bevel = Math.min(depth * 0.2, 0.055);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * bevel, steps: 1, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10,
  });
  geometry.translate(0, 0, -depth / 2 + bevel);
  return mesh(geometry, color, options);
}

function polygon(points, depth, color, options = {}) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  return extrude(shape, depth, color, options);
}

function face(parent, y = 0, z = 0.55, size = 1) {
  for (const sign of [-1, 1]) {
    const eye = add(parent, sphere(0.065, INK, { outline: false }), sign * 0.19 * size, y + 0.065 * size, z);
    eye.scale.set(size * 0.85, size * 1.18, size * 0.65);
    const cheek = add(parent, sphere(0.10, palette.pink, { outline: false }), sign * 0.32 * size, y - 0.08 * size, z - 0.01);
    cheek.scale.set(size, size * 0.55, size * 0.3);
  }
  add(parent, tube([[-0.10 * size, y - 0.09 * size, z], [0, y - 0.15 * size, z + 0.01], [0.10 * size, y - 0.09 * size, z]], 0.023 * size, INK, { outline: false }));
}

/** Five solid meshes, centred at the origin, with the camera lens facing +Z. */
export function createCameraIcon() {
  const camera = new THREE.Group();
  camera.name = 'citizen-card-camera';
  const simple = { outline: false };
  add(camera, box(1.44, 0.84, 0.40, 0x74b6a6, 0.15, simple), 0, -0.065, 0);
  const rim = add(camera, cylinder(0.30, 0.30, 0.14, palette.cream, simple), 0.06, -0.065, 0.245);
  rim.rotation.x = Math.PI / 2;
  const lens = add(camera, cylinder(0.225, 0.225, 0.046, 0x2f6266, { outline: false, metalness: 0.2, roughness: 0.24 }), 0.06, -0.065, 0.327);
  lens.rotation.x = Math.PI / 2;
  const highlight = add(camera, cylinder(0.06, 0.06, 0.012, palette.white, simple), -0.015, 0.015, 0.359);
  highlight.rotation.x = Math.PI / 2;
  add(camera, box(0.25, 0.12, 0.22, palette.cream, 0.04, simple), 0.40, 0.45, -0.015);
  const center = new THREE.Box3().setFromObject(camera, true).getCenter(new THREE.Vector3());
  for (const part of camera.children) part.position.sub(center);
  return camera;
}

/** A fictional, friendly construction helper, approximately three world units tall. */
export function createWorker() {
  const worker = new THREE.Group();
  worker.name = 'fictional-construction-helper';
  const rig = add(worker, new THREE.Group());

  const leftLeg = add(rig, new THREE.Group(), -0.23, 0.86, 0);
  const rightLeg = add(rig, new THREE.Group(), 0.23, 0.86, 0);
  for (const leg of [leftLeg, rightLeg]) {
    add(leg, box(0.32, 0.61, 0.36, palette.teal, 0.1), 0, -0.27, 0);
    add(leg, box(0.39, 0.23, 0.54, INK, 0.09), 0, -0.70, 0.09);
    add(leg, box(0.41, 0.07, 0.55, palette.cream, 0.03, { outline: false }), 0, -0.78, 0.09);
  }

  add(rig, box(0.90, 0.94, 0.58, palette.teal, 0.21), 0, 1.28, 0);
  add(rig, box(0.53, 0.43, 0.045, palette.mint, 0.08), 0, 1.13, 0.32);
  add(rig, box(0.39, 0.11, 0.045, palette.yellow, 0.025), 0, 1.23, 0.36);
  for (const sign of [-1, 1]) {
    add(rig, box(0.13, 0.6, 0.045, palette.yellow, 0.035, { outline: false }), sign * 0.30, 1.41, 0.32);
    add(rig, sphere(0.045, INK, { outline: false }), sign * 0.30, 1.21, 0.355);
  }
  add(rig, cylinder(0.17, 0.18, 0.18, palette.skin), 0, 1.86, 0);

  const head = add(rig, new THREE.Group(), 0, 2.24, 0);
  const headBall = add(head, sphere(0.56, palette.skin));
  headBall.scale.set(1.03, 1, 0.90);
  for (const sign of [-1, 1]) {
    const ear = add(head, sphere(0.12, palette.skin), sign * 0.54, -0.02, 0.015);
    ear.scale.set(0.8, 1, 0.7);
  }
  face(head, -0.02, 0.497, 0.93);
  add(head, sphere(0.075, palette.skin, { outline: false }), 0, -0.02, 0.535);
  // Round safety glasses are actual wire tubes, with no transparent face plane.
  for (const sign of [-1, 1]) {
    const glass = mesh(cached('glasses', () => new THREE.TorusGeometry(0.155, 0.018, 6, 20)), INK, { outline: false });
    add(head, glass, sign * 0.19, 0.045, 0.515);
  }
  add(head, tube([[-0.035, 0.05, 0.52], [0, 0.07, 0.54], [0.035, 0.05, 0.52]], 0.016, INK, { outline: false }));

  const hat = add(head, new THREE.Group(), 0, 0.25, 0);
  const domeGeo = cached('helmet-dome', () => new THREE.SphereGeometry(0.61, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2));
  add(hat, mesh(domeGeo, palette.yellow));
  const brim = add(hat, cylinder(0.66, 0.66, 0.075, palette.yellow), 0, 0, 0.025);
  brim.scale.z = 1.06;
  add(hat, tube([[0, 0.08, 0.60], [0, 0.45, 0.39], [0, 0.62, 0], [0, 0.45, -0.39], [0, 0.08, -0.60]], 0.045, palette.orange), 0, 0.01, 0);
  add(hat, box(0.21, 0.13, 0.055, palette.cream, 0.04), 0, 0.19, 0.59);

  const leftArm = add(rig, new THREE.Group(), -0.52, 1.67, 0);
  const rightArm = add(rig, new THREE.Group(), 0.52, 1.67, 0);
  for (const [arm, direction] of [[leftArm, -1], [rightArm, 1]]) {
    add(arm, box(0.29, 0.49, 0.36, palette.teal, 0.13), 0, -0.20, 0);
    add(arm, sphere(0.15, palette.skin), 0, -0.51, 0.035);
    arm.rotation.z = direction * 0.15;
  }

  const hammer = add(rightArm, new THREE.Group(), 0, -0.51, 0.10);
  add(hammer, cylinder(0.055, 0.060, 0.75, palette.orange), 0.035, 0.1, 0.02);
  add(hammer, box(0.47, 0.22, 0.23, palette.blue, 0.055, { metalness: 0.55, roughness: 0.25 }), 0.035, 0.49, 0.02);
  add(hammer, box(0.09, 0.27, 0.27, palette.cream, 0.035), -0.20, 0.49, 0.02);
  hammer.rotation.z = -0.25;

  const shovel = add(leftArm, new THREE.Group(), -0.02, -0.49, -0.05);
  add(shovel, cylinder(0.038, 0.038, 1.05, palette.orange), -0.01, -0.01, 0);
  add(shovel, polygon([[-0.22, 0.17], [0.22, 0.17], [0.20, -0.12], [0, -0.25], [-0.20, -0.12]], 0.09, palette.blue, { metalness: 0.45 }), 0, -0.63, 0);
  const shovelHandle = add(shovel, mesh(cached('shovel-grip', () => new THREE.TorusGeometry(0.10, 0.038, 6, 16)), palette.yellow), 0, 0.58, 0);
  shovelHandle.scale.y = 1.15;
  shovel.rotation.z = 0.23;

  worker.userData = {
    hat,
    limbs: { leftArm, rightArm, leftLeg, rightLeg },
    animate(time, { moving = false, jump = 0, trip = 0 } = {}) {
      const stride = moving ? Math.sin(time * 9) * 0.46 : Math.sin(time * 1.8) * 0.035;
      const fall = THREE.MathUtils.clamp(trip, 0, 1);
      leftLeg.rotation.x = stride;
      rightLeg.rotation.x = -stride;
      leftArm.rotation.x = -stride * 0.8 - jump * 0.7;
      rightArm.rotation.x = stride * 0.8 - jump * 1.2;
      leftArm.rotation.z = -0.15 - jump * 0.5 - fall * 0.65;
      rightArm.rotation.z = 0.15 + jump * 0.5 + fall * 0.65;
      rig.position.y = Math.max(0, jump) * 0.75 + (moving ? Math.abs(Math.sin(time * 9)) * 0.065 : Math.sin(time * 2) * 0.015);
      rig.rotation.z = -fall * 0.72 + (moving ? Math.sin(time * 9) * 0.04 : 0);
      rig.rotation.x = fall * 0.25;
      head.rotation.y = Math.sin(time * 1.5) * 0.07;
      hat.position.y = 0.25 + Math.sin(fall * Math.PI * 0.8) * 0.65;
      hat.position.x = fall * 0.32;
      hat.rotation.z = -fall * 0.6;
    },
  };
  return worker;
}

function heartShape() {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.92);
  shape.bezierCurveTo(-0.25, -0.67, -1.02, -0.14, -1.02, 0.40);
  shape.bezierCurveTo(-1.02, 1.03, -0.25, 1.20, 0, 0.67);
  shape.bezierCurveTo(0.25, 1.20, 1.02, 1.03, 1.02, 0.40);
  shape.bezierCurveTo(1.02, -0.14, 0.25, -0.67, 0, -0.92);
  return shape;
}

function starPoints(count = 4, outer = 1, inner = 0.34) {
  return Array.from({ length: count * 2 }, (_, i) => {
    const a = i * Math.PI / count + Math.PI / 2;
    const r = i % 2 ? inner : outer;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

/** Dimensional toy stickers; their faces, strokes, decorations and frames are meshes. */
export function createSticker(kind = 'heart', seed = '') {
  const group = new THREE.Group();
  group.name = `solid-sticker-${kind}`;
  if (kind === 'badge') {
    const badge = createBadge(seed || 'c0ffee');
    badge.scale.setScalar(0.78);
    group.add(badge);
    return group;
  }
  if (kind === 'heart') {
    add(group, extrude(heartShape(), 0.44, palette.pink));
    face(group, 0.12, 0.26, 1.25);
    const shine = add(group, sphere(0.14, palette.cream, { outline: false }), -0.56, 0.64, 0.26);
    shine.scale.set(0.65, 1.25, 0.28);
  } else if (kind === 'sun') {
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5;
      const ray = add(group, box(0.14, 0.33, 0.20, palette.orange, 0.065), Math.sin(a) * 1.02, Math.cos(a) * 1.02, 0);
      ray.rotation.z = -a;
    }
    const core = add(group, sphere(0.74, palette.yellow));
    core.scale.z = 0.53;
    face(group, 0.01, 0.42, 1.35);
  } else if (kind === 'tree') {
    add(group, cylinder(0.14, 0.19, 1.0, palette.orange), 0, -0.59, 0);
    add(group, cylinder(0.15, 0.84, 0.98, palette.teal), 0, 0.07, 0);
    add(group, cylinder(0, 0.67, 0.91, palette.mint), 0, 0.64, 0);
    face(group, 0.10, 0.55, 1.0);
    for (const [x, y] of [[-0.38, 0.11], [0.27, 0.65], [0.45, -0.21]]) {
      add(group, sphere(0.10, palette.yellow), x, y, 0.48);
    }
    const foot = add(group, cylinder(0.52, 0.58, 0.10, palette.cream), 0, -1.10, 0);
    foot.scale.z = 0.7;
  } else if (kind === 'train') {
    add(group, box(1.58, 1.65, 0.73, palette.mint, 0.28), 0, 0.05, 0);
    add(group, box(1.19, 0.56, 0.08, INK, 0.14), 0, 0.40, 0.42);
    add(group, box(0.055, 0.51, 0.045, palette.cream, 0.015, { outline: false }), 0, 0.40, 0.48);
    add(group, box(1.49, 0.19, 0.08, palette.yellow, 0.05), 0, -0.21, 0.44);
    for (const sign of [-1, 1]) {
      add(group, sphere(0.105, palette.cream), sign * 0.49, -0.46, 0.45);
      const wheel = add(group, cylinder(0.18, 0.18, 0.16, INK), sign * 0.48, -0.84, 0.12);
      wheel.rotation.x = Math.PI / 2;
      add(group, box(0.11, 0.10, 1.1, palette.blue, 0.035), sign * 0.55, -1.05, 0.05);
    }
    add(group, box(0.46, 0.16, 0.43, palette.yellow, 0.06), 0, 0.97, -0.02);
    add(group, tube([[-0.11, -0.58, 0.43], [0, -0.63, 0.45], [0.11, -0.58, 0.43]], 0.024, INK, { outline: false }));
  } else if (kind === 'home') {
    add(group, box(1.50, 1.35, 0.85, palette.cream, 0.10), 0, -0.21, 0);
    add(group, polygon([[-1.0, 0.24], [0, 1.05], [1.0, 0.24]], 1.02, palette.orange));
    add(group, box(0.39, 0.76, 0.08, palette.teal, 0.11), 0.28, -0.49, 0.48);
    add(group, sphere(0.035, palette.yellow, { outline: false }), 0.40, -0.49, 0.54);
    add(group, box(0.42, 0.43, 0.08, palette.blue, 0.07), -0.37, -0.18, 0.48);
    add(group, box(0.05, 0.41, 0.035, palette.white, 0.01, { outline: false }), -0.37, -0.18, 0.54);
    add(group, box(0.39, 0.05, 0.035, palette.white, 0.01, { outline: false }), -0.37, -0.18, 0.54);
    add(group, cylinder(0.16, 0.18, 0.35, palette.teal), -0.69, -0.82, 0.41);
    add(group, sphere(0.25, palette.mint), -0.69, -0.51, 0.41);
    const littleHeart = add(group, extrude(heartShape(), 0.12, palette.pink), 0, 0.54, 0.56);
    littleHeart.scale.setScalar(0.19);
  } else if (kind === 'spark') {
    add(group, polygon(starPoints(4, 1.12, 0.46), 0.42, palette.yellow));
    face(group, 0.03, 0.25, 1.0);
    const tiny = add(group, polygon(starPoints(4, 0.30, 0.10), 0.16, palette.pink), 0.93, 0.72, 0.05);
    tiny.rotation.z = 0.1;
    add(group, sphere(0.105, palette.mint), -0.92, -0.63, 0.04);
  } else if (kind === 'thumb') {
    add(group, box(1.05, 1.07, 0.49, palette.yellow, 0.25), 0.15, -0.11, 0);
    const thumb = add(group, box(0.38, 0.94, 0.47, palette.yellow, 0.18), -0.21, 0.62, 0);
    thumb.rotation.z = -0.2;
    for (let i = 0; i < 3; i++) {
      add(group, box(0.48, 0.24, 0.20, palette.yellow, 0.10), 0.49, 0.21 - i * 0.26, 0.24);
    }
    add(group, box(0.48, 0.85, 0.57, palette.teal, 0.12), -0.60, -0.23, 0.02);
    add(group, sphere(0.065, palette.cream), -0.60, -0.48, 0.33);
    const shine = add(group, polygon(starPoints(4, 0.26, 0.09), 0.16, palette.orange), 0.72, 0.93, 0.01);
    shine.rotation.z = 0.2;
  } else {
    return createSticker('heart', seed);
  }
  group.rotation.y = -0.10;
  return group;
}

function randomFromSeed(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let x = Math.imul(h ^ h >>> 15, 1 | h);
    x ^= x + Math.imul(x ^ x >>> 7, 61 | x);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

/** A deterministic, thick, reflective collectible city badge derived from its ID. */
export function createBadge(seedHex = 'c0ffee') {
  instanceGeometryScope += 1;
  try {
    return buildBadge(seedHex);
  } finally {
    instanceGeometryScope -= 1;
  }
}

function buildBadge(seedHex) {
  const random = randomFromSeed(seedHex);
  const group = new THREE.Group();
  group.name = `city-badge-${String(seedHex).slice(0, 20)}`;
  group.userData.seed = String(seedHex);
  const schemes = [
    [0x24b8a7, 0xffd86c, 0xfe9aae],
    [0x7e9cdb, 0xfbc974, 0xb7e8d0],
    [0xf19271, 0xffd96f, 0x68c8bf],
    [0x8ccf9d, 0xf5c8dd, 0x76c5e8],
    [0xc4a2df, 0x8cddce, 0xffd470],
  ];
  const colors = schemes[Math.floor(random() * schemes.length)];
  const sides = 6 + Math.floor(random() * 5);
  const twist = random() * Math.PI * 2;
  const scallop = 0.06 + random() * 0.12;
  const outline = Array.from({ length: sides * 2 }, (_, i) => {
    const a = i * Math.PI / sides + twist;
    const r = i % 2 ? 1.40 - scallop : 1.45;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  add(group, polygon(outline, 0.31, colors[1], { metalness: 0.72, roughness: 0.22 }));
  const base = add(group, cylinder(1.14, 1.14, 0.13, colors[0], { metalness: 0.35, roughness: 0.28 }), 0, 0, 0.21);
  base.rotation.x = Math.PI / 2;
  const border = add(group, mesh(cached('badge-ring', () => new THREE.TorusGeometry(1.14, 0.055, 8, 48)), palette.cream, { metalness: 0.65, roughness: 0.19 }), 0, 0, 0.31);
  border.rotation.z = twist;

  for (let i = 0; i < sides; i++) {
    const a = i * 2 * Math.PI / sides + twist;
    const jewel = add(group, sphere(0.075 + random() * 0.018, i % 2 ? colors[2] : palette.cream, { metalness: 0.32, roughness: 0.22 }), Math.cos(a) * 1.28, Math.sin(a) * 1.28, 0.20);
    jewel.scale.z = 0.65;
  }

  // Tiny solid city, with variable heights, rooflines and contrasting enamel windows.
  const count = 3 + Math.floor(random() * 2);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 0.37;
    const height = 0.48 + random() * 0.72;
    const y = -0.52 + height / 2;
    add(group, box(0.31, height, 0.22, i % 2 ? colors[1] : palette.cream, 0.045, { metalness: 0.12 }), x, y, 0.43);
    for (let row = 0; row < Math.floor(height / 0.23); row++) {
      add(group, box(0.16, 0.08, 0.045, colors[0], 0.012, { outline: false }), x, -0.37 + row * 0.23, 0.565);
    }
    if (i === 1) add(group, cylinder(0.017, 0.022, 0.23, colors[1], { outline: false, metalness: 0.6 }), x, y + height / 2 + 0.10, 0.43);
  }
  add(group, box(1.70, 0.16, 0.20, colors[2], 0.065), 0, -0.65, 0.45);
  const sun = add(group, sphere(0.18, colors[1], { metalness: 0.5, roughness: 0.22 }), -0.57, 0.59, 0.40);
  sun.scale.z = 0.5;
  const spark = add(group, polygon(starPoints(4, 0.20, 0.065), 0.11, palette.cream, { metalness: 0.5 }), 0.66, 0.54, 0.43);
  spark.rotation.z = random() * 0.8;
  add(group, cylinder(0.026, 0.03, 0.29, colors[1], { outline: false }), -0.77, -0.38, 0.51);
  const treetop = add(group, sphere(0.17, colors[2]), -0.77, -0.17, 0.51);
  treetop.scale.y = 1.22;
  return group;
}
