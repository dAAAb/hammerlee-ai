import { BRAND } from '../../../src/branding.js';
import { glyphs } from './og-glyphs.js';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const advance = (char, size) => (glyphs[char]?.advance ?? 1000) * size / 1000;

function textPaths(text, x, y, size, fill = '#214c40') {
  let cursor = x;
  const paths = [];
  for (const char of text) {
    const glyph = glyphs[char];
    if (glyph?.path) paths.push(`<path d="${glyph.path}" transform="translate(${cursor.toFixed(2)} ${y}) scale(${size / 1000})"/>`);
    cursor += advance(char, size);
  }
  return `<g fill="${fill}" aria-label="${esc(text)}">${paths.join('')}</g>`;
}

function wrap(text, size, width, maximumLines = 2) {
  const lines = []; let line = '', used = 0;
  for (const char of text) {
    const amount = advance(char, size);
    if (used + amount > width && line) { lines.push(line); line = ''; used = 0; }
    line += char; used += amount;
  }
  if (line) lines.push(line);
  if (lines.length > maximumLines) {
    lines.length = maximumLines;
    lines[maximumLines - 1] = [...lines[maximumLines - 1]].slice(0, -1).join('') + '…';
  }
  return lines;
}

function badge(seed) {
  const value = Number.parseInt(seed.slice(0, 8), 16);
  const palettes = [['#3da994', '#f6c05b'], ['#7689c7', '#e9ba6e'], ['#d88f75', '#9ccbb3'], ['#79a88c', '#e3bbd2']];
  const [color, accent] = palettes[value % palettes.length];
  const points = Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4 + (value % 12) * Math.PI / 180;
    return `${Math.cos(a) * 58},${Math.sin(a) * 58}`;
  }).join(' ');
  const buildings = [0, 1, 2].map(i => {
    const h = 23 + ((value >>> (i * 3)) % 17);
    const x = -30 + i * 22;
    return `<rect x="${x}" y="${21 - h}" width="17" height="${h}" rx="2" fill="#fff9df"/><rect x="${x + 5}" y="${28 - h}" width="6" height="5" rx="1" fill="${color}"/>`;
  }).join('');
  return `<g transform="translate(1060 91)"><polygon points="${points}" fill="#b89a57" transform="translate(3 5)"/><polygon points="${points}" fill="${accent}" stroke="#385d4a" stroke-width="2"/><circle r="43" fill="${color}" stroke="#fff6d7" stroke-width="3"/>${buildings}<path d="M-34 25H33" stroke="${accent}" stroke-width="7" stroke-linecap="round"/><circle cx="-22" cy="-24" r="6" fill="${accent}"/></g>`;
}

/** Only frozen, server-generated dialogue enters this SVG; all text is outlines. */
export function createJourneyOgSvg(conversation) {
  if (!conversation || !/^[a-f0-9]{32}$/.test(conversation.seed) || ![1, 2].includes(conversation.version) || !Array.isArray(conversation.messages)) throw new TypeError('A supported journey is required.');
  const topical = conversation.messages.filter(message => !['intro', 'ending'].includes(message.topic));
  const guide = topical.find(message => message.role === 'guide');
  const visitor = topical.find(message => message.role === 'visitor');
  if (!guide || !visitor || guide.text.length > 120 || visitor.text.length > 120) throw new TypeError('Invalid journey excerpt.');
  const guideLines = wrap(guide.text, 31, 835);
  const visitorLines = wrap(visitor.text, 31, 790);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<title>${esc(BRAND.title)}・預寫對話展示</title>
<rect width="1200" height="630" fill="#f6f4eb"/>
<rect x="24" y="25" width="1156" height="590" rx="28" fill="#dce3d1"/>
<rect x="18" y="18" width="1156" height="590" rx="28" fill="#fbfaf0" stroke="#ced8c1" stroke-width="2"/>
<rect x="57" y="50" width="59" height="59" rx="17" fill="#2c6652"/>
${textPaths('川', 69, 94, 35, '#fff2cd')}
${textPaths(BRAND.title, 135, 91, 38)}
${textPaths('跟著對話，看看城市的日常。', 137, 130, 23, '#667d67')}
${badge(conversation.seed)}
<path d="M60 153H1130" stroke="#dce3d1" stroke-width="2"/>
${textPaths(`${BRAND.shortSpeaker}・示範腳本`, 67, 187, 17, '#71836b')}
<rect x="68" y="207" width="908" height="123" rx="23" fill="#d6dfc9"/>
<rect x="62" y="200" width="908" height="123" rx="23" fill="#fffef7" stroke="#9daf91" stroke-width="2"/>
<path d="M64 214L47 211L64 236Z" fill="#fffef7" stroke="#9daf91" stroke-width="2"/>
${guideLines.map((line, i) => textPaths(line, 92, 247 + i * 45, 31)).join('')}
${textPaths('你・示範回覆', 1010, 362, 17, '#71836b')}
<rect x="266" y="383" width="866" height="122" rx="23" fill="#c1d0a8"/>
<rect x="260" y="376" width="866" height="122" rx="23" fill="#cce5ae" stroke="#8ea67b" stroke-width="2"/>
<path d="M1124 390L1141 386L1124 410Z" fill="#cce5ae" stroke="#8ea67b" stroke-width="2"/>
${visitorLines.map((line, i) => textPaths(line, 290, 422 + i * 45, 31)).join('')}
${textPaths('雙方對話皆為預先編寫・非真人即時聊天', 62, 552, 23, '#385c49')}
${textPaths(`展示編號 ${conversation.seed.toUpperCase()} / V${conversation.version}`, 62, 588, 15, '#7a866c')}
</svg>`;
}
