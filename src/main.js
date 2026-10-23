import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import './style.css';
import { MeshType, disposeGroup } from './text3d.js';
import { createWorker, createSticker, createBadge } from './models.js';
import { TOPICS, VERSION, createConversation, newSeed } from './conversation.js';
import { saveJourneyCard, shareJourney } from './export.js';
import { BRAND } from './branding.js';
import photos from './photos.json';
import { createExperienceControls } from './experience-controls.js';
import { createProfile, PROFILE_URL } from './profile.js';
import { saveJourney } from './journey-store.js';
import { initAnalytics, trackEvent } from './analytics.js';
import { parseJourneyLink, pendingRunwayHeight, createJourneyFlow } from './journey-flow.js';

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const initialJourney = parseJourneyLink(params);
let seed = initialJourney?.seed || newSeed();
let scriptVersion = initialJourney?.version || VERSION;
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
const journeyFlow = createJourneyFlow({ conversation, save: saveJourney, share: shareJourney, onSaveState: updateCloudStatus });
let endActionsBound = false;
let completionTracked = false;
let sentCount = 0, sendTimer = null, forceSend = false;
let desiredSentCount = 0, sendDueAt = 0, queuedAt = 0, lastSentAt = -Infinity, followNextMessage = false;
let scrollVelocity = 0, lastScrollAt = performance.now(), lastDownAt = -Infinity, lastInputAt = -Infinity;
let runwayHeight = 0, totalMessageHeight = 0;
const chromeLayout = { header: 112, notice: 44, composer: 155 };
const messageLayout = { systemSize: 15, systemLineHeight: 24, labelSize: 14, metadataSize: 14, captionSize: 14, captionLineHeight: 22, bubbleTop: 34, footerHeight: 42, actionHeight: 48 };
const tilt = {x:0,y:0};
const textureCache = new Map();
const profile = createProfile();
const profileDialog = document.querySelector('.profile-dialog');
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
    // Square crop includes the full face, with the eyes above centre and no
    // surrounding campaign lettering. Texture coordinates are bottom-up.
    if(portrait){ texture.repeat.set(.46,.46); texture.offset.set(.255,.485); }
    textureCache.set(key,texture);
  }
  return textureCache.get(key);
}
function portrait(size) {
  const group=panel(size,size,'#fffdf4',6, size/3);
  // Fill the rounded front face itself rather than placing a smaller square
  // inside it; the extruded side and outline still provide the 3D frame.
  const geometry=new THREE.ShapeGeometry(roundedShape(size,size,size/3),12);
  const vertices=geometry.attributes.position, uv=geometry.attributes.uv;
  for(let index=0;index<vertices.count;index++)uv.setXY(index,vertices.getX(index)/size,1+vertices.getY(index)/size);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:photoTexture(PROFILE_URL,true),toneMapped:false}));
  mesh.userData.ownedGeometry=true; mesh.position.z=7.1; group.add(mesh); return group;
}
function refreshSentSlots() {
  for(const info of messages){
    const hidden=info.index>=sentCount;
    if(info.hidden===hidden)continue;
    info.hidden=hidden;info.slot.hidden=hidden;
    for(const action of info.actions)action.hidden=hidden;
  }
  // A bounded runway keeps native scrolling available while the next few
  // messages arrive. It never creates a 48-message blank document.
  const revealedHeight=sentCount ? messages[sentCount-1].bottomOffset : 0;
  const nextRunway=sentCount<messages.length ? pendingRunwayHeight(totalMessageHeight-revealedHeight,height) : 0;
  if(nextRunway!==runwayHeight){runwayHeight=nextRunway;scrollRoot.style.paddingBottom=`${runwayHeight}px`;}
  $('#end-card').hidden=sentCount<messages.length;
}
function firstMessageAfter(offset, limit=messages.length) {
  let low=0,high=limit;
  while(low<high){const middle=(low+high)>>>1;if(messages[middle].bottomOffset<=offset)low=middle+1;else high=middle;}
  return low;
}
function maybeSend(now=performance.now(),rootTop=scrollRoot.getBoundingClientRect().top) {
  if(sentCount>=messages.length||document.hidden||$('#info-dialog').open||profileDialog?.open)return;
  const speed=scrollVelocity*Math.exp(-Math.max(0,now-lastDownAt)/420);
  const frontier=height-chromeLayout.composer-rootTop+Math.min(height*.25,90+speed*65);
  desiredSentCount=Math.max(desiredSentCount,Math.min(messages.length,firstMessageAfter(frontier)+1));
  if(forceSend){desiredSentCount=Math.max(desiredSentCount,sentCount+1);followNextMessage=true;forceSend=false;}
  if(desiredSentCount<=sentCount)return;
  const next=messages[sentCount];
  const catchingUp=now-lastDownAt<700 && (speed>1 || desiredSentCount-sentCount>2);
  const delay=catchingUp||followNextMessage ? 70 : next.message.role==='system' ? 300 : Math.max(300,Math.min(650,650-speed*180));
  if(!sendTimer){
    queuedAt=now;
    $('#composer-label').textContent=next.message.role==='visitor'?'示範回覆正在輸入…':'川伯正在準備下一則…';
    if(next.message.role==='visitor')animateComposer(sentCount-1);
  }
  const deadline=Math.max(lastSentAt+70,queuedAt+delay);
  // A quick gesture shortens a pending slow send immediately. It never waits
  // behind the old timer and never delivers a burst of overlapping messages.
  if(sendTimer && deadline>=sendDueAt-8)return;
  clearTimeout(sendTimer);sendDueAt=deadline;
  sendTimer=setTimeout(()=>{
    sendTimer=null;sendDueAt=0;
    if(document.hidden||$('#info-dialog').open||profileDialog?.open)return;
    const message=messages[sentCount];if(!message)return;
    lastSentAt=performance.now();message.revealTime=lastSentAt;sentCount++;refreshSentSlots();
    if(message.message.role!=='system')controls.notifyMessage(message.message.role);
    if(followNextMessage){followNextMessage=false;message.slot.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});}
    needsLayout=true;refreshUISources();
  },Math.max(0,deadline-now));
}
function noteScrollIntent(delta,now=performance.now()) {
  if(delta<=0||document.hidden||$('#info-dialog').open||profileDialog?.open)return;
  const elapsed=Math.max(16,Math.min(120,now-lastInputAt));lastInputAt=now;
  scrollVelocity=Math.max(scrollVelocity*.65,Math.min(12,delta/elapsed));lastDownAt=now;
  // Wheel/touch intent still arrives at the current document boundary, even
  // when the browser cannot emit another scroll event until content expands.
  const atFrontier=scrollY+height>=document.documentElement.scrollHeight-100;
  if(atFrontier)desiredSentCount=Math.max(desiredSentCount,Math.min(messages.length,sentCount+Math.max(2,Math.min(8,Math.ceil(delta/120)))));
  needsLayout=true;
}
function revealThrough(index) {
  clearTimeout(sendTimer);sendTimer=null;sendDueAt=0;forceSend=false;followNextMessage=false;
  sentCount=Math.max(sentCount,Math.min(index+1,messages.length));desiredSentCount=Math.max(desiredSentCount,sentCount);
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
    const text = type.text(m.text, messageLayout.systemSize, '#4d6654', { maxWidth: info.shellWidth - 48, lineHeight: messageLayout.systemLineHeight });
    text.position.set((info.shellWidth - text.userData.width) / 2, -28, 2); group.add(text); return group;
  }
  const label = type.text(isUser ? '你 · 示範回覆' : BRAND.shortSpeaker, messageLayout.labelSize, '#4d6654');
  label.position.set(isUser ? x + w - label.userData.width : x, -18, 1); group.add(label);
  const bubble = new THREE.Group(); bubble.position.set(x, -messageLayout.bubbleTop, 0); bubble.rotation.x = inspecting ? .21 : .055; bubble.rotation.y = inspecting ? -.27 : -.055;
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
    const caption=type.text(info.photo.title+' · 官方照片',messageLayout.captionSize,'#4d6654',{maxWidth:w-28,lineHeight:messageLayout.captionLineHeight});caption.position.set(14,py-ph-22,10);bubble.add(caption);
  }
  // Metadata stays below the bubble, within its width even on a 320px screen.
  // Media download controls occupy a separate row beneath this line.
  const time = type.text(isUser ? '已讀' : '市政小筆記', messageLayout.metadataSize, '#4d6654');
  time.position.set(isUser ? x + w - time.userData.width : x, -messageLayout.bubbleTop - h - 23, 0); group.add(time);
  if (!isUser) {
    const mini=portrait(42);mini.position.set(x-54,-messageLayout.bubbleTop-2,9);mini.rotation.y=-.1;group.add(mini);
  }
  return group;
}

