import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { createBadge } from '../src/models.js';
import { BADGE_AR_SIZE_METERS, USDZ_MIME_TYPE, createBadgeUsdzScene, exportBadgeUsdz } from '../src/badge-usdz.js';

const SEED = '861867271b8530efa78e63489d6c0d7a';
const OTHER = '20704fe89053e023f90a26b37560b80f';

function meshes(object) { const result = []; object.traverse(part => { if (part.isMesh) result.push(part); }); return result; }
function hash(attribute) {
  return attribute ? createHash('sha256').update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength)).digest('hex') : null;
}
function bodySignature(object) {
  return meshes(object).filter(part => !part.userData.isOutline).map(part => ({
    position: hash(part.geometry.attributes.position), normal: hash(part.geometry.attributes.normal), index: hash(part.geometry.index),
    translation: part.position.toArray(), rotation: part.quaternion.toArray(), scale: part.scale.toArray(),
    color: part.material.color.toArray(), metalness: part.material.metalness, roughness: part.material.roughness,
  }));
}
function disposeRaw(model) { const owned = new Set(); model.traverse(part => { if (part.userData.ownedGeometry) owned.add(part.geometry); }); owned.forEach(geometry => geometry.dispose()); }

test('AR badge preserves the exact seeded solid geometry, palette and every hull', t => {
  const raw = createBadge(SEED), first = createBadgeUsdzScene({ seed: SEED, version: 2 });
  const replay = createBadgeUsdzScene({ seed: SEED.toUpperCase(), version: 1 });
  const different = createBadgeUsdzScene({ seed: OTHER, version: 2 });
  t.after(() => { disposeRaw(raw); first.dispose(); replay.dispose(); different.dispose(); });
  assert.deepEqual(bodySignature(first.scene), bodySignature(raw));
  assert.deepEqual(bodySignature(first.scene), bodySignature(replay.scene), 'script version does not alter the seed-derived badge');
  assert.notDeepEqual(bodySignature(first.scene), bodySignature(different.scene));
  const original = meshes(raw), prepared = meshes(first.scene);
  assert.equal(prepared.length, original.length, 'no solids or decorative hulls are omitted');
  assert.equal(prepared.filter(part => part.userData.isOutline).length, original.filter(part => part.userData.isOutline).length);
  for (const part of prepared) {
    assert.equal(part.material.isMeshStandardMaterial, true);
    assert.equal(part.material.side, THREE.FrontSide);
    assert.equal(part.material.map, null);
    assert.ok(part.matrixWorld.determinant() > 0);
    assert.ok(!original.some(source => source.material === part.material), 'the live material cache is never reused for export');
  }
});

test('outline conversion reverses winding and normals without modifying its parent solid', t => {
  const raw = createBadge(SEED), prepared = createBadgeUsdzScene({ seed: SEED, version: 2 });
  t.after(() => { disposeRaw(raw); prepared.dispose(); });
  const before = meshes(raw).filter(part => part.userData.isOutline);
  const after = meshes(prepared.scene).filter(part => part.userData.isOutline);
  assert.ok(before.some(part => part.geometry.index) && before.some(part => !part.geometry.index), 'exercise indexed and unindexed source geometry');
  before.forEach((source, number) => {
    const target = after[number];
    assert.notEqual(target.geometry, target.parent.geometry);
    assert.deepEqual(target.scale.toArray(), source.scale.toArray());
    assert.equal(hash(target.geometry.attributes.position), hash(source.geometry.attributes.position));
    const sourceIndex = source.geometry.index;
    const indexAt = vertex => sourceIndex ? sourceIndex.getX(vertex) : vertex;
    const targetIndex = target.geometry.index;
    for (let index = 0; index < targetIndex.count; index += 3) {
      assert.equal(targetIndex.getX(index), indexAt(index));
      assert.equal(targetIndex.getX(index + 1), indexAt(index + 2));
      assert.equal(targetIndex.getX(index + 2), indexAt(index + 1));
    }
    const a = source.geometry.attributes.normal, b = target.geometry.attributes.normal;
    for (let index = 0; index < a.array.length; index++) assert.ok(Math.abs(a.array[index] + b.array[index]) < 1e-7);
    assert.equal(source.material.side, THREE.BackSide);
    assert.equal(source.material.isMeshBasicMaterial, true);
  });
});

test('badge is 18 centimetres at maximum dimension, grounded and upright facing positive Z', t => {
  for (const seed of [SEED, OTHER, '0'.repeat(32), 'f'.repeat(32)]) {
    const prepared = createBadgeUsdzScene({ seed, version: 2 }); t.after(prepared.dispose);
    const bounds = new THREE.Box3().setFromObject(prepared.scene, true);
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    assert.ok(Math.abs(Math.max(size.x, size.y, size.z) - BADGE_AR_SIZE_METERS) < 1e-8);
    assert.ok(Math.abs(bounds.min.y) < 1e-8);
    assert.ok(Math.abs(center.x) < 1e-8 && Math.abs(center.z) < 1e-8);
    assert.ok(size.z < size.x / 2 && size.z < size.y / 2, 'the badge stands on its edge instead of lying flat');
    const model = prepared.scene.children[0];
    assert.deepEqual(new THREE.Vector3(0, 0, 1).applyQuaternion(model.quaternion).toArray(), [0, 0, 1]);
  }
});

function archiveEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), entries = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true), method = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 18, true), uncompressed = view.getUint32(offset + 22, true);
    const nameSize = view.getUint16(offset + 26, true), extraSize = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameSize));
    const start = offset + 30 + nameSize + extraSize;
    assert.equal(flags & 1, 0, 'USDZ members must not be encrypted');
    assert.equal(flags & 8, 0, 'sizes are explicit rather than deferred descriptors');
    assert.equal(method, 0, 'USDZ members must not be compressed');
    assert.equal(compressed, uncompressed);
    assert.equal(start % 64, 0, `${name} data must begin on a 64-byte boundary`);
    assert.match(name, /^(?:geometries\/)?[A-Za-z0-9_]+\.usda$/);
    entries.push({ name, text: new TextDecoder().decode(bytes.subarray(start, start + compressed)) });
    offset = start + compressed;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50, 'a ZIP central directory follows the members');
  return entries;
}

test('real USDZ is aligned, self-contained, metre-scaled and warning-free with horizontal AR anchoring', async t => {
  const warning = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const raw = createBadge(SEED); t.after(() => disposeRaw(raw));
  const result = await exportBadgeUsdz({ seed: SEED, version: 2 });
  assert.equal(result.blob.type, USDZ_MIME_TYPE);
  assert.equal(result.filename, `new-taipei-badge-v2-${SEED}.usdz`);
  const entries = archiveEntries(new Uint8Array(await result.blob.arrayBuffer()));
  assert.equal(entries[0].name, 'model.usda');
  assert.equal(entries.length, meshes(raw).length + 1, 'each solid and reversed hull has its own geometry member');
  const root = entries[0].text;
  assert.match(root, /metersPerUnit = 1\b/); assert.match(root, /upAxis = "Y"/);
  assert.match(root, /preliminary:anchoring:type = "plane"/);
  assert.match(root, /preliminary:planeAnchoring:alignment = "horizontal"/);
  assert.equal([...root.matchAll(/def Xform "BadgePart_/g)].length, meshes(raw).length);
  const names = new Set(entries.map(entry => entry.name));
  for (const { text } of entries) {
    assert.match(text, /^#usda 1\.0/);
    assert.doesNotMatch(text, /\b(?:NaN|Infinity|undefined)\b/);
    for (const [, path] of text.matchAll(/@([^@]+)@/g)) assert.ok(names.has(path.replace(/^\.\//, '')), `valid internal reference ${path}`);
  }
  assert.equal(warning.mock.calls.length, 0);
  assert.equal(error.mock.calls.length, 0);
});

test('cleanup releases each export resource once and never disposes a live badge or shared palette', async t => {
  const live = createBadge(SEED), before = bodySignature(live);
  let liveDisposed = 0;
  const liveResources = new Set(meshes(live).flatMap(part => [part.geometry, part.material]));
  for (const resource of liveResources) resource.addEventListener('dispose', () => liveDisposed++);
  const prepared = createBadgeUsdzScene({ seed: SEED, version: 1 });
  const resources = new Set(meshes(prepared.scene).flatMap(part => [part.geometry, part.material]));
  const counts = new Map();
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) || 0) + 1));
  prepared.dispose(); prepared.dispose();
  assert.equal(counts.size, resources.size);
  assert.ok([...counts.values()].every(count => count === 1));
  let failedResources, failedDisposals = 0;
  t.mock.method(USDZExporter.prototype, 'parseAsync', async scene => {
    failedResources = new Set(meshes(scene).flatMap(part => [part.geometry, part.material]));
    for (const resource of failedResources) resource.addEventListener('dispose', () => failedDisposals++);
    throw new Error('simulated exporter failure');
  });
  await assert.rejects(exportBadgeUsdz({ seed: SEED, version: 2 }), /simulated exporter failure/);
  assert.equal(failedDisposals, failedResources.size);
  assert.equal(liveDisposed, 0);
  assert.deepEqual(bodySignature(live), before);
  disposeRaw(live);
});

test('invalid seed or version fails before producing a misleading badge filename', async () => {
  for (const input of [undefined, { seed: 'abcd', version: 2 }, { seed: SEED, version: '2' }, { seed: SEED, version: 3 }]) {
    assert.throws(() => createBadgeUsdzScene(input), TypeError);
    await assert.rejects(exportBadgeUsdz(input), TypeError);
  }
});
