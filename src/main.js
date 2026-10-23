import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';
import { MeshType, disposeGroup } from './text3d.js';
import { createWorker, createSticker, createBadge } from './models.js';
import { TOPICS, VERSION, createConversation, normalizeSeed, newSeed } from './conversation.js';
import { saveJourneyCard, shareJourney } from './export.js';
import { BRAND } from './branding.js';
import photos from './photos.json';
import { createExperienceControls } from './experience-controls.js';
import { createProfile, PROFILE_URL } from './profile.js';
import { saveJourney } from './journey-store.js';

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const sharedSeed = normalizeSeed(params.get('s'));
let seed = sharedSeed || newSeed();
let scriptVersion = params.get('v') === '1' || (sharedSeed && !params.has('v')) ? 1 : VERSION;
let conversation = createConversation(seed, scriptVersion);
let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let enlarged = false, inspecting = false, currentIndex = 0, completed = false, lastScroll = 0, movement = 0, jumpStart = -100;
let type, renderer, scene, uiScene, camera, worker, avatar, badge, pmrem;
let frame = 0, needsLayout = true, uiDirty = true, width = innerWidth, height = innerHeight;
let messages = [], lastTime = 0, composerTimer = 0, uiRecords = [], uiSources = [];
const colorCache = new WeakMap();
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const scrollRoot = $('#chat-space');
const liveMeshes = new Map();
const canvas = $('#scene');
const badgeScene = new THREE.Scene();
let savePromise=null, savedKey=null;
let sentCount = 0, sendTimer = null, forceSend = false;
const tilt = {x:0,y:0};
const textureCache = new Map();
const profile = createProfile();
const controls = createExperienceControls({
  onTilt(value) { tilt.x=value.x; tilt.y=value.y; needsLayout=true; },
  onStatus({message,state}) { updateControlUI(state); $('#experience-settings-status').textContent=message; }
});
function updateControlUI(state=controls.getState()) {
  for (const [id,key,label] of [['sound-toggle','sound','聲音'],['vibration-toggle','vibration','震動'],['tilt-toggle','tilt','立體感應']]) {
    const button=$('#'+id); button.textContent=(state[key].enabled?'關閉':'開啟')+label; button.setAttribute('aria-pressed',String(state[key].enabled));
  }
}
function photoTexture(url, portrait=false) {
  const key=url+(portrait?':portrait':'');
  if (!textureCache.has(key)) {
    const texture=new THREE.TextureLoader().load(url,()=>{needsLayout=true;}); texture.colorSpace=THREE.SRGBColorSpace;
    if(portrait){ texture.repeat.set(.43,.43); texture.offset.set(.28,.45); }
    textureCache.set(key,texture);
  }
  return textureCache.get(key);
}
function portrait(size) {
  const group=panel(size,size,'#fffdf4',6, size/3);
  const geometry=new THREE.PlaneGeometry(size-4,size-4); const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:photoTexture(PROFILE_URL,true),toneMapped:false}));
  mesh.userData.ownedGeometry=true; mesh.position.set(size/2,-size/2,7); group.add(mesh); return group;
}
function refreshSentSlots() {
  for(const info of messages){info.slot.hidden=info.index>sentCount;info.slot.classList.toggle('pending-message',info.index===sentCount);info.slot.style.height=info.index===sentCount?'90px':`${info.slotHeight}px`;for(const b of info.slot.querySelectorAll('button,a'))b.hidden=info.index>=sentCount;}
  $('#end-card').hidden=sentCount<messages.length;
}
function maybeSend() {
  if(sendTimer||sentCount>=messages.length||document.hidden||$('#info-dialog').open||document.querySelector('.profile-dialog[open]'))return;
  const next=messages[sentCount];if(!next)return;
  const rect=next.slot.getBoundingClientRect();
  if(!forceSend && rect.top>innerHeight-120)return;
  const scrollAfter=forceSend;forceSend=false;
  const delay=next.message.role==='system'?250:Math.min(1500,600+next.message.text.length*14);
  $('#composer-label').textContent=next.message.role==='visitor'?'示範回覆正在輸入…':'川伯正在準備下一則…';
  if(next.message.role==='visitor')animateComposer(sentCount-1);
  sendTimer=setTimeout(()=>{
    sendTimer=null;if(document.hidden)return;
    next.revealTime=performance.now();sentCount++;refreshSentSlots();
    if(next.message.role!=='system')controls.notifyMessage(next.message.role);
    if(scrollAfter)next.slot.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});
    needsLayout=true;refreshUISources();
  },delay);
}
function revealThrough(index) {
  clearTimeout(sendTimer);sendTimer=null;sentCount=Math.max(sentCount,Math.min(index+1,messages.length));
  refreshSentSlots();needsLayout=true;refreshUISources();
}