function rebuildMessages() {
  const previousScroll = window.scrollY; const previousTotal = document.documentElement.scrollHeight;
  liveMeshes.forEach(disposeGroup); liveMeshes.clear(); scrollRoot.replaceChildren();
  const shellWidth = $('#chat-shell').clientWidth;
  const mobile = shellWidth < 450; const fontSize = enlarged ? (mobile ? 28 : 29) : (mobile ? 23 : 24);
  let topOffset=0;
  messages = displayEntries().map(({ message, sourceIndex }, index) => {
    const visitor = message.role === 'visitor', system = message.role === 'system';
    // The larger portrait uses the left gutter; recover space from the right
    // margin so even a 320px screen keeps the existing dialogue line length.
    const maxW = shellWidth - (mobile ? 88 : 128);
    const lines = type.wrap(message.text, fontSize, maxW - 36);
    const textWidth = Math.max(...lines.map(line => [...line].reduce((sum, c) => sum + type.advance(c, fontSize), 0)));
    const photo=scriptVersion>=2 && message.role==='guide' && !message.sticker && !conversation.messages.slice(0,sourceIndex).some(m=>m.topic===message.topic && m.role==='guide' && !m.sticker) ? photos.find(p=>p.relevantTopic===message.topic && p.relevantTopic!=='health') : null;
    const bubbleWidth = Math.max(message.sticker || photo ? Math.min(280,maxW) : 100, Math.min(maxW, textWidth + 36));
    const emoji = !system && !message.sticker && sourceIndex % 7 === 3 ? 'thumb' : !system && !message.sticker && sourceIndex % 11 === 1 ? 'sun' : null;
    const captionHeight = photo ? type.wrap(photo.title+' · 官方照片', messageLayout.captionSize, bubbleWidth-28).length * messageLayout.captionLineHeight : 0;
    const bubbleHeight = lines.length * fontSize * 1.54 + 34 + (message.sticker ? 128 : 0) + (emoji ? 40 : 0) + (photo ? (bubbleWidth-28)*photo.height/photo.width+captionHeight+38 : 0);
    const slotHeight = system ? type.wrap(message.text, messageLayout.systemSize, shellWidth - 48).length * messageLayout.systemLineHeight + 36 : messageLayout.bubbleTop + bubbleHeight + messageLayout.footerHeight + (message.sticker || photo ? messageLayout.actionHeight : 0);
    const slot = document.createElement('section'); slot.className = `message-slot ${message.role}`; slot.style.height = `${slotHeight}px`; slot.dataset.index = String(index);
    if (message.sticker) { const button = document.createElement('button'); button.textContent = '收藏這張貼圖 ↓'; button.className = 'sticker-download'; button.tabIndex = 0; button.setAttribute('aria-label', `下載${TOPICS.find(t => t.id === message.topic)?.title || ''}立體貼圖`); button.addEventListener('click', () => downloadSticker(message.sticker)); slot.appendChild(button); }
    if(photo){ const actions=document.createElement('div');actions.className='photo-actions';const link=document.createElement('a');link.href=photo.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='官方原文 ↗';const download=document.createElement('a');download.href=photo.url;download.download=photo.id+'.webp';download.textContent='下載照片 ↓';actions.append(link,download);slot.appendChild(actions);}
    if(!visitor&&!system){const avatarButton=document.createElement('button');avatarButton.className='message-avatar';avatarButton.setAttribute('aria-label','查看李四川人物資料');avatarButton.onclick=()=>profile.open();slot.appendChild(avatarButton);}
    scrollRoot.appendChild(slot);
    const info={ message, index, slot, shellWidth, fontSize, lines, bubbleWidth, bubbleHeight, slotHeight, topOffset, bottomOffset:topOffset+slotHeight, actions:[...slot.querySelectorAll('button,a')], emoji, photo, x: visitor ? shellWidth - bubbleWidth - (mobile ? 23 : 28) : (mobile ? 64 : 66), revealTime: -1 };
    topOffset+=slotHeight;return info;
  });
  totalMessageHeight=topOffset;
  refreshSentSlots();
  $('#progress-label').textContent = `${String(currentIndex + 1).padStart(2, '0')} / ${messages.length} 則`;
  $('#progress-fill').style.width = `${(currentIndex + 1) / messages.length * 100}%`;
  $('#journey-id').textContent = `CITY / ${seed.match(/.{8}/g).join(' · ').toUpperCase()}`;
  const transcript = $('#transcript'); transcript.replaceChildren();
  displayEntries().forEach(({message:m}) => { const article = document.createElement('article'); article.className = `transcript-message ${m.role}`; const name = document.createElement('strong'); name.textContent = m.role === 'visitor' ? '你（示範回覆）：' : m.role === 'system' ? '展示說明：' : BRAND.shortSpeaker+'：'; article.append(name, document.createTextNode(m.text)); transcript.appendChild(article); });
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
  // Fast scrolling should not keep resetting a typewriter to an empty field.
  const stillText = reduced || document.body.classList.contains('reading-mode') || (scrollVelocity > 1 && performance.now() - lastDownAt < 700);
  const upcoming = messages.slice(index + 1).find(m => m.message.role === 'visitor')?.message;
  const text = completed ? '把這段城市日常，分享給朋友。' : upcoming?.text || '今天就聊到這裡，謝謝你。';
  $('#composer-label').textContent = completed ? '這段旅程已完成' : '示範回覆 · 不需要輸入';
  $('#composer-text').textContent = stillText ? text : text.slice(0, 2);
  let n = 2;
  if (!stillText) composerTimer = setInterval(() => { n += 2; $('#composer-text').textContent = text.slice(0, n); refreshUISources(); if (n >= text.length) clearInterval(composerTimer); }, 85);
  refreshUISources();
}
function updateProgress(nextIndex) {
  const nextCompleted = sentCount===messages.length && $('#end-card').getBoundingClientRect().top < height * .65;
  const changed = nextIndex !== currentIndex || nextCompleted !== completed;
  if (!changed) return;
  currentIndex = nextIndex; completed = nextCompleted;
  if(completed){
    if(!completionTracked){completionTracked=true;trackEvent('journey_complete');}
    void persistJourney();
  }
  $('#progress-label').textContent = `${String(nextIndex + 1).padStart(2, '0')} / ${messages.length} 則`;
  $('#progress-fill').style.width = `${(nextIndex + 1) / messages.length * 100}%`;
  const rawTopic = messages[nextIndex]?.message.topic;
  const topic = rawTopic === 'ending' ? conversation.topicOrder.at(-1) : rawTopic === 'intro' ? conversation.topicOrder[0] : rawTopic;
  const topicIndex = conversation.topicOrder.indexOf(topic);
  if (topicIndex >= 0) { $('#chapter-number').textContent = `${String(topicIndex + 1).padStart(2, '0')} / 08`; for (const button of $('#topics').children) button.classList.toggle('active', button.dataset.topic === topic); }
  $('#next').textContent = completed ? '↗' : '↓'; $('#next').setAttribute('aria-label', completed ? '分享這段對話' : '看下一則對話');
  if (changed) animateComposer(nextIndex);
}

