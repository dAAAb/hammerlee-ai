import qrcode from 'qrcode-generator';
import { normalizeSeed } from './conversation.js';

/** The card always points to the public canonical host, never a preview host. */
export function canonicalJourneyUrl(conversation) {
  const seed = normalizeSeed(conversation?.seed);
  if (!seed || ![1, 2].includes(conversation?.version)) {
    throw new TypeError('A valid journey seed and version 1 or 2 are required.');
  }
  return `https://hammerlee.ai/?v=${conversation.version}&s=${seed}`;
}

export function createJourneyQr(conversation) {
  const url = canonicalJourneyUrl(conversation);
  const qr = qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  const moduleCount = qr.getModuleCount();
  return {
    url, moduleCount, quietZone: 4,
    modules: Array.from({ length: moduleCount }, (_, row) =>
      Array.from({ length: moduleCount }, (_, column) => qr.isDark(row, column))),
  };
}

/** Integer cells and a four-module white border keep the exported QR crisp. */
export function paintJourneyQr(context, conversation, { x, y, size }) {
  const qr = createJourneyQr(conversation);
  if (![x, y, size].every(Number.isFinite) || size < qr.moduleCount + qr.quietZone * 2) {
    throw new RangeError('The QR drawing area is too small or invalid.');
  }
  const count = qr.moduleCount + qr.quietZone * 2;
  const moduleSize = Math.floor(size / count);
  const actualSize = moduleSize * count;
  const left = Math.round(x + (size - actualSize) / 2);
  const top = Math.round(y + (size - actualSize) / 2);
  context.fillStyle = '#ffffff';
  context.fillRect(left, top, actualSize, actualSize);
  context.fillStyle = '#174d49';
  for (let row = 0; row < qr.moduleCount; row++) {
    for (let column = 0; column < qr.moduleCount; column++) {
      if (qr.modules[row][column]) context.fillRect(
        left + (column + qr.quietZone) * moduleSize,
        top + (row + qr.quietZone) * moduleSize,
        moduleSize, moduleSize,
      );
    }
  }
  return { url: qr.url, x: left, y: top, size: actualSize, moduleSize };
}