function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 3400); }
function setUrl() { const u = new URL(location.href); u.search = ''; u.searchParams.set('v', String(scriptVersion)); u.searchParams.set('s', seed); history.replaceState({}, '', u); }
function lightScene(target) { target.add(new THREE.AmbientLight(0xffffff, .8)); const key = new THREE.DirectionalLight(0xfff3d7, 1.5); key.position.set(-300, 500, 700); target.add(key); const fill = new THREE.DirectionalLight(0xd1ebdd, .55); fill.position.set(500, 0, 400); target.add(fill); }

function roundedShape(w, h, radius = 17) {
  const s = new THREE.Shape(); const r = Math.min(radius, h / 2, w / 2);
  s.moveTo(r, 0); s.lineTo(w - r, 0); s.quadraticCurveTo(w, 0, w, -r); s.lineTo(w, -h + r); s.quadraticCurveTo(w, -h, w - r, -h); s.lineTo(r, -h); s.quadraticCurveTo(0, -h, 0, -h + r); s.lineTo(0, -r); s.quadraticCurveTo(0, 0, r, 0); return s;
}
const materials = new Map();
const edgeMaterial = new THREE.LineBasicMaterial({ color: '#53634a', transparent: true, opacity: .72 });
function material(color) { if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .78 })); return materials.get(color); }
function panel(w, h, color, depth = 7, radius = 17) {
  const group = new THREE.Group();
  const geo = new THREE.ExtrudeGeometry(roundedShape(w, h, radius), { depth, bevelEnabled: true, bevelSize: .8, bevelThickness: .7, bevelSegments: 1, curveSegments: 7 });
  const frontKey = `front:${color}`;
  if (!materials.has(frontKey)) materials.set(frontKey, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  const body = new THREE.Mesh(geo, [materials.get(frontKey), material(color)]); body.userData.ownedGeometry = true; group.add(body);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMaterial); edge.userData.ownedGeometry = true; group.add(edge);
  return group;
}
function shapeIcon(kind, size, color) {
  const group = new THREE.Group();
  if (kind === 'dot') { const m = new THREE.Mesh(new THREE.SphereGeometry(size / 2, 12, 8), material(color)); m.userData.ownedGeometry = true; group.add(m); }
  return group;
}

