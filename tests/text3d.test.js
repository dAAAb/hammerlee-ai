import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { MeshType } from '../src/text3d.js';
import { BRAND } from '../src/branding.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/assets/glyphs.json', import.meta.url), 'utf8'));

// Independently integrate the original font contours at the mesh's sampling
// resolution. Signed areas include counters as negative area, regardless of
// the order in which the font stores them.
function outlineArea(glyph) {
  const path = new THREE.ShapePath();
  for (const c of glyph.commands) {
    if (c.type === 'M') path.moveTo(c.x, -c.y);
    else if (c.type === 'L') path.lineTo(c.x, -c.y);
    else if (c.type === 'C') path.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    else if (c.type === 'Q') path.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
    else if (c.type === 'Z') path.currentPath.closePath();
  }
  return Math.abs(path.subPaths.reduce((area, contour) => area + THREE.ShapeUtils.area(contour.getPoints(2)), 0));
}

function frontTriangles(geometry) {
  const positions = geometry.attributes.position;
  const triangles = [];
  for (let index = 0; index < positions.count; index += 3) {
    if ([0, 1, 2].every(offset => positions.getZ(index + offset) === 58)) {
      triangles.push([0, 1, 2].map(offset => new THREE.Vector2(positions.getX(index + offset), positions.getY(index + offset))));
    }
  }
  return triangles;
}

function triangleArea([a, b, c]) {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

function isFilled(geometry, x, y) {
  const point = new THREE.Vector2(x, y);
  return frontTriangles(geometry).some(triangle => {
    const [a, b, c] = triangle;
    const splitArea = triangleArea([point, a, b]) + triangleArea([point, b, c]) + triangleArea([point, c, a]);
    return Math.abs(splitArea - triangleArea(triangle)) < 0.001;
  });
}

test('every bundled glyph preserves its original filled outline area as true extruded geometry', () => {
  const type = new MeshType(data);
  const failures = [];
  for (const [character, glyph] of Object.entries(data.glyphs)) {
    const geometry = type.geometry(character);
    if (!glyph.commands.length) {
      assert.equal(geometry, null, `Blank glyph ${JSON.stringify(character)} should have no mesh`);
      continue;
    }
    assert.ok(geometry?.isBufferGeometry, `${character} must have actual geometry`);
    geometry.computeBoundingBox();
    assert.equal(geometry.boundingBox.max.z - geometry.boundingBox.min.z, 58, `${character} must have depth`);
    const expected = outlineArea(glyph);
    const actual = frontTriangles(geometry).reduce((area, triangle) => area + triangleArea(triangle), 0);
    // Float32 mesh positions may round fractional font coordinates slightly.
    if (Math.abs(actual - expected) > Math.max(1, expected * 1e-6)) failures.push({ character, expected, actual });
    geometry.dispose();
  }
  assert.deepEqual(failures, [], 'A mismatched area indicates a lost or misplaced counter');
});

test('nested Chinese outlines keep their counters open without removing interior strokes', () => {
  const type = new MeshType(data);
  const figure = type.geometry('圖');
  assert.equal(isFilled(figure, 200, 100), false, '圖 must retain the space inside its large outer frame');
  assert.equal(isFilled(figure, 100, 400), true, '圖 must retain the left outer frame stroke');
  assert.equal(isFilled(figure, 270, 200), true, '圖 must retain the interior rectangular stroke');
  const returning = type.geometry('回');
  assert.equal(isFilled(returning, 200, 150), false, '回 must retain its outer counter');
  assert.equal(isFilled(returning, 400, 300), false, '回 must retain its nested inner counter');
  assert.equal(isFilled(returning, 320, 300), true, '回 must retain its inner stroke');
  figure.dispose();
  returning.dispose();
});

test('geometry caching remains stable after contour assignment', () => {
  const type = new MeshType(data);
  const first = type.geometry('園');
  assert.equal(type.geometry('園'), first);
  assert.equal(type.geometry('好'), type.geometry('好'));
  for (const geometry of type.cache.values()) geometry.dispose();
});

test('published brand and photo captions have every Chinese glyph before deployment', () => {
  const files = ['../index.html', '../src/branding.js', '../src/photos.json'];
  const required = new Set(files.flatMap(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8').match(/\p{Script=Han}/gu) || []));
  for (const char of BRAND.visitor) required.add(char);
  const missing = [...required].filter(char => !data.glyphs[char]);
  assert.deepEqual(missing, [], 'Run npm run font after changing visible copy.');
});
