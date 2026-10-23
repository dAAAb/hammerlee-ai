import * as THREE from 'three';
import { createBadge } from './models.js';
import { normalizeSeed } from './conversation.js';

export const BADGE_AR_SIZE_METERS = 0.18;
export const USDZ_MIME_TYPE = 'model/vnd.usdz+zip';

function identity({ seed, version } = {}) {
  const normalized = normalizeSeed(seed);
  if (!normalized || ![1, 2].includes(version)) {
    throw new TypeError('A 32-character hexadecimal seed and journey version 1 or 2 are required.');
  }
  return { seed: normalized, version };
}

function reverseHull(source) {
  // USDZ has no Three.js BackSide material. Reverse the actual triangles and
  // normals instead, leaving front-facing badge surfaces unobscured. The hull
  // retains its original 1.035 scale, so its silhouette is still real geometry.
  const geometry = source.clone();
  if (!geometry.index) {
    geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, index) => index));
  }
  const index = geometry.index;
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const second = index.getX(triangle + 1);
    index.setX(triangle + 1, index.getX(triangle + 2));
    index.setX(triangle + 2, second);
  }
  index.needsUpdate = true;
  if (geometry.attributes.normal) {
    const normal = geometry.attributes.normal;
    for (let vertex = 0; vertex < normal.count; vertex++) {
      normal.setXYZ(vertex, -normal.getX(vertex), -normal.getY(vertex), -normal.getZ(vertex));
    }
    normal.needsUpdate = true;
  } else {
    geometry.computeVertexNormals();
  }
  return geometry;
}

/**
 * Prepare an isolated, texture-free scene for USDZ and geometry verification.
 * Call dispose() once finished. Body geometry belongs to this fresh createBadge
 * instance; materials are cloned because models.js caches them across the app.
 */
export function createBadgeUsdzScene(input) {
  const { seed, version } = identity(input);
  const scene = new THREE.Scene();
  const model = createBadge(seed);
  const geometries = new Set();
  const materials = new Set();
  const materialCopies = new Map();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    scene.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    geometries.clear(); materials.clear(); materialCopies.clear();
  };

  // Register all instance-owned geometries before conversion so a failed
  // preparation also releases parts that have not yet been visited.
  model.traverse(object => {
    if (object.geometry && object.userData.ownedGeometry) geometries.add(object.geometry);
  });

  try {
    let part = 0;
    model.name = `CityBadge_v${version}_${seed}`;
    model.traverse(object => {
      if (!object.isMesh) return;
      object.name = `BadgePart_${String(part++).padStart(3, '0')}`;
      const source = object.material;
      if (Array.isArray(source)) throw new TypeError('Badge USDZ requires one material per mesh.');

      if (object.userData.isOutline) {
        const hull = reverseHull(object.geometry);
        geometries.add(hull);
        object.geometry = hull;
        object.userData.ownedGeometry = true;
        if (!materialCopies.has(source)) {
          // Standard PBR ink is lit by the AR environment, unlike the original
          // unlit MeshBasic outline; its original color and geometry remain.
          const ink = new THREE.MeshStandardMaterial({ color: source.color.clone(), metalness: 0, roughness: 1, side: THREE.FrontSide });
          materialCopies.set(source, ink); materials.add(ink);
        }
      } else {
        if (!source?.isMeshStandardMaterial) throw new TypeError('Unsupported badge material for USDZ.');
        if (!materialCopies.has(source)) {
          const copy = source.clone();
          copy.side = THREE.FrontSide;
          materialCopies.set(source, copy); materials.add(copy);
        }
      }
      object.material = materialCopies.get(source);
    });

    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model, true);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = BADGE_AR_SIZE_METERS / Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('Badge geometry has no finite extent.');
    model.scale.setScalar(scale);
    // Keep +Y vertical and the city face toward +Z; translate, never rotate or
    // flatten, so the lowest geometric point rests on a horizontal AR surface.
    model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    scene.add(model);
    scene.userData = { seed, version, maxDimensionMeters: BADGE_AR_SIZE_METERS };
    scene.updateMatrixWorld(true);
    return { scene, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Export on demand without loading the USDZ exporter during normal browsing. */
export async function exportBadgeUsdz(input) {
  const { seed, version } = identity(input);
  const prepared = createBadgeUsdzScene({ seed, version });
  try {
    const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
    const bytes = await new USDZExporter().parseAsync(prepared.scene, {
      onlyVisible: true,
      quickLookCompatible: true,
      includeAnchoringProperties: true,
      ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
    });
    return {
      blob: new Blob([bytes], { type: USDZ_MIME_TYPE }),
      filename: `new-taipei-badge-v${version}-${seed}.usdz`,
    };
  } finally {
    prepared.dispose();
  }
}