function buildMessage(info) {
  const { message: m, bubbleWidth: w, bubbleHeight: h, fontSize, lines, x } = info;
  const group = new THREE.Group();
  const isUser = m.role === 'visitor', isSystem = m.role === 'system';
  if (isSystem) {
    const text = type.text(m.text, 11, '#809176', { maxWidth: info.shellWidth - 80, lineHeight: 20 });
    text.position.set((info.shellWidth - text.userData.width) / 2, -21, 2); group.add(text); return group;
  }
  const label = type.text(isUser ? '你 · 示範回覆' : BRAND.shortSpeaker, 10, '#7d8e72');
  label.position.set(isUser ? x + w - label.userData.width : x, -11, 1); group.add(label);
  const bubble = new THREE.Group(); bubble.position.set(x, -26, 0); bubble.rotation.x = inspecting ? .21 : .055; bubble.rotation.y = inspecting ? -.27 : -.055;
  const shadow = panel(w, h, '#cad5bb', 2); shadow.position.set(4, -6, -4); bubble.add(shadow);
  const body = panel(w, h, isUser ? '#c9e4a5' : '#fffef4', 8); bubble.add(body);
  // Bubble tails have volume too.
  const tailShape = new THREE.Shape();
  if (isUser) { tailShape.moveTo(w - 1, -12); tailShape.lineTo(w + 10, -7); tailShape.lineTo(w - 1, -28); }
  else { tailShape.moveTo(1, -12); tailShape.lineTo(-10, -7); tailShape.lineTo(1, -28); }
  tailShape.closePath();
  const tailGeo = new THREE.ExtrudeGeometry(tailShape, { depth: 8, bevelEnabled: false });
  const tail = new THREE.Mesh(tailGeo, material(isUser ? '#c9e4a5' : '#fffef4')); tail.userData.ownedGeometry = true; bubble.add(tail);
  const text = type.text(m.text, fontSize, '#294d3c', { maxWidth: w - 36, lineHeight: fontSize * 1.54 });
  text.position.set(18, -19 - fontSize * .83, 9); bubble.add(text);
  if (m.sticker) {
    const sticker = createSticker(m.sticker, seed); const scale = fontSize > 24 ? 36 : 32;
    sticker.scale.setScalar(scale); sticker.position.set(w / 2, -(h - 67), 33); sticker.rotation.set(.04, -.13, -.08); bubble.add(sticker); group.userData.sticker = sticker;
  }
  if (info.emoji) { const emoji = createSticker(info.emoji, seed); emoji.scale.setScalar(10); emoji.position.set(w - 30, -h + 24, 23); emoji.rotation.set(.06, -.15, -.06); bubble.add(emoji); }
  group.add(bubble); group.userData.bubble = bubble;
  if(info.photo){
    const pw=w-28, ph=pw*info.photo.height/info.photo.width;
    const py=-(lines.length*fontSize*1.54+42);
    const photoFrame=panel(pw+6,ph+6,'#ffffff',6,6);photoFrame.position.set(11,py+3,10);bubble.add(photoFrame);
    const geo=new THREE.PlaneGeometry(pw,ph);const photoMesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:photoTexture(info.photo.url),toneMapped:false}));photoMesh.userData.ownedGeometry=true;photoMesh.position.set(w/2,py-ph/2,17);bubble.add(photoMesh);
    const caption=type.text(info.photo.title+' · 官方照片',12,'#60785f',{maxWidth:w-28,lineHeight:20});caption.position.set(14,py-ph-20,10);bubble.add(caption);
  }
  const time = type.text(isUser ? '已讀' : '市政小筆記', 8, '#8e9b80'); time.position.set(isUser ? x - time.userData.width - 10 : x + w + 8, -h - 15, 0); group.add(time);
  if (!isUser) {
    const mini=portrait(30);mini.position.set(x-43,-28,9);mini.rotation.y=-.1;group.add(mini);
  }
  return group;
}

