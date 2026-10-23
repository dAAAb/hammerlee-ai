import { TOPICS, normalizeSeed } from './conversation.js';
import { BRAND } from './branding.js';

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
  return source && Number(source.width) > 0 && Number(source.height) > 0;
}

function paintContainedImage(context, source, x, y, width, height) {
  const ratio = Math.min(width / source.width, height / source.height);
  const imageWidth = source.width * ratio;
  const imageHeight = source.height * ratio;
  context.drawImage(source, x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight);
}

function paintBubble(context, message, y) {
  const isVisitor = message.role === 'visitor';
  const x = isVisitor ? 245 : 70;
  const width = isVisitor ? 885 : 930;
  paintText(context, isVisitor ? '你 · 示範回覆' : BRAND.speaker, x + 8, y, width, {
    size: 24, lineHeight: 30, color: COLORS.muted,
  });
  context.font = `600 35px ${FONT}`;
  const lines = wrapText(context, message.text, width - 64);
  const height = lines.length * 51 + 54;
  context.fillStyle = '#d4d9c8';
  roundRect(context, x, y + 43, width, height, 29);
  context.fill();
  context.fillStyle = isVisitor ? COLORS.mint : COLORS.white;
  roundRect(context, x, y + 35, width, height, 29);
  context.fill();
  paintText(context, message.text, x + 32, y + 63, width - 64, { size: 35, lineHeight: 51, weight: 600 });
  return y + height + 61;
}

function selectExcerpts(conversation) {
  const dialogue = conversation.messages.filter(({ role }) => role === 'guide' || role === 'visitor');
  const topical = dialogue.filter(({ topic }) => topic !== 'intro' && topic !== 'ending');
  // Use actual selected script lines, rather than inventing a quote for the card.
  return (topical.length >= 3 ? topical : dialogue).slice(0, 3);
}

function renderCard({ conversation, badgeCanvas, sceneCanvas }, includeImages = true) {
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

  paintText(context, 'HAMMER LEE  /  3D 對話紀念卡', 70, 70, 800, { size: 26, weight: 700 });
  paintText(context, BRAND.title, 70, 135, 820, { size: 76, lineHeight: 91, weight: 800 });
  paintText(context, BRAND.speaker, 70, 232, 800, { size: 31, lineHeight: 41, weight: 700 });
  paintText(context, BRAND.subtitle, 70, 280, 800, { size: 27, lineHeight: 36, color: COLORS.muted });

  if (includeImages && hasCanvasImage(badgeCanvas)) {
    context.save();
    context.beginPath();
    context.arc(1001, 175, 116, 0, Math.PI * 2);
    context.clip();
    paintContainedImage(context, badgeCanvas, 885, 59, 232, 232);
    context.restore();
  } else {
    context.fillStyle = '#c2aa80';
    context.beginPath();
    context.arc(1001, 175, 76, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = COLORS.white;
    context.lineWidth = 5;
    context.beginPath();
    context.arc(1001, 175, 62, 0, Math.PI * 2);
    context.stroke();
    paintText(context, '城市', 957, 135, 160, { size: 38, weight: 800, color: COLORS.white });
    paintText(context, '探索', 957, 183, 160, { size: 38, weight: 800, color: COLORS.white });
  }
  paintText(context, BRAND.badgeAlias, 912, 300, 220, { size: 24, lineHeight: 30, weight: 700 });

  const firstTopic = TOPICS.find(({ id }) => id === conversation.topicOrder?.[0]);
  const topicTitle = firstTopic?.title || '城市生活';
  context.fillStyle = COLORS.ink;
  roundRect(context, 70, 339, 1060, 69, 25);
  context.fill();
  paintText(context, `這次，從「${topicTitle}」聊起`, 98, 356, 1000, { size: 30, color: COLORS.white, weight: 600 });

  let bottom = 449;
  for (const message of selectExcerpts(conversation)) bottom = paintBubble(context, message, bottom);

  const previewY = Math.max(1060, bottom + 5);
  const previewHeight = Math.max(0, 1295 - previewY);
  if (includeImages && hasCanvasImage(sceneCanvas) && previewHeight > 80) {
    context.save();
    roundRect(context, 70, previewY, 1060, previewHeight, 25);
    context.clip();
    context.fillStyle = '#dfe8d6';
    context.fillRect(70, previewY, 1060, previewHeight);
    paintContainedImage(context, sceneCanvas, 70, previewY, 1060, previewHeight);
    context.restore();
  } else {
    context.fillStyle = '#e3e9d8';
    roundRect(context, 70, 1110, 1060, 141, 25);
    context.fill();
    paintText(context, '8 個生活話題 · 一段預寫對話', 103, 1138, 990, { size: 32, weight: 700 });
    paintText(context, '捲一捲，看看這座城市裡的日常小事。', 103, 1188, 990, { size: 27, color: COLORS.muted });
  }

  paintText(context, BRAND.subtitle, 70, 1315, 1060, {
    size: 26, lineHeight: 38, weight: 600,
  });
  paintText(context, BRAND.disclosure, 70, 1353, 1060, {
    size: 24, lineHeight: 34, color: COLORS.muted,
  });
  paintText(context, '「你」的示範回覆不代表你的意見。', 70, 1392, 1060, {
    size: 24, lineHeight: 34, color: COLORS.muted,
  });
  paintText(context, '展示編號', 70, 1438, 1060, { size: 22, color: COLORS.muted });
  context.font = '500 26px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  context.fillStyle = COLORS.ink;
  context.fillText(conversation.seed, 70, 1475);
  paintText(context, '邀請你，來「川伯，聊聊」看看未來新北。', 70, 1530, 1060, { size: 30, weight: 700 });
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
}

/**
 * Export a readable 1200 × 1600 souvenir card. This raster export deliberately
 * uses Canvas2D text; the interactive scene continues to use real 3D geometry.
 * Touch devices can use their native file sheet to save the PNG to Files/Photos.
 */
export async function saveJourneyCard({ conversation, badgeCanvas, sceneCanvas }) {
  validateConversation(conversation);
  let canvas = renderCard({ conversation, badgeCanvas, sceneCanvas });
  let omittedMedia = false;
  let blob;
  try {
    blob = await canvasBlob(canvas);
  } catch (error) {
    if (error.name !== 'SecurityError') throw error;
    // A third-party source could taint a canvas; text and seed remain exportable.
    canvas = renderCard({ conversation }, false);
    blob = await canvasBlob(canvas);
    omittedMedia = true;
  }

  const filename = `city-chat-${conversation.seed}.png`;
  const file = typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null;
  const shareFiles = file ? { files: [file], title: `${BRAND.title}｜對話紀念卡` } : null;
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