function setPosition(object, x, y, z = 0) { object.position.set(x - width / 2, height / 2 - y, z); }
function syncChromeLayout() {
  for (const [key, selector, variable] of [['header','.chat-header','--chat-header-height'],['notice','.notice','--chat-notice-height'],['composer','.composer-wrap','--composer-height']]) {
    const measured = Math.ceil($(selector).getBoundingClientRect().height);
    if (!measured || measured === chromeLayout[key]) continue;
    chromeLayout[key] = measured;
    document.documentElement.style.setProperty(variable, `${measured}px`);
    needsLayout = true; uiDirty = true;
  }
}
function resize() { width = innerWidth; height = innerHeight; renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); renderer.setSize(width, height); camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2; camera.updateProjectionMatrix(); syncChromeLayout(); needsLayout = true; uiDirty = true; }

function render(time = 0) {
  frame = requestAnimationFrame(render);
  if (document.hidden || document.body.classList.contains('reading-mode')) return;
  const messageTop=scrollRoot.getBoundingClientRect().top;
  maybeSend(time||performance.now(),messageTop);
  if (reduced && !needsLayout && !uiDirty) return;
  // Limit animated rendering to 30 fps; scroll input continues to update every frame.
  if (time - lastTime < 29 && !needsLayout && !uiDirty) return;
  lastTime = time;
  const t = time / 1000;
  if (uiDirty) rebuildUI();
  const shell = $('#chat-shell').getBoundingClientRect(); const header = $('.chat-header').getBoundingClientRect(); const notice = $('.notice').getBoundingClientRect(); const composer = $('.composer-wrap').getBoundingClientRect();
  const active=Math.max(0,Math.min(sentCount-1,firstMessageAfter((notice.bottom+composer.top)/2-messageTop,sentCount)));
  const firstVisible=firstMessageAfter(notice.bottom-30-messageTop,sentCount);
  let lastVisible=firstVisible;
  while(lastVisible<sentCount && messages[lastVisible].topOffset+messageTop<composer.top+60)lastVisible++;
  for(const [index,mesh] of liveMeshes){if(index<firstVisible||index>=lastVisible){disposeGroup(mesh);liveMeshes.delete(index);}}
  for(let index=firstVisible;index<lastVisible;index++) {
      const info=messages[index];
      if (!liveMeshes.has(info.index)) { const mesh = buildMessage(info); liveMeshes.set(info.index, mesh); scene.add(mesh); if (info.revealTime < 0) info.revealTime = time; }
      const mesh = liveMeshes.get(info.index); const p = reduced ? 1 : Math.min(1, (time - info.revealTime) / 440); const ease = 1 - Math.pow(1 - p, 3);
      setPosition(mesh, shell.left + (1 - ease) * (info.message.role === 'visitor' ? 20 : -6), messageTop+info.topOffset + (1 - ease) * 15);
      if(mesh.userData.bubble)mesh.userData.bubble.rotation.set((inspecting?.21:.055)+tilt.y*.035,(inspecting?-.27:-.055)+tilt.x*.045,0);
      if (mesh.userData.sticker) mesh.userData.sticker.rotation.z = -.08 + (reduced ? 0 : Math.sin(t * 1.6 + info.index) * .055);
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
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `city-sticker-${kind}-${seed.slice(0, 8)}.png`; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); trackEvent('download'); toast('貼圖已產生，請查看下載項目。');
  } catch (error) { console.error(error); toast('貼圖下載失敗，請再試一次。'); }
}
function updateCloudStatus({ status, error }) {
  $('#cloud-status').textContent = status === 'saving' ? '正在保存這段預寫對話…'
    : status === 'saved' ? '已保存至雲端。分享連結會重播相同劇本、照片與徽章。'
    : status === 'failed' ? error.message
    : '完成後會將預寫劇本編號保存至雲端，不收集個人對話或政治偏好。';
  if (type) refreshUISources();
}
function persistJourney() {
  return journeyFlow.persist();
}
async function share() {
  const result = await journeyFlow.share(location.href);
  if (result.method === 'native' || result.method === 'clipboard') trackEvent('share');
  if (result.method === 'clipboard') toast('同一段對話的連結已複製。');
  else if (result.method === 'manual') { $('#info-dialog').showModal(); let link = $('#manual-share-link'); if (!link) { link = document.createElement('input'); link.id = 'manual-share-link'; link.readOnly = true; link.setAttribute('aria-label', '分享連結'); $('#info-dialog').appendChild(link); } link.value = result.url; link.focus(); link.select(); toast('請複製下方連結分享。'); }
}