function rebuildMessages() {
  const previousScroll = window.scrollY; const previousTotal = document.documentElement.scrollHeight;
  liveMeshes.forEach(disposeGroup); liveMeshes.clear(); scrollRoot.replaceChildren();
  const shellWidth = $('#chat-shell').clientWidth;
  const mobile = shellWidth < 450; const fontSize = enlarged ? (mobile ? 28 : 29) : (mobile ? 23 : 24);
  messages = conversation.messages.map((message, index) => {
    const visitor = message.role === 'visitor', system = message.role === 'system';
    const maxW = shellWidth - (mobile ? 98 : 128);
    const lines = type.wrap(message.text, fontSize, maxW - 36);
    const textWidth = Math.max(...lines.map(line => [...line].reduce((sum, c) => sum + type.advance(c, fontSize), 0)));
    const photo=scriptVersion>=2 && message.role==='guide' && !message.sticker && !conversation.messages.slice(0,index).some(m=>m.topic===message.topic && m.role==='guide' && !m.sticker) ? photos.find(p=>p.relevantTopic===message.topic && p.relevantTopic!=='health') : null;
    const bubbleWidth = Math.max(message.sticker || photo ? Math.min(280,maxW) : 100, Math.min(maxW, textWidth + 36));
    const emoji = !system && !message.sticker && index % 7 === 3 ? 'thumb' : !system && !message.sticker && index % 11 === 1 ? 'sun' : null;
    const bubbleHeight = lines.length * fontSize * 1.54 + 34 + (message.sticker ? 128 : 0) + (emoji ? 40 : 0) + (photo ? (bubbleWidth-28)*photo.height/photo.width+64 : 0);
    const slotHeight = system ? type.wrap(message.text, 11, shellWidth - 80).length * 20 + 30 : bubbleHeight + 63;
    const slot = document.createElement('section'); slot.className = `message-slot ${message.role}`; slot.style.height = `${slotHeight}px`; slot.dataset.index = String(index);
    if (message.sticker) { const button = document.createElement('button'); button.textContent = '收藏這張貼圖 ↓'; button.className = 'sticker-download'; button.tabIndex = 0; button.setAttribute('aria-label', `下載${TOPICS.find(t => t.id === message.topic)?.title || ''}立體貼圖`); button.addEventListener('click', () => downloadSticker(message.sticker)); slot.appendChild(button); }
    if(photo){ const actions=document.createElement('div');actions.className='photo-actions';const link=document.createElement('a');link.href=photo.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='官方原文 ↗';const download=document.createElement('a');download.href=photo.url;download.download=photo.id+'.webp';download.textContent='下載照片 ↓';actions.append(link,download);slot.appendChild(actions);}
    if(!visitor&&!system){const avatarButton=document.createElement('button');avatarButton.className='message-avatar';avatarButton.setAttribute('aria-label','查看李四川人物資料');avatarButton.onclick=()=>profile.open();slot.appendChild(avatarButton);}
    scrollRoot.appendChild(slot);
    return { message, index, slot, shellWidth, fontSize, lines, bubbleWidth, bubbleHeight, slotHeight, emoji, photo, x: visitor ? shellWidth - bubbleWidth - (mobile ? 23 : 28) : (mobile ? 56 : 66), revealTime: -1 };
  });
  refreshSentSlots();
  $('#journey-id').textContent = `CITY / ${seed.slice(0, 8).toUpperCase()} · ${seed.slice(8, 16).toUpperCase()}`;
  const transcript = $('#transcript'); transcript.replaceChildren();
  conversation.messages.forEach(m => { const article = document.createElement('article'); article.className = `transcript-message ${m.role}`; const name = document.createElement('strong'); name.textContent = m.role === 'visitor' ? '你（示範回覆）：' : m.role === 'system' ? '展示說明：' : BRAND.shortSpeaker+'：'; article.append(name, document.createTextNode(m.text)); transcript.appendChild(article); });
  $('#topics').replaceChildren();
  conversation.topicOrder.forEach((id, i) => { const topic = TOPICS.find(t => t.id === id); const button = document.createElement('button'); const n = document.createElement('span'); n.textContent = String(i + 1).padStart(2, '0'); button.append(n, document.createTextNode(topic.title)); button.dataset.topic = id; button.addEventListener('click', () => {const target=messages.find(m=>m.message.topic===id);if(target){revealThrough(target.index);target.slot.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});}}); $('#topics').appendChild(button); });
  if (badge) disposeGroup(badge); badge = createBadge(seed); badgeScene.add(badge);
  window.scrollTo({ top: previousTotal ? previousScroll / previousTotal * document.documentElement.scrollHeight : 0, behavior: 'instant' });
  needsLayout = true; refreshUISources();
}

// Native semantic elements remain available to assistive technology. Their visible
// letterforms are replaced by extruded glyph meshes anchored to DOM character bounds.
const uiContainers = '.masthead,.intro-panel,.chat-header,.notice,.right-panel,.composer-wrap,#end-card,.sticker-download,.photo-actions';
function refreshUISources() {
  uiSources = []; const seen = new Set();
  for (const container of document.querySelectorAll(uiContainers)) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!node.textContent.trim() || seen.has(node) || parent.closest('script,style,#badge-space')) continue;
      seen.add(node);
      if (!colorCache.has(parent)) colorCache.set(parent, getComputedStyle(parent).color);
      uiSources.push({ node, parent, color: colorCache.get(parent) });
    }
  }
  uiDirty = true;
}
function rebuildUI() {
  const previous = new Map(uiRecords.map(record => [record.node, record]));
  const next = [];
  // Temporarily restore text color while measuring. No layout changes occur.
  document.querySelectorAll('.glyph-source').forEach(e => e.classList.remove('glyph-source'));
  for (const { node, parent, color } of uiSources) {
    if (!node.isConnected || !parent.getClientRects().length) continue;
    const pr = parent.getBoundingClientRect();
    if (pr.bottom < -40 || pr.top > height + 40 || pr.width === 0) continue;
    const style = getComputedStyle(parent); const size = parseFloat(style.fontSize);
    const layoutKey = `${node.textContent}|${style.fontSize}|${pr.width}|${pr.height}`;
    const cached = previous.get(node);
    if (cached && cached.layoutKey === layoutKey) { next.push(cached); previous.delete(node); parent.classList.add('glyph-source'); continue; }
    const chars = []; const range = document.createRange();
    for (let i = 0; i < node.length; i++) {
      const char = node.textContent[i]; if (/\s/.test(char)) continue;
      range.setStart(node, i); range.setEnd(node, i + 1); const rect = range.getBoundingClientRect();
      if (!rect.width) continue;
      chars.push({ char, x: rect.x - pr.x, y: -(rect.y - pr.y) - size * .9, size });
    }
    const mesh = type.positions(chars, color);
    if (mesh) { (parent.closest('#end-card,.sticker-download,.photo-actions') ? scene : uiScene).add(mesh); next.push({ mesh, parent, node, layoutKey }); }
    parent.classList.add('glyph-source');
  }
  for (const record of previous.values()) disposeGroup(record.mesh);
  uiRecords = next;
  for (const source of uiSources) source.parent.classList.add('glyph-source');
  uiDirty = false;
}

