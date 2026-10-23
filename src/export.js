import { TOPICS, normalizeSeed } from './conversation.js';
import { BRAND } from './branding.js';
import { paintJourneyQr, canonicalJourneyUrl } from './journey-qr.js';

const FONT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
const COLORS = { paper: '#f6f3e9', ink: '#174d49', muted: '#637c74', mint: '#d8e9cf', white: '#fffef8' };

function roundRect(context, x, y, width, height, radius = 24) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function wrapText(context, text, maximumWidth) {
  const lines = [];
  const segments = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' }).segment(text)].map(({ segment }) => segment)
    : [...text];
  let line = '';
  for (const character of segments) {
    if (character === '\n') {
      lines.push(line);
      line = '';
    } else if (line && context.measureText(line + character).width > maximumWidth) {
      lines.push(line);
      line = character;
    } else {
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function paintText(context, text, x, y, maximumWidth, { size = 32, lineHeight = 48, weight = 500, color = COLORS.ink } = {}) {
  context.font = `${weight} ${size}px ${FONT}`;
  context.fillStyle = color;
  context.textBaseline = 'top';
  const lines = wrapText(context, text, maximumWidth);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return lines.length * lineHeight;
}

function hasCanvasImage(source) {
  return source && Number.isFinite(Number(source.width)) && Number(source.width) > 0
    && Number.isFinite(Number(source.height)) && Number(source.height) > 0;
}

function paintContainedImage(context, source, x, y, width, height) {
  const ratio = Math.min(width / source.width, height / source.height);
  const imageWidth = source.width * ratio;
  const imageHeight = source.height * ratio;
  context.drawImage(source, x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight);
}

function measureBubble(context, message, size) {
  const width = message.role === 'visitor' ? 980 : 1060;
  context.font = `600 ${size}px ${FONT}`;
  const lines = wrapText(context, message.text, width - 60);
  const lineHeight = Math.round(size * 1.46);
  const height = lines.length * lineHeight + 42;
  return { width, size, lineHeight, lines, height, totalHeight: height + 61 };
}

function paintBubble(context, message, y, layout) {
  const isVisitor = message.role === 'visitor';
  const { width, size, lineHeight, lines, height, totalHeight } = layout;
  const x = isVisitor ? 150 : 70;
  paintText(context, isVisitor ? (BRAND.visitor || '新北事民．關心新北事') : BRAND.speaker, x + 8, y, width, {
    size: 24, lineHeight: 30, color: COLORS.muted,
  });
  context.fillStyle = '#d4d9c8';
  roundRect(context, x, y + 42, width, height, 29);
  context.fill();
  context.fillStyle = isVisitor ? COLORS.mint : COLORS.white;
  roundRect(context, x, y + 35, width, height, 29);
  context.fill();
  context.font = `600 ${size}px ${FONT}`;
  context.fillStyle = COLORS.ink;
  context.textBaseline = 'top';
  lines.forEach((line, index) => context.fillText(line, x + 30, y + 56 + index * lineHeight));
  return y + totalHeight;
}

function selectExcerpts(conversation) {
  const dialogue = conversation.messages.filter(({ role }) => role === 'guide' || role === 'visitor');
  const topical = dialogue.filter(({ topic }) => topic !== 'intro' && topic !== 'ending');
  // Use actual selected script lines, rather than inventing a quote for the card.
  return (topical.length >= 3 ? topical : dialogue).slice(0, 3);
}

function paintBadge(context, badgeCanvas, x, y, radius) {
  context.save();
  context.fillStyle = COLORS.white;
  context.beginPath(); context.arc(x, y, radius + 5, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.clip();
  if (hasCanvasImage(badgeCanvas)) {
    paintContainedImage(context, badgeCanvas, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    context.fillStyle = '#b99e6b'; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    context.strokeStyle = '#fff6d8'; context.lineWidth = 3;
    context.beginPath(); context.arc(x, y, radius * .77, 0, Math.PI * 2); context.stroke();
    const size = Math.round(radius * .32);
    paintText(context, '新北', x - size, y - size * 1.1, radius * 2, { size, lineHeight: size, color: COLORS.white, weight: 700 });
    paintText(context, '事民', x - size, y + size * .15, radius * 2, { size, lineHeight: size, color: COLORS.white, weight: 700 });
  }
  context.restore();
}

function paintPortrait(context, selfieCanvas, badgeCanvas) {
  // The whole portrait column starts after the header text, including its badge.
  context.save();
  context.shadowColor = '#174d4926'; context.shadowBlur = 18; context.shadowOffsetY = 8;
  context.fillStyle = COLORS.white; roundRect(context, 876, 64, 254, 286, 29); context.fill();
  context.shadowColor = 'transparent'; context.shadowBlur = 0; context.shadowOffsetY = 0;
  context.save(); roundRect(context, 886, 74, 234, 240, 22); context.clip();
  const ratio = Math.max(234 / selfieCanvas.width, 240 / selfieCanvas.height);
  const drawWidth = selfieCanvas.width * ratio, drawHeight = selfieCanvas.height * ratio;
  context.drawImage(selfieCanvas, 886 + (234 - drawWidth) / 2, 74 + (240 - drawHeight) / 2, drawWidth, drawHeight);
  context.restore();
  paintText(context, '我的城市日常', 943, 322, 185, { size: 20, lineHeight: 25, weight: 600 });
  context.restore();
  paintBadge(context, badgeCanvas, 866, 328, 58);
}

/** Memory-only Canvas2D export; media and the QR never leave this browser. */
export function renderJourneyCard({ conversation, badgeCanvas, sceneCanvas, selfieCanvas }, includeImages = true) {
  validateConversation(conversation);
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1600;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('這個瀏覽器目前無法建立圖片，請試著分享對話連結。');

  context.fillStyle = COLORS.paper;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#e4e9d7';
  context.beginPath();
  context.arc(1130, 105, 260, 0, Math.PI * 2);
  context.fill();

  paintText(context, '3D 新北事民卡', 70, 64, 720, { size: 48, lineHeight: 60, weight: 800 });
  paintText(context, BRAND.title, 70, 145, 720, { size: 76, lineHeight: 91, weight: 800 });
  paintText(context, BRAND.speaker, 72, 252, 715, { size: 28, lineHeight: 39, weight: 700 });
  paintText(context, BRAND.visitor || '新北事民．關心新北事', 72, 314, 715, { size: 28, lineHeight: 39, color: COLORS.muted });
  paintText(context, 'HAMMER LEE  /  城市日常收藏', 72, 366, 715, { size: 21, lineHeight: 28, color: COLORS.muted });

  if (includeImages && hasCanvasImage(selfieCanvas)) {
    paintPortrait(context, selfieCanvas, includeImages ? badgeCanvas : null);
  } else {
    paintBadge(context, includeImages ? badgeCanvas : null, 1000, 203, 112);
    paintText(context, BRAND.badgeAlias, 916, 338, 220, { size: 24, lineHeight: 30, weight: 700 });
  }

  const firstTopic = TOPICS.find(({ id }) => id === conversation.topicOrder?.[0]);
  const topicTitle = firstTopic?.title || '城市生活';
  context.fillStyle = COLORS.ink;
  roundRect(context, 70, 416, 1060, 64, 24);
  context.fill();
  paintText(context, `這次，從「${topicTitle}」聊起`, 98, 431, 1000, { size: 30, color: COLORS.white, weight: 600 });

  const excerpts = selectExcerpts(conversation);
  let layouts;
  for (let size = 34; size >= 26; size--) {
    layouts = excerpts.map(message => measureBubble(context, message, size));
    if (layouts.reduce((total, item) => total + item.totalHeight, 0) <= 710) break;
  }
  let bottom = 511;
  excerpts.forEach((message, index) => { bottom = paintBubble(context, message, bottom, layouts[index]); });

  const previewY = Math.max(bottom + 10, 1100);
  const previewHeight = Math.min(120, 1220 - previewY);
  if (includeImages && hasCanvasImage(sceneCanvas) && previewHeight > 80) {
    context.save();
    roundRect(context, 70, previewY, 1060, previewHeight, 25);
    context.clip();
    context.fillStyle = '#dfe8d6';
    context.fillRect(70, previewY, 1060, previewHeight);
    paintContainedImage(context, sceneCanvas, 70, previewY, 1060, previewHeight);
    context.restore();
  } else if (previewHeight > 80) {
    context.fillStyle = '#e3e9d8';
    roundRect(context, 70, previewY, 1060, previewHeight, 25);
    context.fill();
    paintText(context, '8 個生活話題 · 收藏這段城市日常', 100, previewY + 22, 990, { size: 28, lineHeight: 38, weight: 700 });
    if (previewHeight > 106) paintText(context, '掃描右下角，和朋友重看同一段對話。', 100, previewY + 66, 990, { size: 24, lineHeight: 32, color: COLORS.muted });
  }

  context.fillStyle = '#d4ddce'; context.fillRect(70, 1246, 1060, 2);
  paintText(context, '邀請你，來「川伯，聊聊」。', 70, 1274, 765, {
    size: 33, lineHeight: 43, weight: 700,
  });
  paintText(context, BRAND.subtitle, 70, 1334, 765, {
    size: 24, lineHeight: 34, weight: 600,
  });
  paintText(context, BRAND.disclosure, 70, 1376, 765, {
    size: 22, lineHeight: 32, color: COLORS.muted,
  });
  paintText(context, '「新北事民」的回覆是示範腳本，不代表你的意見。', 70, 1451, 765, {
    size: 22, lineHeight: 32, color: COLORS.muted,
  });
  paintText(context, `事民卡編號 · V${conversation.version}`, 70, 1499, 765, { size: 20, lineHeight: 26, color: COLORS.muted });
  context.font = '500 22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.fillStyle = COLORS.ink;
  context.fillText(normalizeSeed(conversation.seed), 70, 1533);
  paintJourneyQr(context, conversation, { x: 900, y: 1274, size: 230 });
  paintText(context, '掃描重看同一段對話', 920, 1508, 220, { size: 20, lineHeight: 26, weight: 500 });
  paintText(context, 'hammerlee.ai', 932, 1540, 220, { size: 25, lineHeight: 30, weight: 700 });
  return canvas;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('圖片輸出失敗，請再試一次。')), 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

function validateConversation(conversation) {
  if (!conversation || !normalizeSeed(conversation.seed) || !Array.isArray(conversation.messages)) {
    throw new TypeError('A conversation with a valid seed and messages is required.');
  }
  canonicalJourneyUrl(conversation);
}

/**
 * Export a readable 1200 × 1600 souvenir card. This raster export deliberately
 * uses Canvas2D text; the interactive scene continues to use real 3D geometry.
 * Touch devices can use their native file sheet to save the PNG to Files/Photos.
 */
export async function saveJourneyCard({ conversation, badgeCanvas, sceneCanvas, selfieCanvas }) {
  validateConversation(conversation);
  let canvas = renderJourneyCard({ conversation, badgeCanvas, sceneCanvas, selfieCanvas });
  let omittedMedia = false;
  let blob;
  try {
    blob = await canvasBlob(canvas);
  } catch (error) {
    if (error.name !== 'SecurityError') throw error;
    // A third-party source could taint a canvas; text and seed remain exportable.
    canvas = renderJourneyCard({ conversation }, false);
    blob = await canvasBlob(canvas);
    omittedMedia = true;
  }

  const filename = `new-taipei-citizen-card-v${conversation.version}-${normalizeSeed(conversation.seed)}.png`;
  const file = typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null;
  const shareFiles = file ? { files: [file], title: '3D 新北事民卡｜川伯，聊聊' } : null;
  if (globalThis.navigator?.maxTouchPoints > 0 && navigator.share && navigator.canShare && shareFiles && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share(shareFiles);
      return { method: 'native', filename, omittedMedia };
    } catch (error) {
      if (error.name === 'AbortError') return { method: 'cancelled', filename, omittedMedia };
      // Browser permissions may disable file sharing while downloads still work.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Some mobile browsers consume the object URL after the click has returned.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return { method: 'download', filename, omittedMedia };
}

/** Return the actual outcome so the UI never describes a copied URL as posted. */
export async function shareJourney({ conversation, url }) {
  validateConversation(conversation);
  const target = new URL(url, globalThis.location?.href);
  if (!['https:', 'http:'].includes(target.protocol)) throw new TypeError('A web URL is required for sharing.');
  const shareUrl = target.href;
  const shareData = {
    title: BRAND.title,
    text: `${BRAND.subtitle}。${BRAND.disclosure}`,
    url: shareUrl,
  };
  let failure;
  if (globalThis.navigator?.share) {
    try {
      await navigator.share(shareData);
      return { method: 'native', url: shareUrl };
    } catch (error) {
      if (error.name === 'AbortError') return { method: 'cancelled', url: shareUrl };
      failure = error;
    }
  }
  if (globalThis.navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareUrl);
      return { method: 'clipboard', url: shareUrl };
    } catch (error) {
      failure = error;
    }
  }
  return { method: 'manual', url: shareUrl, ...(failure ? { error: failure.message } : {}) };
}
