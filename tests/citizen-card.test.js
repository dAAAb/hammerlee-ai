import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { createConversation } from '../src/conversation.js';
import { renderJourneyCard, saveJourneyCard } from '../src/export.js';

const seed = '861867271b8530efa78e63489d6c0d7a';

function contextRecorder() {
  const context = {
    font: '20px sans-serif', fillStyle: '#000000', texts: [], rectangles: [], images: [], stack: [],
    save() { this.stack.push({ font: this.font, fillStyle: this.fillStyle }); },
    restore() { Object.assign(this, this.stack.pop()); },
    beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, arc() {}, fill() {}, stroke() {}, clip() {},
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      return { width: [...text].reduce((total, char) => total + size * (/[^\x00-\x7f]/.test(char) ? 1 : .58), 0) };
    },
    fillText(text, x, y) {
      this.texts.push({ text, x, y, right: x + this.measureText(text).width, bottom: y + Number(this.font.match(/([\d.]+)px/)[1]) });
    },
    fillRect(x, y, width, height) { this.rectangles.push({ x, y, width, height, color: this.fillStyle }); },
    drawImage(source, x, y, width, height) { this.images.push({ source, x, y, width, height }); },
  };
  return context;
}

function installDocument(t, { taintedFirst = false, failEncoding = false } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const canvases = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const context = contextRecorder();
      const index = canvases.length;
      const canvas = { width: 0, height: 0, context, getContext: () => context,
        toBlob(callback, mime) {
          assert.equal(mime, 'image/png');
          if (taintedFirst && index === 0) throw new DOMException('Tainted media', 'SecurityError');
          if (failEncoding) return callback(null);
          callback(new Blob(['png'], { type: mime }));
        },
      };
      canvases.push(canvas); return canvas;
    },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  return canvases;
}

test('citizen card keeps the portrait, dialogue, disclosure, and QR in separate readable regions', t => {
  installDocument(t);
  const selfieCanvas = { width: 300, height: 500 }, badgeCanvas = { width: 800, height: 800 };
  const canvas = renderJourneyCard({ conversation: createConversation(seed, 2), selfieCanvas, badgeCanvas });
  assert.equal(canvas.width, 1200); assert.equal(canvas.height, 1600);
  const { texts, images, rectangles } = canvas.context;
  assert.equal(texts[0].text, '3D 新北事民卡');
  assert.ok(texts.some(({ text }) => text === '新北事民．關心新北事'));
  assert.ok(texts.some(({ text }) => text === 'hammerlee.ai'));
  assert.ok(texts.some(({ text }) => text.includes('不是真人即時聊天')));
  assert.equal(images.filter(({ source }) => source === selfieCanvas).length, 1);
  assert.equal(images.filter(({ source }) => source === badgeCanvas).length, 1);
  for (const text of texts) {
    assert.ok(text.right <= 1140, `text fits the card: ${text.text}`);
    assert.ok(text.bottom <= 1575, `footer fits the card: ${text.text}`);
    if (text.y < 400 && text.x < 800) assert.ok(text.right < 800, `header does not cover portrait: ${text.text}`);
    if (text.y >= 1274 && text.x < 900) assert.ok(text.right <= 840, `footer does not cover QR: ${text.text}`);
  }
  assert.ok(rectangles.filter(rect => rect.x >= 900 && rect.y >= 1274 && rect.color === '#174d49').length > 100);
});

test('all sampled script variants fit above the reserved footer, with or without media', t => {
  installDocument(t);
  const seen = new Set();
  for (let value = 0; value < 160; value++) for (const version of [1, 2]) {
    const conversation = createConversation(value.toString(16).padStart(32, '0'), version);
    seen.add(`${version}:${conversation.topicOrder[0]}:${conversation.variantIndices[conversation.topicOrder[0]]}`);
    const canvas = renderJourneyCard({ conversation, selfieCanvas: { width: 0, height: 0 } });
    assert.equal(canvas.context.images.length, 0, 'an invalid or absent photo falls back to the badge');
    for (const text of canvas.context.texts.filter(text => text.y >= 511 && text.y < 1246)) {
      assert.ok(text.bottom < 1246, `conversation cannot overlap footer: ${conversation.seed} ${text.text}`);
    }
  }
  assert.equal(seen.size, 64, 'covered every first-topic wording variant in both script versions');
});

test('tainted media retries locally without images and keeps the QR plus versioned filename', async t => {
  const canvases = installDocument(t, { taintedFirst: true });
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousFile = Object.getOwnPropertyDescriptor(globalThis, 'File');
  let shared;
  Object.defineProperty(globalThis, 'File', { configurable: true, value: File });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    maxTouchPoints: 1, canShare: () => true, share: async data => {
      assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0), 'temporary pixels are cleared before the native share sheet opens');
      shared = data;
    },
  } });
  t.after(() => {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
    if (previousFile) Object.defineProperty(globalThis, 'File', previousFile); else delete globalThis.File;
  });
  const conversation = createConversation(seed, 1);
  const result = await saveJourneyCard({ conversation, selfieCanvas: { width: 300, height: 400 } });
  assert.deepEqual(result, { method: 'native', filename: `new-taipei-citizen-card-v1-${seed}.png`, omittedMedia: true });
  assert.equal(shared.title, '3D 新北事民卡｜川伯，聊聊');
  assert.equal(shared.files[0].type, 'image/png');
  assert.equal(canvases.length, 2);
  assert.equal(canvases[0].context.images.length, 1);
  assert.equal(canvases[1].context.images.length, 0);
  const qr = canvas => canvas.context.rectangles.filter(rect => rect.x >= 900 && rect.y >= 1274);
  assert.deepEqual(qr(canvases[1]), qr(canvases[0]), 'the exact QR survives the media-free retry');
});

test('failed PNG encoding clears temporary card pixels and never attempts a share', async t => {
  const canvases = installDocument(t, { failEncoding: true });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let shareCalls = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    maxTouchPoints: 1, canShare: () => true, share: async () => { shareCalls++; },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; });
  await assert.rejects(saveJourneyCard({ conversation: createConversation(seed, 2), selfieCanvas: { width: 300, height: 400 } }), /圖片輸出失敗/);
  assert.equal(shareCalls, 0);
  assert.equal(canvases.length, 1);
  assert.equal(canvases[0].width, 0);
  assert.equal(canvases[0].height, 0);
});