function setReadingMode(enabled) {
  document.body.classList.toggle('reading-mode', enabled);
  if (enabled) {
    clearInterval(composerTimer);
    if (messages.length) revealThrough(messages.length - 1);
    else $('#end-card').hidden = false;
  } else if (messages.length) animateComposer(currentIndex);
  needsLayout = true; uiDirty = true;
}

// The opening notices live in the info dialog. Keep source indices so replayed
// journeys retain the same photos and emoji while the displayed slots shift.
function displayEntries() {
  return conversation.messages.flatMap((message, sourceIndex) =>
    message.role === 'system' && message.topic === 'intro' ? [] : [{ message, sourceIndex }]);
}

function renderTextTranscript() {
  const transcript = $('#transcript'); transcript.replaceChildren();
  for (const { message } of displayEntries()) {
    const article = document.createElement('article'); article.className = `transcript-message ${message.role}`;
    article.textContent = `${message.role === 'visitor' ? '你（示範回覆）' : message.role === 'system' ? '展示說明' : BRAND.shortSpeaker}：${message.text}`;
    transcript.appendChild(article);
  }
}

function restartJourney() {
  clearTimeout(sendTimer);sendTimer=null;sendDueAt=0;sentCount=0;desiredSentCount=0;lastSentAt=-Infinity;forceSend=false;followNextMessage=false;scrollVelocity=0;lastDownAt=-Infinity;
  scriptVersion=VERSION;seed=newSeed();conversation=createConversation(seed,scriptVersion);journeyFlow.reset(conversation);setUrl();
  currentIndex=0;completed=false;completionTracked=false;
  if(type && renderer && scene)rebuildMessages();else renderTextTranscript();
  if(document.body.classList.contains('reading-mode'))setReadingMode(true);
  window.scrollTo({top:0,behavior:'instant'});
  if(type)animateComposer(0);
}

