import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { canonicalJourneyUrl, createJourneyQr, paintJourneyQr } from '../src/journey-qr.js';

const seed = '861867271b8530efa78e63489d6c0d7a';

function rasterContext(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return {
    data, width, height, fillStyle: '#ffffff',
    fillRect(x, y, w, h) {
      assert.ok([x, y, w, h].every(Number.isInteger), 'QR cells align to whole pixels');
      const rgb = this.fillStyle.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16));
      for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
        const i = (py * width + px) * 4;
        data.set([...rgb, 255], i);
      }
    },
  };
}

test('card QR independently decodes to the exact canonical seed and version', () => {
  for (const version of [1, 2]) {
    for (const size of [230, 164]) {
      const conversation = { seed: seed.toUpperCase(), version };
      const context = rasterContext(260, 260);
      const placement = paintJourneyQr(context, conversation, { x: 15, y: 15, size });
      const decoded = jsQR(context.data, context.width, context.height, { inversionAttempts: 'dontInvert' });
      assert.equal(decoded?.data, `https://hammerlee.ai/?v=${version}&s=${seed}`);
      assert.equal(placement.url, decoded.data);
      assert.ok(placement.moduleSize >= 4);
      const { quietZone } = createJourneyQr(conversation);
      const border = quietZone * placement.moduleSize;
      for (let y = placement.y; y < placement.y + placement.size; y++) {
        for (let x = placement.x; x < placement.x + placement.size; x++) {
          if (x < placement.x + border || x >= placement.x + placement.size - border
            || y < placement.y + border || y >= placement.y + placement.size - border) {
            assert.deepEqual([...context.data.slice((y * context.width + x) * 4, (y * context.width + x) * 4 + 4)], [255, 255, 255, 255]);
          }
        }
      }
    }
  }
});

test('QR rejects ambiguous versions and invalid seeds rather than linking another journey', () => {
  for (const version of [undefined, null, '2', 0, 3]) assert.throws(() => canonicalJourneyUrl({ seed, version }), TypeError);
  for (const invalid of ['', 'abcd', `${seed}&v=1`, null]) assert.throws(() => canonicalJourneyUrl({ seed: invalid, version: 2 }), TypeError);
  assert.throws(() => paintJourneyQr({}, { seed, version: 2 }, { x: 0, y: 0, size: 20 }), RangeError);
  assert.deepEqual(createJourneyQr({ seed, version: 2 }), createJourneyQr({ seed, version: 2 }));
});
