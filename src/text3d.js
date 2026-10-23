import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function containsPoint(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    // Accept a point on the boundary, including an outline's closing vertex.
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < 1e-7 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
      && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function shapesFromContours(paths) {
  const contours = paths.map(path => {
    const points = path.getPoints(12);
    return { path, points, area: THREE.ShapeUtils.area(points), bounds: new THREE.Box2().setFromPoints(points) };
  }).filter(contour => Math.abs(contour.area) > 1e-7);
  if (!contours.length) return [];

  // Noto's outer contours share a winding. Derive its sign from the largest
  // contour so our original interface marks also work in either orientation.
  const largest = contours.reduce((best, contour) => Math.abs(contour.area) > Math.abs(best.area) ? contour : best);
  const direction = Math.sign(largest.area);
  const shapeFor = path => { const shape = new THREE.Shape(); shape.curves = path.curves; return shape; };
  const solids = contours.filter(contour => contour.area * direction > 0)
    .map(contour => ({ ...contour, shape: shapeFor(contour.path) }));
  const shapes = solids.map(contour => contour.shape);

  // OpenType does not require holes to be adjacent to their outer contour.
  // ShapePath.toShapes() relies on that order and can drop trailing holes when
  // nested solids make reassignment ambiguous (for example 圖, 回, and 園).
  // Assign each hole to the smallest enclosing solid explicitly instead.
  for (const hole of contours.filter(contour => contour.area * direction < 0)) {
    let parent = null;
    for (const solid of solids) {
      if ((!parent || Math.abs(solid.area) < Math.abs(parent.area))
        && solid.bounds.containsBox(hole.bounds) && containsPoint(hole.points[0], solid.points)) parent = solid;
    }
    if (parent) parent.shape.holes.push(hole.path);
    else shapes.push(shapeFor(hole.path));
  }
  return shapes;
}

export class MeshType {
  constructor(data) { this.data = data.glyphs; this.cache = new Map(); this.materials = new Map(); this.missing = new Set(); }
  advance(char, size) { return (this.data[char]?.advance ?? 1000) * size / 1000; }
  geometry(char) {
    if (this.cache.has(char)) return this.cache.get(char);
    const glyph = this.data[char];
    if (!glyph) { this.missing.add(char); return null; }
    if (!glyph.commands.length) return null;
    const path = new THREE.ShapePath();
    for (const c of glyph.commands) {
      if (c.type === 'M') path.moveTo(c.x, -c.y);
      else if (c.type === 'L') path.lineTo(c.x, -c.y);
      else if (c.type === 'C') path.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
      else if (c.type === 'Q') path.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
      else if (c.type === 'Z') path.currentPath.closePath();
    }
    const shapes = shapesFromContours(path.subPaths);
    if (!shapes.length) return null;
    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 58, bevelEnabled: false, curveSegments: 2 });
    this.cache.set(char, geometry);
    return geometry;
  }
  material(color) {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    return this.materials.get(color);
  }
  wrap(text, size, maxWidth) {
    const lines = []; let line = ''; let width = 0;
    for (const char of text) {
      if (char === '\n') { lines.push(line); line = ''; width = 0; continue; }
      const w = this.advance(char, size);
      if (width + w > maxWidth && line) { lines.push(line); line = ''; width = 0; }
      line += char; width += w;
    }
    if (line) lines.push(line);
    return lines;
  }
  text(text, size, color, { maxWidth = Infinity, lineHeight = size * 1.55, depthScale = 1 } = {}) {
    const lines = this.wrap(text, size, maxWidth);
    const pieces = []; let max = 0;
    for (let row = 0; row < lines.length; row++) {
      let x = 0;
      for (const char of lines[row]) {
        const geometry = this.geometry(char);
        if (geometry) { const g = geometry.clone(); g.scale(size / 1000, size / 1000, size / 1000 * depthScale); g.translate(x, -row * lineHeight, 0); pieces.push(g); }
        x += this.advance(char, size);
      }
      max = Math.max(max, x);
    }
    const group = new THREE.Group();
    if (pieces.length) { const merged = mergeGeometries(pieces); pieces.forEach(g => g.dispose()); const mesh = new THREE.Mesh(merged, this.material(color)); mesh.userData.ownedGeometry = true; group.add(mesh); }
    group.userData = { width: max, height: lines.length * lineHeight, lines };
    return group;
  }
  positions(chars, color) {
    const pieces = [];
    for (const { char, x, y, size } of chars) {
      const base = this.geometry(char); if (!base) continue;
      const g = base.clone(); g.scale(size / 1000, size / 1000, size / 1000 * .55); g.translate(x, y, 0); pieces.push(g);
    }
    if (!pieces.length) return null;
    const merged = mergeGeometries(pieces); pieces.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, this.material(color)); mesh.userData.ownedGeometry = true; return mesh;
  }
}

export function disposeGroup(group) {
  group.traverse(object => { if (object.userData.ownedGeometry) object.geometry?.dispose(); });
  group.removeFromParent();
}
