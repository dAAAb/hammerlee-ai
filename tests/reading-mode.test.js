import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createConversation, VERSION } from '../src/conversation.js';
import { pendingRunwayHeight } from '../src/journey-flow.js';

// Exercise the real DOM orchestration functions without a GPU or browser. Layout
// itself is intentionally stubbed; these regressions concern hidden state/events.
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function fixture() {
  const classes = new Set(), nodes = new Map(), scrollListeners = [], cancelled = [], cards = [], shared = [];
  const element = () => ({ hidden: false, textContent: '', children: [], handlers: {},
    setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
    focus() { if (!this.disabled) this.focused = true; },
    addEventListener(name, callback) { (this.handlers[name] ||= []).push(callback); },
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    getBoundingClientRect() { return { top: 100 }; }, scrollIntoView() {},
  });
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  $('#end-card').hidden = true;
  const context = vm.createContext({
    $, console, pendingRunwayHeight, VERSION, createConversation,
    newSeed: () => 'ffeeddccbbaa99887766554433221100',
    document: { body: { classList: {
      contains: value => classes.has(value),
      toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); return enabled; },
    } }, createElement: element },
    window: { scrollTo() {}, addEventListener(name, callback) { if (name === 'scroll') scrollListeners.push(callback); } },
    innerHeight: 844,
    clearTimeout: id => cancelled.push(['timeout', id]), clearInterval: id => cancelled.push(['interval', id]),
    refreshUISources() {}, animateComposer() {}, setUrl() {}, rebuildMessages() { $('#end-card').hidden = true; },
    journeyFlow: { reset() {} }, share: () => shared.push('share'), downloadSticker() {},
    badgeAR: { reset() {}, prepare: async () => ({ state: 'ready' }) },
    saveJourneyCard: async options => { cards.push(options); return { method: 'download' }; },
    requestSelfie: async () => ({ cancelled: false }),
    trackEvent() {}, toast() {}, persistJourney: async () => true,
    BRAND: { shortSpeaker: '川伯', visitor: '新北事民．關心新北事' },
  });
  vm.runInContext(`
    var height=844,runwayHeight=0,totalMessageHeight=4800,sentCount=3,desiredSentCount=3;
    var sendTimer=42,sendDueAt=100,forceSend=true,followNextMessage=true,composerTimer=99;
    var needsLayout=false,uiDirty=false,currentIndex=2,completed=false,completionTracked=false,endActionsBound=false,cardExportPending=false;
    var type,renderer,scene,lastSentAt=0,scrollVelocity=0,lastDownAt=0,scriptVersion=2,seed='00112233445566778899aabbccddeeff';
    var conversation=createConversation(seed,scriptVersion),scrollRoot={style:{}};
    var messages=Array.from({length:48},(_,index)=>({index,bottomOffset:(index+1)*100,slot:{hidden:index>=3},actions:[]}));
  ` + block('function refreshSentSlots()', 'function firstMessageAfter(')
    + block('function revealThrough(', 'function toast(')
    + block('function setReadingMode(', 'function bind()'), context);
  return { context, $, cancelled, scrollListeners, cards, shared };
}

test('reading mode cancels pending delivery and exposes the ending before animation can run', () => {
  const setup = fixture();
  vm.runInContext('refreshSentSlots();setReadingMode(true);', setup.context);
  assert.equal(vm.runInContext('sentCount', setup.context), 48);
  assert.equal(vm.runInContext('sendTimer', setup.context), null);
  assert.equal(vm.runInContext('followNextMessage', setup.context), false);
  assert.equal(vm.runInContext('runwayHeight', setup.context), 0);
  assert.equal(setup.$('#end-card').hidden, false);
  assert.ok(setup.cancelled.some(([kind, id]) => kind === 'timeout' && id === 42));
  assert.ok(setup.cancelled.some(([kind, id]) => kind === 'interval' && id === 99));
  vm.runInContext('setReadingMode(false);', setup.context);
  assert.equal(vm.runInContext('sentCount', setup.context), 48);
  assert.equal(setup.$('#end-card').hidden, false);
});