function animateComposer(index) {
  clearInterval(composerTimer);
  const upcoming = conversation.messages.slice(index + 1).find(m => m.role === 'visitor');
  const text = completed ? '把這段城市日常，分享給朋友。' : upcoming?.text || '今天就聊到這裡，謝謝你。';
  $('#composer-label').textContent = completed ? '這段旅程已完成' : '示範回覆 · 不需要輸入';
  $('#composer-text').textContent = reduced ? text : '';
  let n = 0;
  if (!reduced) composerTimer = setInterval(() => { n += 2; $('#composer-text').textContent = text.slice(0, n); refreshUISources(); if (n >= text.length) clearInterval(composerTimer); }, 85);
  refreshUISources();
}
function updateProgress(nextIndex) {
  const nextCompleted = sentCount===messages.length && $('#end-card').getBoundingClientRect().top < height * .65;
  const changed = nextIndex !== currentIndex || nextCompleted !== completed;
  if (!changed) return;
  currentIndex = nextIndex; completed = nextCompleted;
  if(completed)void persistJourney();
  $('#progress-label').textContent = `${String(nextIndex + 1).padStart(2, '0')} / 48 則`;
  $('#progress-fill').style.width = `${(nextIndex + 1) / 48 * 100}%`;
  const rawTopic = messages[nextIndex]?.message.topic;
  const topic = rawTopic === 'ending' ? conversation.topicOrder.at(-1) : rawTopic === 'intro' ? conversation.topicOrder[0] : rawTopic;
  const topicIndex = conversation.topicOrder.indexOf(topic);
  if (topicIndex >= 0) { $('#chapter-number').textContent = `${String(topicIndex + 1).padStart(2, '0')} / 08`; for (const button of $('#topics').children) button.classList.toggle('active', button.dataset.topic === topic); }
  $('#next').textContent = completed ? '↗' : '↓'; $('#next').setAttribute('aria-label', completed ? '分享這段對話' : '看下一則對話');
  if (changed) animateComposer(nextIndex);
}

function setPosition(object, x, y, z = 0) { object.position.set(x - width / 2, height / 2 - y, z); }
function resize() { width = innerWidth; height = innerHeight; renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); renderer.setSize(width, height); camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2; camera.updateProjectionMatrix(); needsLayout = true; uiDirty = true; }