async function downloadJourney() {
  const current = conversation;
  try {
    let badgeCanvas;
    if (renderer && !renderer.getContext().isContextLost()) {
      const model = createBadge(current.seed);
      try { badgeCanvas = snapshotModel(model); } catch { /* Text cards remain available when WebGL export fails. */ }
      finally { disposeGroup(model); }
    }
    const result = await saveJourneyCard({ conversation: current, badgeCanvas });
    if (result.method === 'download' || result.method === 'native') trackEvent('download');
    if (result.method === 'download') toast('對話紀念卡已產生，請查看下載項目。');
  } catch (error) { console.error(error); toast('圖卡下載失敗，請再試一次。'); }
}

function bindEndActions() {
  if (endActionsBound) return;
  endActionsBound = true;
  $('#share').addEventListener('click', share);
  $('#download').addEventListener('click', downloadJourney);
  $('#download-sticker').addEventListener('click', () => downloadSticker('badge'));
  $('#restart').addEventListener('click', restartJourney);
  window.addEventListener('scroll', () => {
    if (!document.body.classList.contains('reading-mode') || completed || $('#end-card').getBoundingClientRect().top >= innerHeight * .65) return;
    completed = true;
    if (!completionTracked) { completionTracked = true; trackEvent('journey_complete'); }
    void persistJourney();
  }, { passive: true });
}