test('card download waits for selfie choice, ignores repeated taps, and passes only the approved canvas', async () => {
  const setup = fixture();
  let decide;
  setup.context.requestSelfie = () => new Promise(resolve => { decide = resolve; });
  const pending = vm.runInContext('downloadJourney()', setup.context);
  await vm.runInContext('downloadJourney()', setup.context);
  assert.equal(setup.cards.length, 0);
  assert.equal(setup.$('#download').disabled, true);
  const canvas = { width: 720, height: 720 };
  decide({ cancelled: false, canvas });
  await pending;
  assert.equal(setup.cards.length, 1);
  assert.equal(setup.cards[0].selfieCanvas, canvas);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
  assert.equal(setup.$('#download').disabled, false);
});

test('cancelled selfie or a replaced journey cannot export a stale card', async () => {
  const setup = fixture();
  setup.context.requestSelfie = async () => ({ cancelled: true });
  await vm.runInContext('downloadJourney()', setup.context);
  assert.equal(setup.cards.length, 0);
  assert.equal(setup.$('#download').focused, true);
  let decide;
  setup.context.requestSelfie = () => new Promise(resolve => { decide = resolve; });
  const pending = vm.runInContext('downloadJourney()', setup.context);
  vm.runInContext('restartJourney()', setup.context);
  const staleCanvas = { width: 768, height: 768 };
  decide({ cancelled: false, canvas: staleCanvas });
  await pending;
  assert.equal(setup.cards.length, 0);
  assert.equal(setup.$('#download').disabled, false);
  assert.equal(staleCanvas.width, 0);
  assert.equal(staleCanvas.height, 0);
});

test('failed or cancelled card output clears the approved selfie and restores the download button', async () => {
  for (const result of ['failure', 'cancelled']) {
    const setup = fixture();
    const canvas = { width: 768, height: 768 };
    setup.context.requestSelfie = async () => ({ cancelled: false, canvas });
    setup.context.console = { error() {} };
    setup.context.saveJourneyCard = async options => {
      assert.equal(options.selfieCanvas.width, 768, 'pixels remain available during encoding');
      if (result === 'failure') throw new Error('Encoding failed');
      return { method: 'cancelled' };
    };
    await vm.runInContext('downloadJourney()', setup.context);
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
    assert.equal(setup.$('#download').disabled, false);
  }
});

test('text-only startup keeps share, card export, and restart actions working without WebGL', async () => {
  const setup = fixture();
  vm.runInContext('messages=[];renderTextTranscript();setReadingMode(true);bindEndActions();bindEndActions();', setup.context);
  assert.equal(setup.$('#transcript').children.length, 46);
  assert.equal(setup.$('#end-card').hidden, false);
  assert.equal(setup.$('#share').handlers.click.length, 1);
  setup.$('#share').handlers.click[0]();
  assert.equal(setup.shared.length, 1);
  await setup.$('#download').handlers.click[0]();
  assert.equal(setup.cards.length, 1);
  assert.equal(setup.cards[0].badgeCanvas, undefined);
  setup.$('#restart').handlers.click[0]();
  assert.equal(vm.runInContext('conversation.seed', setup.context), 'ffeeddccbbaa99887766554433221100');
  assert.equal(setup.$('#transcript').children.length, 46);
  assert.equal(setup.$('#end-card').hidden, false);
});

test('restarting while reading keeps the new journey ending visible after the 3D slots rebuild', () => {
  const setup = fixture();
  vm.runInContext('type={};renderer={};scene={};setReadingMode(true);restartJourney();', setup.context);
  assert.equal(vm.runInContext('sentCount', setup.context), 48);
  assert.equal(vm.runInContext('conversation.seed', setup.context), 'ffeeddccbbaa99887766554433221100');
  assert.equal(setup.$('#end-card').hidden, false);
});

test('reading completion only occurs at the ending and is not duplicated on repeated scroll', () => {
  const setup = fixture();
  let endTop = 2000, completions = 0, saves = 0;
  setup.$('#end-card').getBoundingClientRect = () => ({ top: endTop });
  setup.context.trackEvent = name => { if (name === 'journey_complete') completions++; };
  setup.context.persistJourney = async () => { saves++; };
  vm.runInContext('setReadingMode(true);bindEndActions();', setup.context);
  setup.scrollListeners[0]();
  assert.equal(completions, 0);
  endTop = 100;
  setup.scrollListeners[0](); setup.scrollListeners[0]();
  assert.equal(completions, 1);
  assert.equal(saves, 1);
});
