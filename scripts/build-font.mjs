import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';

const source = process.env.NOTO_FONT || '/tmp/hammer-noto.otf';
const font = opentype.loadSync(source);
const files = ['index.html', ...fs.readdirSync('src').filter(f => /\.(js|css|json)$/.test(f)).map(f => path.join('src', f))];
const characters = new Set((files.map(f => fs.readFileSync(f, 'utf8')).join('') + '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz，。！？：；「」『』（）《》、…—－＋＝／・↗↓↑←→×✳Ⅱ％%#@ &').split(''));
const glyphs = {};
const missing = [];
for (const char of characters) {
  if (/\s/.test(char) && char !== ' ') continue;
  const glyph = font.charToGlyph(char);
  if (!glyph.index && char !== ' ') { missing.push(char); continue; }
  glyphs[char] = {
    advance: Math.round(glyph.advanceWidth / font.unitsPerEm * 1000),
    commands: glyph.getPath(0, 0, 1000).commands.map(command => Object.fromEntries(Object.entries(command).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v])))
  };
}
fs.mkdirSync('public/assets', { recursive: true });
// Two original geometric interface marks absent from Noto CJK.
const polygon = points => [...points.map(([x, y], i) => ({ type: i ? 'L' : 'M', x, y })), { type: 'Z' }];
glyphs['✳'] = { advance: 1000, commands: polygon(Array.from({ length: 32 }, (_, i) => { const angle = i / 32 * Math.PI * 2; const r = i % 4 < 2 ? 440 : 110; return [500 + Math.cos(angle) * r, -420 + Math.sin(angle) * r]; })) };
glyphs['↻'] = { advance: 1000, commands: polygon([...Array.from({ length: 28 }, (_, i) => { const a = -.8 + i / 27 * Math.PI * 1.65; return [480 + Math.cos(a) * 360, -400 + Math.sin(a) * 360]; }), ...Array.from({ length: 28 }, (_, i) => { const a = -.8 + (27 - i) / 27 * Math.PI * 1.65; return [480 + Math.cos(a) * 275, -400 + Math.sin(a) * 275]; })]).concat(polygon([[620, -740], [910, -740], [890, -450]])) };
fs.writeFileSync('public/assets/glyphs.json', JSON.stringify({ family: 'Noto Sans CJK TC Medium', license: 'SIL Open Font License 1.1', units: 1000, glyphs }));
console.log(JSON.stringify({ glyphs: Object.keys(glyphs).length, bytes: fs.statSync('public/assets/glyphs.json').size, missing: [...new Set(missing)].filter(c => !glyphs[c]).join('') }));