function bind() {
  bindEndActions();
  // Real photo-link activations only. Generated PNG downloads are recorded after
  // successful generation below, so their synthetic clicks are not counted twice.
  document.addEventListener('click', event => {
    if (event.isTrusted && !event.defaultPrevented && event.button === 0 && event.target.closest?.('a[download]')) trackEvent('download');
  });
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
  $('#reading-mode').addEventListener('click', () => { setReadingMode(!document.body.classList.contains('reading-mode')); $('#info-dialog').close(); window.scrollTo(0, 0); });
  $('#worker-button').addEventListener('click', () => { jumpStart = performance.now() / 1000; if (reduced) toast('城市小工班向你打招呼！'); });
  $('#mobile-worker-button').addEventListener('click', () => { jumpStart = performance.now() / 1000; if (reduced) toast('城市小工班向你打招呼！'); });
  $('#text-size').addEventListener('click', () => { enlarged = !enlarged; $('#text-size').setAttribute('aria-pressed', String(enlarged)); $('#text-size').setAttribute('aria-label', enlarged ? '恢復標準大字' : '放大對話文字'); rebuildMessages(); toast(enlarged ? '對話文字已放大。' : '已恢復標準大字。'); });
  $('#motion').addEventListener('click', () => { reduced = !reduced; $('#motion').setAttribute('aria-pressed', String(reduced)); $('#motion').setAttribute('aria-label', reduced ? '開啟動畫' : '減少動畫'); $('#motion').textContent = reduced ? '▷' : 'Ⅱ'; document.documentElement.style.scrollBehavior = reduced ? 'auto' : 'smooth'; animateComposer(currentIndex); toast(reduced ? '已減少動畫，仍可自由捲動。' : '已開啟動畫。'); });
  motionQuery.addEventListener('change', event => { reduced = event.matches; $('#motion').setAttribute('aria-pressed', String(reduced)); needsLayout = true; });
  $('#next').addEventListener('click', () => { if (completed) share(); else if(currentIndex+1<sentCount)messages[currentIndex+1].slot.scrollIntoView({behavior:reduced?'instant':'smooth',block:'center'});else{forceSend=true;maybeSend();} });
  $('#skip').addEventListener('click', () => {
    revealThrough(messages.length-1);
    // Put the badge and the primary share action together in the usable area,
    // rather than stopping at an end-card heading above the actual actions.
    const badgeTop=$('#badge-space').getBoundingClientRect().top+scrollY;
    const shareBottom=$('#share').getBoundingClientRect().bottom+scrollY;
    const topInset=$('.chat-header').offsetHeight+$('.notice').offsetHeight+16;
    const bottomInset=$('.composer-wrap').offsetHeight+20;
    const available=height-topInset-bottomInset;
    const target=badgeTop-topInset-Math.max(0,(available-(shareBottom-badgeTop))/2);
    window.scrollTo({top:Math.max(0,target),behavior:reduced?'instant':'smooth'});
  });
  window.addEventListener('scroll', () => {
    const now=performance.now(),delta=window.scrollY-lastScroll;
    movement=Math.min(15,movement+Math.abs(delta)*.04);
    if(delta>0){scrollVelocity=Math.max(scrollVelocity*.65,Math.min(12,delta/Math.max(16,now-lastScrollAt)));lastDownAt=now;}
    else if(delta<0)scrollVelocity=0;
    lastScroll=scrollY;lastScrollAt=now;needsLayout=true;
    clearTimeout(window.uiScrollTimer);window.uiScrollTimer=setTimeout(()=>{uiDirty=true;},100);
  },{passive:true});
  window.addEventListener('wheel',event=>{const scale=event.deltaMode===1?24:event.deltaMode===2?height:1;noteScrollIntent(event.deltaY*scale);},{passive:true});
  let touchY=null;
  window.addEventListener('touchstart',event=>{touchY=event.touches.length===1?event.touches[0].clientY:null;},{passive:true});
  window.addEventListener('touchmove',event=>{if(touchY===null||event.touches.length!==1)return;const y=event.touches[0].clientY;noteScrollIntent(touchY-y);touchY=y;},{passive:true});
  window.addEventListener('touchend',()=>{touchY=null;},{passive:true});
  let resizeTimer; window.addEventListener('resize', () => { resize(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => rebuildMessages(), 180); });
  if (typeof ResizeObserver !== 'undefined') {
    const chromeObserver = new ResizeObserver(syncChromeLayout);
    for (const selector of ['.chat-header','.notice','.composer-wrap']) chromeObserver.observe($(selector));
  }
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); setReadingMode(true); toast('3D 畫面暫時中斷，已切換純文字閱讀。'); });
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
    if(!initialJourney)toast('此連結的版本無法辨識，已載入目前版本。');
    window.__CITY3D__ = { get stats() { return { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, glyphGeometries: type.cache.size, missingGlyphs: [...type.missing], visibleMessages: liveMeshes.size, activeIndex: currentIndex, seed, version: scriptVersion, sentCount, desiredSentCount, runwayHeight, scrollVelocity, totalMessages: messages.length, reducedMotion: reduced, geometryText: true }; }, conversation, renderer, scene, uiScene, camera, snapshotModel };
  } catch (error) {
    console.error(error); $('#loading-status').textContent = '此裝置暫時無法啟動 3D，已切換文字閱讀。';
    renderTextTranscript();setUrl();setReadingMode(true);bindEndActions();
    $('.avatar-placeholder').onclick=()=>profile.open();
    $('#loading').classList.add('hide'); $('#about').onclick = () => $('#info-dialog').showModal(); $('#close-dialog').onclick = () => $('#info-dialog').close();
  }
}
initAnalytics();
init();
