import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsClient, isProductionLocation } from '../src/analytics.js';

const ID = 'G-ABC1234567';

function browserFixture({ protocol = 'https:', hostname = 'hammerlee.ai', port = '', idle = true, navigator = {} } = {}) {
  const scripts = [], callbacks = [];
  const location = { protocol, hostname, port };
  for (const field of ['href', 'search', 'hash', 'pathname']) {
    Object.defineProperty(location, field, { get() { throw new Error(`Do not read location.${field}`); } });
  }
  const document = {
    createElement(tag) { assert.equal(tag, 'script'); return {}; },
    head: { appendChild(script) { scripts.push(script); } },
  };
  for (const field of ['referrer', 'title', 'URL']) {
    Object.defineProperty(document, field, { get() { throw new Error(`Do not read document.${field}`); } });
  }
  const host = { location, navigator, document,
    setTimeout(callback, delay) { callbacks.push({ callback, delay }); },
  };
  if (idle) host.requestIdleCallback = (callback, options) => { callbacks.push({ callback, options }); };
  return { host, scripts, callbacks, flush() { callbacks.splice(0).forEach(({ callback }) => callback()); },
    commands() { return (host.dataLayer || []).map(command => [...command]); } };
}

test('analytics loads only on the canonical HTTPS production origin', () => {
  for (const options of [
    { protocol: 'http:' }, { hostname: 'hammerlee.tw' }, { hostname: 'www.hammerlee.ai' },
    { hostname: 'localhost' }, { hostname: 'hammerlee-ai.example.workers.dev' },
    { hostname: 'hammerlee.ai.evil.test' }, { port: '8443' },
  ]) {
    const fixture = browserFixture(options);
    const client = createAnalyticsClient(fixture.host);
    assert.equal(client.initAnalytics(ID), false);
    assert.equal(client.getState().reason, 'non-production');
    assert.equal(fixture.host.dataLayer, undefined);
    assert.equal(fixture.callbacks.length, 0);
  }
  assert.equal(isProductionLocation({ protocol: 'https:', hostname: 'hammerlee.ai', port: '443' }), true);
  assert.equal(isProductionLocation(undefined), false);
});

test('missing and malformed IDs, missing DOM, and browser privacy preferences produce no requests', () => {
  for (const id of ['', null, {}, 'G-ABC&bad=1', 'AW-1234567890', 'G-ABC1234567\n']) {
    const fixture = browserFixture();
    assert.equal(createAnalyticsClient(fixture.host).initAnalytics(id), false);
    assert.equal(fixture.host.dataLayer, undefined);
  }
  assert.equal(createAnalyticsClient(undefined).initAnalytics(ID), false);
  for (const navigator of [{ globalPrivacyControl: true }, { doNotTrack: '1' }, { doNotTrack: 'yes' }]) {
    const fixture = browserFixture({ navigator });
    const client = createAnalyticsClient(fixture.host);
    assert.equal(client.initAnalytics(ID), false);
    assert.equal(client.getState().reason, 'privacy-preference');
    assert.equal(fixture.callbacks.length, 0);
  }
});

test('initialization is lazy and idempotent, and queues exactly one sanitized pageview', () => {
  const fixture = browserFixture();
  const client = createAnalyticsClient(fixture.host);
  assert.equal(client.initAnalytics(ID), true);
  assert.equal(client.initAnalytics(ID), true);
  assert.equal(client.initAnalytics('G-DIFFERENT1'), false);
  assert.equal(fixture.scripts.length, 0);
  assert.equal(fixture.callbacks.length, 1);
  assert.equal(fixture.callbacks[0].options.timeout, 2000);
  const commands = fixture.commands();
  assert.equal(commands.filter(command => command[0] === 'config').length, 1);
  const views = commands.filter(command => command[0] === 'event' && command[1] === 'page_view');
  assert.equal(views.length, 1);
  assert.deepEqual(views[0][2], {
    page_location: 'https://hammerlee.ai/', page_referrer: '',
    page_title: '川伯，聊聊｜3D 市政資訊互動展示', send_to: ID,
  });
  const config = commands.find(command => command[0] === 'config')[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  assert.equal(config.ignore_referrer, true);
  assert.deepEqual(commands[0], ['consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
  }]);
  fixture.flush();
  assert.equal(fixture.scripts.length, 1);
  assert.equal(fixture.scripts[0].async, true);
  assert.equal(fixture.scripts[0].referrerPolicy, 'no-referrer');
  assert.equal(fixture.scripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${ID}`);
  fixture.scripts[0].onload();
  assert.equal(client.getState().phase, 'ready');
});

test('event allowlist cannot forward arbitrary URLs, seeds, dialogue, or preferences', () => {
  const fixture = browserFixture();
  const client = createAnalyticsClient(fixture.host);
  assert.equal(client.trackEvent('share'), false);
  client.initAnalytics(ID);
  for (const name of ['journey_complete', 'share', 'download']) {
    assert.equal(client.trackEvent(name, { seed: 'PRIVATE_SEED', page_location: 'https://example.com/?s=PRIVATE_SEED', text: 'PRIVATE_DIALOGUE' }), true);
  }
  for (const name of ['page_view', 'click', 'political_preference', 'view_search_results', '', null, {}]) {
    assert.equal(client.trackEvent(name), false);
  }
  const events = fixture.commands().filter(command => command[0] === 'event');
  assert.equal(events.length, 4);
  for (const [, , parameters] of events) {
    assert.deepEqual(Object.keys(parameters).sort(), ['page_location', 'page_referrer', 'page_title', 'send_to']);
    assert.equal(parameters.page_location, 'https://hammerlee.ai/');
    assert.equal(parameters.page_referrer, '');
  }
  assert.equal(JSON.stringify(fixture.commands()).includes('PRIVATE_'), false);
});

test('fallback timer and blocked script fail quietly without retries or further queued events', () => {
  const fixture = browserFixture({ idle: false });
  const client = createAnalyticsClient(fixture.host);
  client.initAnalytics(ID);
  assert.equal(fixture.callbacks[0].delay, 1200);
  fixture.flush();
  fixture.scripts[0].onerror();
  assert.equal(client.getState().phase, 'failed');
  const count = fixture.commands().length;
  assert.equal(client.trackEvent('download'), false);
  assert.equal(client.initAnalytics(ID), false);
  assert.equal(fixture.commands().length, count);
  assert.equal(fixture.callbacks.length, 0);
  const state = client.getState(); state.phase = 'ready';
  assert.equal(client.getState().phase, 'failed');
});