function render(time = 0) {
  frame = requestAnimationFrame(render);
  if (document.hidden || document.body.classList.contains('reading-mode')) return;
  maybeSend();
  if (reduced && !needsLayout && !uiDirty) return;
  // Limit animated rendering to 30 fps; scroll input continues to update every frame.
  if (time - lastTime < 29 && !needsLayout && !uiDirty) return;
  lastTime = time;
  const t = time / 1000;
  if (uiDirty) rebuildUI();
  const shell = $('#chat-shell').getBoundingClientRect(); const header = $('.chat-header').getBoundingClientRect(); const notice = $('.notice').getBoundingClientRect(); const composer = $('.composer-wrap').getBoundingClientRect();
  let active = currentIndex;
  for (const info of messages) {
    if(info.index>=sentCount){if(liveMeshes.has(info.index)){disposeGroup(liveMeshes.get(info.index));liveMeshes.delete(info.index);}continue;}
    const rect = info.slot.getBoundingClientRect(); const visible = rect.bottom > notice.bottom - 30 && rect.top < composer.top + 60;
    if (rect.top < height * .65) active = info.index;
    if (visible) {
      if (!liveMeshes.has(info.index)) { const mesh = buildMessage(info); liveMeshes.set(info.index, mesh); scene.add(mesh); if (info.revealTime < 0) info.revealTime = time; }
      const mesh = liveMeshes.get(info.index); const p = reduced ? 1 : Math.min(1, (time - info.revealTime) / 440); const ease = 1 - Math.pow(1 - p, 3);
      setPosition(mesh, shell.left + (1 - ease) * (info.message.role === 'visitor' ? 20 : -20), rect.top + (1 - ease) * 15);
      if(mesh.userData.bubble)mesh.userData.bubble.rotation.set((inspecting?.21:.055)+tilt.y*.035,(inspecting?-.27:-.055)+tilt.x*.045,0);
      if (mesh.userData.sticker) mesh.userData.sticker.rotation.z = -.08 + (reduced ? 0 : Math.sin(t * 1.6 + info.index) * .055);
    } else if (liveMeshes.has(info.index)) { disposeGroup(liveMeshes.get(info.index)); liveMeshes.delete(info.index); }
  }
  const endVisible = sentCount===messages.length && $('#end-card').getBoundingClientRect().top < height * .65;
  if (active !== currentIndex || endVisible !== completed || needsLayout) updateProgress(active);
  for (const record of uiRecords) { const rect = record.parent.getBoundingClientRect(); setPosition(record.mesh, rect.left, rect.top, 10); record.mesh.visible = rect.bottom > 0 && rect.top < height; }
  const workerHit = (width < 1181 ? $('#mobile-worker-button') : $('#worker-button')).getBoundingClientRect();
  worker.visible = workerHit.width > 0;
  if (worker.visible) {
    const phase = reduced ? 0 : (t % 24); const trip = phase > 17 && phase < 19 ? Math.sin((phase - 17) / 2 * Math.PI) : 0;
    const jump = reduced ? 0 : Math.max(0, 1 - (t - jumpStart) / .85);
    worker.userData.animate(reduced ? 0 : t, { moving: !reduced && movement > .4, jump, trip });
    worker.scale.setScalar(width < 1181 ? 25 : 59); worker.rotation.y = -.25 + (reduced ? 0 : Math.sin(t * .5) * .08);
    setPosition(worker, workerHit.left + workerHit.width / 2 + (reduced ? 0 : Math.sin(t * .65) * Math.min(14, movement)), workerHit.bottom - 17, 30);
  }
  const avatarRect = $('.avatar-placeholder').getBoundingClientRect(); avatar.scale.setScalar(avatarRect.width/48); setPosition(avatar,avatarRect.left,avatarRect.top,35); avatar.rotation.y=tilt.x*.04;
  const badgeRect = $('#badge-space').getBoundingClientRect(); badge.visible = sentCount===messages.length && badgeRect.bottom > notice.bottom && badgeRect.top < composer.top;
  badge.scale.setScalar(58); setPosition(badge, badgeRect.left + badgeRect.width / 2, badgeRect.top + badgeRect.height / 2, 80); badge.rotation.y = reduced ? -.18 : Math.sin(t * .7) * .35; badge.rotation.x = .12;
  movement *= .94;
  renderer.info.reset(); renderer.setScissorTest(false); renderer.clear();
  const clipTop = Math.max(0, notice.bottom), clipBottom = Math.max(clipTop, Math.min(height, composer.top));
  renderer.setScissor(Math.max(0, shell.left), height - clipBottom, Math.min(shell.width, width), clipBottom - clipTop); renderer.setScissorTest(true); renderer.render(scene, camera); renderer.render(badgeScene, camera);
  renderer.setScissorTest(false); renderer.clearDepth(); renderer.render(uiScene, camera);
  needsLayout = false;
}

function snapshotModel(object, size = 800) {
  const exportScene = new THREE.Scene(); exportScene.background = new THREE.Color('#f6f4eb'); lightScene(exportScene);
  const copy = object.clone(true); copy.position.set(0, 0, 0); copy.scale.setScalar(1); copy.rotation.set(.12, -.22, -.07); exportScene.add(copy);
  const cam = new THREE.OrthographicCamera(-2.1, 2.1, 2.1, -2.1, .1, 100); cam.position.set(0, 0, 12); cam.lookAt(0, 0, 0);
  const temp = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); temp.setSize(size, size); temp.setPixelRatio(1); temp.outputColorSpace = THREE.SRGBColorSpace;
  const generator = new THREE.PMREMGenerator(temp); const room = new RoomEnvironment(); const environment = generator.fromScene(room, .04); room.dispose(); exportScene.environment = environment.texture; temp.render(exportScene, cam);
  const result = document.createElement('canvas'); result.width = size; result.height = size; result.getContext('2d').drawImage(temp.domElement, 0, 0); environment.dispose(); generator.dispose(); temp.dispose(); temp.forceContextLoss(); return result;
}
async function downloadSticker(kind = 'heart') {
  try {
    const model = createSticker(kind, seed); const snapshot = snapshotModel(model); disposeGroup(model);
    const blob = await new Promise((resolve, reject) => snapshot.toBlob(value => value ? resolve(value) : reject(new Error('無法產生貼圖')), 'image/png'));
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `city-sticker-${kind}-${seed.slice(0, 8)}.png`; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); toast('貼圖已產生，請查看下載項目。');
  } catch (error) { console.error(error); toast('貼圖下載失敗，請再試一次。'); }
}
async function persistJourney() {
  const key=seed+':'+scriptVersion;
  if(savedKey===key)return true;
  if(savePromise)return savePromise;
  const current=conversation;
  $('#cloud-status').textContent='正在保存這段預寫對話…';refreshUISources();
  savePromise=saveJourney(current).then(()=>{if(current===conversation){savedKey=key;$('#cloud-status').textContent='已保存至雲端。分享連結會重播相同劇本、照片與徽章。';}return true;}).catch(error=>{if(current===conversation)$('#cloud-status').textContent=error.message;return false;}).finally(()=>{savePromise=null;refreshUISources();});
  return savePromise;
}
async function share() {
  await persistJourney();
  const result = await shareJourney({ conversation, url: location.href });
  if (result.method === 'clipboard') toast('同一段對話的連結已複製。');
  else if (result.method === 'manual') { $('#info-dialog').showModal(); let link = $('#manual-share-link'); if (!link) { link = document.createElement('input'); link.id = 'manual-share-link'; link.readOnly = true; link.setAttribute('aria-label', '分享連結'); $('#info-dialog').appendChild(link); } link.value = result.url; link.focus(); link.select(); toast('請複製下方連結分享。'); }
}

function bind() {
  $('.avatar-placeholder').onclick=()=>profile.open();
  $('#sound-toggle').onclick=()=>controls.toggleSound();
  $('#vibration-toggle').onclick=()=>controls.toggleVibration();
  $('#tilt-toggle').onclick=()=>controls.toggleTilt();
  updateControlUI();
  $('.brand').addEventListener('click', event => { event.preventDefault(); window.scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' }); });
  $('#about').addEventListener('click', () => $('#info-dialog').showModal());
  $('#dimension').addEventListener('click', () => { inspecting = !inspecting; $('#dimension').setAttribute('aria-pressed', String(inspecting)); for (const mesh of liveMeshes.values()) if (mesh.userData.bubble) mesh.userData.bubble.rotation.set(inspecting ? .21 : .055, inspecting ? -.27 : -.055, 0); toast(inspecting ? '從側面看看：每個字與對話框，都有真正的厚度。' : '回到舒服的閱讀角度。'); });
  $('#close-dialog').addEventListener('click', () => $('#info-dialog').close());
  $('#info-dialog').addEventListener('click', event => { if (event.target === $('#info-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
  $('#reading-mode').addEventListener('click', () => { document.body.classList.toggle('reading-mode'); $('#info-dialog').close(); window.scrollTo(0, 0); uiDirty = true; });
  $('#worker-button').addEventListener('click', () => { jumpStart = performance.now() / 1000; if (reduced) toast('城市小工班向你打招呼！'); });
  $('#mobile-worker-button').addEventListener('click', () => { jumpStart = performance.now() / 1000; if (reduced) toast('城市小工班向你打招呼！'); });
  $('#text-size').addEventListener('click', () => { enlarged = !enlarged; $('#text-size').setAttribute('aria-pressed', String(enlarged)); $('#text-size').setAttribute('aria-label', enlarged ? '恢復標準大字' : '放大對話文字'); rebuildMessages(); toast(enlarged ? '對話文字已放大。' : '已恢復標準大字。'); });
  $('#motion').addEventListener('click', () => { reduced = !reduced; $('#motion').setAttribute('aria-pressed', String(reduced)); $('#motion').setAttribute('aria-label', reduced ? '開啟動畫' : '減少動畫'); $('#motion').textContent = reduced ? '▷' : 'Ⅱ'; document.documentElement.style.scrollBehavior = reduced ? 'auto' : 'smooth'; animateComposer(currentIndex); toast(reduced ? '已減少動畫，仍可自由捲動。' : '已開啟動畫。'); });
  motionQuery.addEventListener('change', event => { reduced = event.matches; $('#motion').setAttribute('aria-pressed', String(reduced)); needsLayout = true; });
  $('#next').addEventListener('click', () => { if (completed) share(); else if(currentIndex+1<sentCount)messages[currentIndex+1].slot.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});else{forceSend=true;maybeSend();} });
  $('#skip').addEventListener('click', () => {revealThrough(messages.length-1);$('#end-card').scrollIntoView({behavior:reduced?'instant':'smooth',block:'start'});});
  $('#share').addEventListener('click', share);
  $('#download').addEventListener('click', async () => { try { const model = createBadge(seed); const badgeCanvas = snapshotModel(model); disposeGroup(model); const result = await saveJourneyCard({ conversation, badgeCanvas }); if (result.method === 'download') toast('對話紀念卡已產生，請查看下載項目。'); } catch (error) { console.error(error); toast('圖卡下載失敗，請再試一次。'); } });
  $('#download-sticker').addEventListener('click', () => downloadSticker('badge'));
  $('#restart').addEventListener('click', () => { savePromise=null;savedKey=null;clearTimeout(sendTimer);sendTimer=null;sentCount=0;scriptVersion=VERSION;seed = newSeed(); conversation = createConversation(seed,scriptVersion); setUrl(); currentIndex = 0; completed = false; rebuildMessages(); window.scrollTo({ top: 0, behavior: 'instant' }); animateComposer(0); });
  window.addEventListener('scroll', () => { movement = Math.min(15, movement + Math.abs(window.scrollY - lastScroll) * .04); lastScroll = scrollY; needsLayout = true; clearTimeout(window.uiScrollTimer); window.uiScrollTimer = setTimeout(() => { uiDirty = true; }, 100); }, { passive: true });
  let resizeTimer; window.addEventListener('resize', () => { resize(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => rebuildMessages(), 180); });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); document.body.classList.add('reading-mode'); toast('3D 畫面暫時中斷，已切換純文字閱讀。'); });
}

async function init() {
  try {
    const response = await fetch('/assets/glyphs.json'); if (!response.ok) throw new Error('字型資料讀取失敗');
    type = new MeshType(await response.json());
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' }); renderer.setClearColor(0xffffff, 0); renderer.autoClear = false; renderer.info.autoReset = false; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene(); uiScene = new THREE.Scene(); lightScene(scene); lightScene(uiScene); lightScene(badgeScene);
    pmrem = new THREE.PMREMGenerator(renderer); const room = new RoomEnvironment(); const env = pmrem.fromScene(room, .04).texture; room.dispose(); scene.environment = env; uiScene.environment = env; badgeScene.environment = env;
    camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .1, 3000); camera.position.z = 1500;
    worker = createWorker(); avatar = portrait(48); uiScene.add(worker, avatar);
    setUrl(); rebuildMessages(); resize(); bind(); animateComposer(0);
    $('#motion').setAttribute('aria-pressed', String(reduced)); $('#loading').classList.add('hide'); render();
    if(params.has('v')&&!['1','2'].includes(params.get('v')))toast('此連結的版本無法辨識，已載入目前版本。');
    window.__CITY3D__ = { get stats() { return { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, glyphGeometries: type.cache.size, missingGlyphs: [...type.missing], visibleMessages: liveMeshes.size, activeIndex: currentIndex, seed, version: scriptVersion, sentCount, totalMessages: messages.length, reducedMotion: reduced, geometryText: true }; }, conversation, renderer, scene, uiScene, camera, snapshotModel };
  } catch (error) {
    console.error(error); $('#loading-status').textContent = '此裝置暫時無法啟動 3D，已切換文字閱讀。';
    document.body.classList.add('reading-mode');
    if (!$('#transcript').children.length) for (const m of conversation.messages) { const article = document.createElement('article'); article.className = `transcript-message ${m.role}`; article.textContent = `${m.role === 'visitor' ? '你（示範）' : BRAND.shortSpeaker}：${m.text}`; $('#transcript').appendChild(article); }
    $('#loading').classList.add('hide'); $('#about').onclick = () => $('#info-dialog').showModal(); $('#close-dialog').onclick = () => $('#info-dialog').close();
  }
}
init();
